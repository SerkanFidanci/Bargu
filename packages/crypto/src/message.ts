import {
  messageEnvelopeSchema,
  payloadSchema,
  type MessageEnvelope,
  type Payload,
} from '@bargu/schemas';

import {
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
 * Per-message key and nonce: HKDF-SHA256(senderKey, salt, "bargu/v1/msg" ‖ header). Each message
 * gets its own key, so loss or reordering never blocks decryption (O(1), no ratchet state), and the
 * random salt keeps keys unique even if a sequence number were ever reused.
 */
function messageKey(senderKey: Uint8Array, salt: Uint8Array, header: Uint8Array) {
  return deriveKeyAndNonce(senderKey, salt, LABELS.messageKdf, header);
}

interface EncryptInput {
  state: SenderState;
  sender: DeviceKeys;
  payload: Payload;
}

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
  const keyAndNonce = messageKey(senderKey.key, salt, header);
  const ct = aeadSeal(keyAndNonce, paddedPlaintext, header);
  keyAndNonce.key.fill(0);
  const sig = signWithLabel(
    LABELS.messageSignature,
    concatBytes(header, ct),
    sender.identity.secretKey,
  );

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

/** @internal Deterministic core; `salt` must be fresh randomness in production. */
export function encryptMessageWith(input: EncryptInput, salt: Uint8Array): EncryptResult {
  const parsed = payloadSchema.safeParse(input.payload);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid payload');
  const plaintext = pad(
    utf8Encode(JSON.stringify(parsed.data)),
    MESSAGE_PADDED_BYTES,
    MESSAGE_PADDED_BYTES,
  );
  try {
    return encryptPaddedWith(input, plaintext, salt);
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Encrypts and signs one payload for the whole circle (one envelope, every member decrypts it with
 * this device's sender key). Location precision must already be applied (`applyPrecision`).
 */
export function encryptMessage(input: EncryptInput): EncryptResult {
  return encryptMessageWith(input, randomBytes(SALT_BYTES));
}

function parseEnvelope(envelope: unknown) {
  const parsed = messageEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid message envelope');
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
  try {
    const { ct, sig, header } = parseEnvelope(envelope);
    return verifyWithLabel(
      LABELS.messageSignature,
      concatBytes(header, ct),
      sig,
      senderIdentityKey,
    );
  } catch {
    return false;
  }
}

/**
 * Authenticates and decrypts an envelope. Order: shape, key/epoch match, signature, replay window,
 * decryption, payload validation; the replay guard advances only after everything succeeded.
 * Locations are last-write-wins: an authentic location older than one already accepted from the
 * same sender is recorded (so it cannot be replayed) and rejected with `STALE`; other kinds are
 * delivered even when they arrive out of order.
 */
export function decryptMessage(input: {
  envelope: unknown;
  senderKey: SenderKey;
  sender: DevicePublicKeys;
  replay: ReplayGuard;
}): Payload {
  const { senderKey, sender, replay } = input;
  const { data, ct, sig, header, salt } = parseEnvelope(input.envelope);

  if (data.senderDeviceId !== sender.deviceId || data.senderDeviceId !== senderKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'envelope is from another device');
  }
  if (data.circleId !== senderKey.circleId || data.epoch !== senderKey.epoch) {
    throw new BarguCryptoError('KEY_MISMATCH', 'envelope uses another circle or epoch');
  }
  if (!verifyWithLabel(LABELS.messageSignature, concatBytes(header, ct), sig, sender.identityKey)) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid envelope signature');
  }
  const verdict = replay.check(data.circleId, data.senderDeviceId, data.epoch, data.seq);
  if (verdict === 'replay') {
    throw new BarguCryptoError('REPLAY', 'message already seen or too old');
  }

  const keyAndNonce = messageKey(senderKey.key, salt, header);
  let padded: Uint8Array;
  try {
    padded = aeadOpen(keyAndNonce, ct, header);
  } finally {
    keyAndNonce.key.fill(0);
  }
  let text: string;
  try {
    text = utf8Decode(unpad(padded, MESSAGE_PADDED_BYTES));
  } finally {
    padded.fill(0);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BarguCryptoError('MALFORMED', 'payload is not valid JSON');
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) throw new BarguCryptoError('MALFORMED', 'invalid payload');

  replay.accept(data.circleId, data.senderDeviceId, data.epoch, data.seq);
  if (payload.data.kind === 'loc' && verdict !== 'latest') {
    throw new BarguCryptoError('STALE', 'a newer location from this sender was already accepted');
  }
  return payload.data;
}
