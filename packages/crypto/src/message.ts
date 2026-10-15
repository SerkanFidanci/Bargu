import {
  DOC_PADDED_BYTES,
  docEnvelopeSchema,
  docPayloadSchema,
  HISTORY_PADDED_SIZES,
  historyEnvelopeSchema,
  messageEnvelopeSchema,
  payloadSchema,
  trailPayloadSchema,
  type DocPayload,
  type MessageEnvelope,
  type Payload,
  type PlacePayload,
  type TrailPayload,
} from '@bargu/schemas';

import {
  type Label,
  LABELS,
  MAX_U32,
  MESSAGE_PADDED_BYTES,
  PROTOCOL_VERSION,
  SALT_BYTES,
  SIGNATURE_BYTES,
} from './constants.js';
import {
  concatBytes,
  fromBase64url,
  toBase64url,
  u32be,
  utf8Decode,
  utf8Encode,
  uuidToBytes,
} from './encoding.js';
import { BarguCryptoError } from './errors.js';
import type { DeviceKeys, DevicePublicKeys } from './keys.js';
import { pad, unpad } from './padding.js';
import {
  aeadOpen,
  aeadSeal,
  deriveKeyAndNonce,
  hmacWithLabel,
  randomBytes,
  signWithLabel,
  verifyWithLabel,
} from './primitives.js';
import type { ReplayGuard } from './replay.js';
import type { SenderKey } from './sender-key.js';

/**
 * Sending side of a sender key. `nextSeq` must be persisted *before* the envelope is sent; if that
 * state is ever lost, rotate to a new epoch instead of reusing sequence numbers.
 */
export interface SenderState {
  readonly senderKey: SenderKey;
  readonly nextSeq: number;
}

export function createSenderState(senderKey: SenderKey): SenderState {
  return { senderKey, nextSeq: 0 };
}

interface HeaderFields {
  circleId: string;
  epoch: number;
  senderDeviceId: string;
  seq: number;
  salt: Uint8Array;
}

/** version(1) ‖ circleId(16) ‖ epoch(u32 BE) ‖ senderDeviceId(16) ‖ seq(u32 BE) ‖ salt(16) */
function messageHeader(fields: HeaderFields): Uint8Array {
  return concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    uuidToBytes(fields.circleId),
    u32be(fields.epoch),
    uuidToBytes(fields.senderDeviceId),
    u32be(fields.seq),
    fields.salt,
  );
}

/**
 * Per-message key and nonce: HKDF-SHA256(senderKey, salt, "bargu/v1/msg" ‖ header) (history:
 * "bargu/v1/hist"). Each message gets its own key, so loss or reordering never blocks decryption
 * (O(1), no ratchet state), and the random salt keeps keys unique even if a sequence number were
 * ever reused.
 */
function messageKey(senderKey: Uint8Array, salt: Uint8Array, header: Uint8Array, kdf: Label) {
  return deriveKeyAndNonce(senderKey, salt, kdf, header);
}

interface EncryptInput {
  state: SenderState;
  sender: DeviceKeys;
  payload: Payload;
}

interface DocumentEncryptInput extends Omit<EncryptInput, 'payload'> {
  payload: DocPayload;
}

/**
 * The envelopes (docs/PROTOCOL.md): messages; the documents a circle keeps (docs/ADR/0018), same
 * header, keys and signature but a larger fixed size, which tells them apart, so a signed message
 * never passes for a document or the other way round; and pieces of location history
 * (docs/ADR/0019), sealed with a key derived for history and their own labels.
 */
interface Format {
  readonly envelope: {
    safeParse(value: unknown): { success: true; data: MessageEnvelope } | { success: false };
  };
  /** Plaintexts are padded to the smallest of these that fits. */
  readonly sizes: readonly number[];
  readonly kdf: Label;
  readonly signature: Label;
}
const MESSAGE: Format = {
  envelope: messageEnvelopeSchema,
  sizes: [MESSAGE_PADDED_BYTES],
  kdf: LABELS.messageKdf,
  signature: LABELS.messageSignature,
};
const DOCUMENT: Format = { ...MESSAGE, envelope: docEnvelopeSchema, sizes: [DOC_PADDED_BYTES] };
const HISTORY: Format = {
  envelope: historyEnvelopeSchema,
  sizes: HISTORY_PADDED_SIZES,
  kdf: LABELS.historyKdf,
  signature: LABELS.historySignature,
};
/** @internal The formats, for tests that model a malicious sender. */
export const FORMATS = { message: MESSAGE, document: DOCUMENT, history: HISTORY } as const;

export interface EncryptResult {
  envelope: MessageEnvelope;
  /** Persist before sending `envelope`. */
  nextState: SenderState;
}

/**
 * @internal Encrypts already padded bytes. Exposed only so tests can model a malicious sender that
 * signs well-formed envelopes around invalid plaintext.
 */
export function encryptPaddedWith(
  { state, sender }: Omit<EncryptInput, 'payload'>,
  paddedPlaintext: Uint8Array,
  salt: Uint8Array,
  format: Format = MESSAGE,
): EncryptResult {
  const { senderKey, nextSeq: seq } = state;
  if (sender.deviceId !== senderKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'sender key belongs to another device');
  }
  if (seq > MAX_U32) {
    throw new BarguCryptoError('REKEY_REQUIRED', 'sequence numbers exhausted for this epoch');
  }
  const fields = {
    circleId: senderKey.circleId,
    epoch: senderKey.epoch,
    senderDeviceId: senderKey.senderDeviceId,
    seq,
    salt,
  };
  const header = messageHeader(fields);
  const keyAndNonce = messageKey(senderKey.key, salt, header, format.kdf);
  const ct = aeadSeal(keyAndNonce, paddedPlaintext, header);
  keyAndNonce.key.fill(0);
  const sig = signWithLabel(format.signature, concatBytes(header, ct), sender.identity.secretKey);

  return {
    envelope: {
      v: PROTOCOL_VERSION,
      circleId: fields.circleId,
      epoch: fields.epoch,
      senderDeviceId: fields.senderDeviceId,
      seq,
      salt: toBase64url(salt),
      ct: toBase64url(ct),
      sig: toBase64url(sig),
    },
    nextState: { senderKey, nextSeq: seq + 1 },
  };
}

/** Pads a validated payload to the smallest size of its format that fits, encrypts, signs. */
function encryptValidated(
  input: Omit<EncryptInput, 'payload'>,
  payload: Payload | DocPayload | TrailPayload,
  format: Format,
  salt: Uint8Array,
): EncryptResult {
  const json = utf8Encode(JSON.stringify(payload));
  // None fits: the largest, which `pad` refuses.
  const size = Math.min(
    ...format.sizes.filter((candidate) => json.length < candidate),
    Math.max(...format.sizes),
  );
  const plaintext = pad(json, size, size);
  try {
    return encryptPaddedWith(input, plaintext, salt, format);
  } finally {
    plaintext.fill(0);
  }
}

/** @internal Deterministic core; `salt` must be fresh randomness in production. */
export function encryptMessageWith(input: EncryptInput, salt: Uint8Array): EncryptResult {
  const parsed = payloadSchema.safeParse(input.payload);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid payload');
  return encryptValidated(input, parsed.data, MESSAGE, salt);
}

/** @internal Deterministic core of `encryptDocument`. */
export function encryptDocumentWith(input: DocumentEncryptInput, salt: Uint8Array): EncryptResult {
  const parsed = docPayloadSchema.safeParse(input.payload);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid document');
  return encryptValidated(input, parsed.data, DOCUMENT, salt);
}

/**
 * Encrypts and signs one payload for the whole circle (one envelope, every member decrypts it with
 * this device's sender key). Location precision must already be applied (`applyPrecision`).
 */
export function encryptMessage(input: EncryptInput): EncryptResult {
  return encryptMessageWith(input, randomBytes(SALT_BYTES));
}

/**
 * Encrypts and signs a document the circle keeps on the server (an event's meeting, a poll, a
 * vote; docs/ADR/0018): like a message, in the larger fixed-size document envelope. Persist
 * `nextState` first, as for messages.
 */
export function encryptDocument(input: DocumentEncryptInput): EncryptResult {
  return encryptDocumentWith(input, randomBytes(SALT_BYTES));
}

function parseEnvelope(envelope: unknown, format: Format) {
  const parsed = format.envelope.safeParse(envelope);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid envelope');
  const data = parsed.data;
  const salt = fromBase64url(data.salt, SALT_BYTES);
  const ct = fromBase64url(data.ct);
  const sig = fromBase64url(data.sig, SIGNATURE_BYTES);
  return { data, ct, sig, header: messageHeader({ ...data, salt }), salt };
}

/**
 * Server-side relay check: well-formed and signed by the claimed sender device (the server also
 * checks that device's circle membership). Never throws.
 */
export function verifyMessageEnvelope(envelope: unknown, senderIdentityKey: Uint8Array): boolean {
  return verifyEnvelope(envelope, senderIdentityKey, MESSAGE);
}

/** The same server-side check for a document envelope (docs/ADR/0018). Never throws. */
export function verifyDocumentEnvelope(envelope: unknown, senderIdentityKey: Uint8Array): boolean {
  return verifyEnvelope(envelope, senderIdentityKey, DOCUMENT);
}

function verifyEnvelope(envelope: unknown, senderIdentityKey: Uint8Array, format: Format): boolean {
  try {
    const { ct, sig, header } = parseEnvelope(envelope, format);
    return verifyWithLabel(format.signature, concatBytes(header, ct), sig, senderIdentityKey);
  } catch {
    return false;
  }
}

interface OpenInput {
  envelope: unknown;
  senderKey: SenderKey;
  sender: DevicePublicKeys;
}

/** Shape, key and epoch match, signature: everything before the replay window. */
function authenticate({ envelope, senderKey, sender }: OpenInput, format: Format) {
  const parsed = parseEnvelope(envelope, format);
  const { data, ct, sig, header } = parsed;
  if (data.senderDeviceId !== sender.deviceId || data.senderDeviceId !== senderKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'envelope is from another device');
  }
  if (data.circleId !== senderKey.circleId || data.epoch !== senderKey.epoch) {
    throw new BarguCryptoError('KEY_MISMATCH', 'envelope uses another circle or epoch');
  }
  if (!verifyWithLabel(format.signature, concatBytes(header, ct), sig, sender.identityKey)) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid envelope signature');
  }
  return parsed;
}

/** Decryption of an authenticated envelope, up to its JSON (the caller validates it). */
function decryptAuthenticated(
  senderKey: SenderKey,
  { ct, header, salt }: ReturnType<typeof parseEnvelope>,
  format: Format,
): unknown {
  const keyAndNonce = messageKey(senderKey.key, salt, header, format.kdf);
  let padded: Uint8Array;
  try {
    padded = aeadOpen(keyAndNonce, ct, header);
  } finally {
    keyAndNonce.key.fill(0);
  }
  let text: string;
  try {
    // The envelope schema allowed only the format's sizes.
    text = utf8Decode(unpad(padded, padded.length));
  } finally {
    padded.fill(0);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BarguCryptoError('MALFORMED', 'payload is not valid JSON');
  }
}

/** A message's payload, decrypted and validated. */
function decryptPayload(senderKey: SenderKey, parsed: ReturnType<typeof parseEnvelope>): Payload {
  const payload = payloadSchema.safeParse(decryptAuthenticated(senderKey, parsed, MESSAGE));
  if (!payload.success) throw new BarguCryptoError('MALFORMED', 'invalid payload');
  return payload.data;
}

/**
 * Authenticates and decrypts an envelope. Order: shape, key/epoch match, signature, replay window,
 * decryption, payload validation; the replay guard advances only after everything succeeded.
 * Locations are last-write-wins: an authentic location older than one already accepted from the
 * same sender is recorded (so it cannot be replayed) and rejected with `STALE`; other kinds are
 * delivered even when they arrive out of order.
 */
export function decryptMessage(input: OpenInput & { replay: ReplayGuard }): Payload {
  const { senderKey, replay } = input;
  const parsed = authenticate(input, MESSAGE);
  const { data } = parsed;
  const verdict = replay.check(data.circleId, data.senderDeviceId, data.epoch, data.seq);
  if (verdict === 'replay') {
    throw new BarguCryptoError('REPLAY', 'message already seen or too old');
  }
  const payload = decryptPayload(senderKey, parsed);
  replay.accept(data.circleId, data.senderDeviceId, data.epoch, data.seq);
  if (payload.kind === 'loc' && verdict !== 'latest') {
    throw new BarguCryptoError('STALE', 'a newer location from this sender was already accepted');
  }
  return payload;
}

/**
 * Opens a message a circle keeps on the server for later (a place, docs/ADR/0015): the same checks
 * as `decryptMessage` except the replay window, since members open it again and again, long after
 * newer messages from its author. Only `place` payloads are accepted this way; the caller keeps
 * versions in order (a place's `ts` never goes back).
 */
export function decryptStoredMessage(input: OpenInput): PlacePayload {
  const payload = decryptPayload(input.senderKey, authenticate(input, MESSAGE));
  if (payload.kind !== 'place') {
    throw new BarguCryptoError('MALFORMED', 'only places are stored messages');
  }
  return payload;
}

/**
 * Opens a document of a circle (its meeting, a poll, a vote; docs/ADR/0018): the same checks as
 * `decryptStoredMessage`, in the document envelope, and only document payloads. Members open it
 * again and again, so there is no replay window; the caller keeps versions in order (a document's
 * `ts` never goes back).
 */
export function decryptDocument(input: OpenInput): DocPayload {
  const json = decryptAuthenticated(input.senderKey, authenticate(input, DOCUMENT), DOCUMENT);
  const payload = docPayloadSchema.safeParse(json);
  if (!payload.success) throw new BarguCryptoError('MALFORMED', 'invalid document');
  return payload.data;
}

/**
 * The key a sender's pieces of location history are sealed with in an epoch (docs/ADR/0019):
 * HMAC-SHA256(senderKey, "bargu/v1/hist-key" ‖ circleId ‖ epoch ‖ senderDeviceId). Members keep it
 * for a week after the epoch ends, to read that week's history, while the sender key itself goes as
 * soon as the protocol stops accepting its epoch: live locations stay forward secret.
 */
export function historyKeyOf(senderKey: SenderKey): SenderKey {
  return {
    ...senderKey,
    key: hmacWithLabel(
      senderKey.key,
      LABELS.historyKey,
      concatBytes(
        uuidToBytes(senderKey.circleId),
        u32be(senderKey.epoch),
        uuidToBytes(senderKey.senderDeviceId),
      ),
    ),
  };
}

interface HistoryEncryptInput extends Omit<EncryptInput, 'payload'> {
  payload: TrailPayload;
}

/** @internal Deterministic core of `encryptHistory`. */
export function encryptHistoryWith(input: HistoryEncryptInput, salt: Uint8Array): EncryptResult {
  const parsed = trailPayloadSchema.safeParse(input.payload);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid trail');
  const { state } = input;
  const historyKey = historyKeyOf(state.senderKey);
  try {
    const { envelope } = encryptValidated(
      { state: { senderKey: historyKey, nextSeq: state.nextSeq }, sender: input.sender },
      parsed.data,
      HISTORY,
      salt,
    );
    return { envelope, nextState: { senderKey: state.senderKey, nextSeq: state.nextSeq + 1 } };
  } finally {
    historyKey.key.fill(0);
  }
}

/**
 * Seals a quarter hour of this device's trail for a circle (docs/ADR/0019) with the history key of
 * its current sender key, in one of three padded sizes. Persist `nextState` first, as for messages.
 */
export function encryptHistory(input: HistoryEncryptInput): EncryptResult {
  return encryptHistoryWith(input, randomBytes(SALT_BYTES));
}

/** The server-side check for a piece of history (docs/ADR/0019). Never throws. */
export function verifyHistoryEnvelope(envelope: unknown, senderIdentityKey: Uint8Array): boolean {
  return verifyEnvelope(envelope, senderIdentityKey, HISTORY);
}

/**
 * Opens a piece of a member's history with the history key of the epoch it was sealed in: author,
 * circle, epoch and signature checked as for stored messages, no replay window (it is read again
 * and again). The caller checks it is the quarter hour it is filed under.
 */
export function decryptHistory(input: {
  envelope: unknown;
  historyKey: SenderKey;
  sender: DevicePublicKeys;
}): TrailPayload {
  const opened = { envelope: input.envelope, senderKey: input.historyKey, sender: input.sender };
  const json = decryptAuthenticated(input.historyKey, authenticate(opened, HISTORY), HISTORY);
  const payload = trailPayloadSchema.safeParse(json);
  if (!payload.success) throw new BarguCryptoError('MALFORMED', 'invalid trail');
  return payload.data;
}
