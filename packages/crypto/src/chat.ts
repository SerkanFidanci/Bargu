import {
  CHAT_LIFETIME_MS,
  CHAT_PADDED_SIZES,
  CHAT_PHOTO_MAX_BYTES,
  chatEnvelopeSchema,
  chatPayloadSchema,
  directEnvelopeSchema,
  type ChatEnvelope,
  type ChatPayload,
  type DirectEnvelope,
} from '@bargu/schemas';

import {
  KEY_BYTES,
  type Label,
  LABELS,
  NONCE_BYTES,
  PROTOCOL_VERSION,
  SALT_BYTES,
  SIGNATURE_BYTES,
  TAG_BYTES,
} from './constants.js';
import {
  concatBytes,
  fromBase64url,
  labelBytes,
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
  type KeyAndNonce,
  randomBytes,
  sha256Hash,
  signWithLabel,
  verifyWithLabel,
  x25519PublicKey,
  x25519SharedSecret,
} from './primitives.js';
import type { SenderKey } from './sender-key.js';

// Messages and moments (docs/ADR/0035, docs/PROTOCOL.md §6): items for a circle or for one person
// and their photo files. Every item and file carries a commitment to the one key that opens it,
// covered by the signature, so a report can prove what was sent (§9 of the ADR).

/** An item dated further ahead than this is dropped, as for every other message. */
export const CHAT_MAX_FUTURE_MS = 5 * 60 * 1000;
const COMMIT_BYTES = 32;

/** The key and nonce of one item, as a report carries them (base64url). */
export interface ItemKey {
  key: string;
  nonce: string;
}

/**
 * SHA-256(label ‖ key ‖ nonce). ChaCha20-Poly1305 does not bind a ciphertext to one key; this does,
 * through SHA-256's collision resistance, so "this key opens this item" holds without relying on
 * Poly1305 (docs/ADR/0035 §2).
 */
function commitTo(label: Label, { key, nonce }: KeyAndNonce): Uint8Array {
  return sha256Hash(concatBytes(labelBytes(label), key, nonce));
}

/** Equal 32-byte digests (every caller compares two SHA-256 outputs or checked lengths). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.every((byte, index) => byte === b[index]);
}

/**
 * The key a sender's items for a circle are sealed with in an epoch: HMAC-SHA256(senderKey,
 * "bargu/v1/chat-key" ‖ circleId ‖ epoch ‖ senderDeviceId). Never the key of a location. Members
 * keep it 25 hours after its epoch ends, so a phone that was off for a day still opens what was sent
 * meanwhile, while the sender key itself goes when the protocol stops accepting its epoch.
 */
export function chatKeyOf(senderKey: SenderKey): SenderKey {
  return {
    ...senderKey,
    key: hmacWithLabel(
      senderKey.key,
      LABELS.chatKey,
      concatBytes(
        uuidToBytes(senderKey.circleId),
        u32be(senderKey.epoch),
        uuidToBytes(senderKey.senderDeviceId),
      ),
    ),
  };
}

/**
 * A payload, validated, as JSON padded to the smaller size that fits. The longest valid item (1000
 * characters that JSON writes as six bytes each) still fits the larger one.
 */
function paddedPayload(payload: ChatPayload): { plaintext: Uint8Array; id: string } {
  const parsed = chatPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid item');
  const json = utf8Encode(JSON.stringify(parsed.data));
  const [short, long] = CHAT_PADDED_SIZES;
  const size = json.length < short ? short : long;
  return { plaintext: pad(json, size, size), id: parsed.data.id };
}

/**
 * Commitment check, decryption, padding, JSON and schema; the item must be the one its header names.
 * Shared by phones and by the server's report check.
 */
function openItem(
  keyAndNonce: KeyAndNonce,
  sealed: { header: Uint8Array; commit: Uint8Array; ct: Uint8Array; id: string },
  commitLabel: Label,
): ChatPayload {
  if (!sameBytes(commitTo(commitLabel, keyAndNonce), sealed.commit)) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'the key does not match the item');
  }
  const padded = aeadOpen(keyAndNonce, sealed.ct, sealed.header);
  let text: string;
  try {
    // The envelope schema allowed only the chat sizes.
    text = utf8Decode(unpad(padded, padded.length));
  } finally {
    padded.fill(0);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BarguCryptoError('MALFORMED', 'item is not valid JSON');
  }
  const payload = chatPayloadSchema.safeParse(json);
  if (!payload.success) throw new BarguCryptoError('MALFORMED', 'invalid item');
  if (payload.data.id !== sealed.id) {
    throw new BarguCryptoError('MALFORMED', 'item id does not match its header');
  }
  return payload.data;
}

/** Items live 24 hours (docs/ADR/0035 §2, §7): an older one, or one dated ahead, is dropped. */
function fresh(payload: ChatPayload, now: number): ChatPayload {
  if (payload.ts < now - CHAT_LIFETIME_MS || payload.ts > now + CHAT_MAX_FUTURE_MS) {
    throw new BarguCryptoError('REPLAY', 'item is older than 24 hours or dated ahead');
  }
  return payload;
}

// --- Items for a circle -------------------------------------------------------------------------

interface ChatBaseFields {
  circleId: string;
  epoch: number;
  senderDeviceId: string;
  id: string;
  salt: Uint8Array;
}

/** version(1) ‖ circleId(16) ‖ epoch(u32 BE) ‖ senderDeviceId(16) ‖ id(16) ‖ salt(16): 69 bytes. */
function chatBase(fields: ChatBaseFields): Uint8Array {
  return concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    uuidToBytes(fields.circleId),
    u32be(fields.epoch),
    uuidToBytes(fields.senderDeviceId),
    uuidToBytes(fields.id),
    fields.salt,
  );
}

/** The item's key and nonce come from the header without the commitment, which they produce. */
function chatItemKey(chatKey: Uint8Array, salt: Uint8Array, base: Uint8Array): KeyAndNonce {
  return deriveKeyAndNonce(chatKey, salt, LABELS.chatKdf, base);
}

interface ChatEncryptInput {
  senderKey: SenderKey;
  sender: DeviceKeys;
  payload: ChatPayload;
}

/**
 * @internal Seals already padded bytes. Exposed only so tests can model a malicious sender that
 * signs well-formed items around an invalid plaintext or a false commitment (`commit`).
 */
export function encryptChatPaddedWith(
  { senderKey, sender }: Omit<ChatEncryptInput, 'payload'>,
  plaintext: Uint8Array,
  id: string,
  salt: Uint8Array,
  commitOf: (keyAndNonce: KeyAndNonce) => Uint8Array = (keyAndNonce) =>
    commitTo(LABELS.chatCommit, keyAndNonce),
): ChatEnvelope {
  if (sender.deviceId !== senderKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'sender key belongs to another device');
  }
  const fields = {
    circleId: senderKey.circleId,
    epoch: senderKey.epoch,
    senderDeviceId: senderKey.senderDeviceId,
    id,
    salt,
  };
  const base = chatBase(fields);
  const chatKey = chatKeyOf(senderKey);
  const keyAndNonce = chatItemKey(chatKey.key, salt, base);
  chatKey.key.fill(0);
  const commit = commitOf(keyAndNonce);
  const header = concatBytes(base, commit);
  let ct: Uint8Array;
  try {
    ct = aeadSeal(keyAndNonce, plaintext, header);
  } finally {
    keyAndNonce.key.fill(0);
  }
  const sig = signWithLabel(
    LABELS.chatSignature,
    concatBytes(header, ct),
    sender.identity.secretKey,
  );
  return {
    v: PROTOCOL_VERSION,
    circleId: fields.circleId,
    epoch: fields.epoch,
    senderDeviceId: fields.senderDeviceId,
    id,
    salt: toBase64url(salt),
    commit: toBase64url(commit),
    ct: toBase64url(ct),
    sig: toBase64url(sig),
  };
}

/** @internal Deterministic core of `encryptChat`; `salt` must be fresh randomness in production. */
export function encryptChatWith(input: ChatEncryptInput, salt: Uint8Array): ChatEnvelope {
  const { plaintext, id } = paddedPayload(input.payload);
  try {
    return encryptChatPaddedWith(input, plaintext, id, salt);
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Seals an item for a whole circle (docs/ADR/0035 §2): one envelope, every member opens it with the
 * chat key of this device's sender key. No sequence number: the item's random id names it.
 */
export function encryptChat(input: ChatEncryptInput): ChatEnvelope {
  return encryptChatWith(input, randomBytes(SALT_BYTES));
}

function parseChat(envelope: unknown) {
  const parsed = chatEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid item envelope');
  const data = parsed.data;
  const salt = fromBase64url(data.salt, SALT_BYTES);
  const commit = fromBase64url(data.commit, COMMIT_BYTES);
  const base = chatBase({ ...data, salt });
  return {
    data,
    salt,
    base,
    commit,
    header: concatBytes(base, commit),
    ct: fromBase64url(data.ct),
    sig: fromBase64url(data.sig, SIGNATURE_BYTES),
    id: data.id,
  };
}

/**
 * Server-side relay check: well-formed and signed by the claimed sender device (the server also
 * checks its membership and the epoch). Never throws.
 */
export function verifyChatEnvelope(envelope: unknown, senderIdentityKey: Uint8Array): boolean {
  try {
    const { header, ct, sig } = parseChat(envelope);
    return verifyWithLabel(LABELS.chatSignature, concatBytes(header, ct), sig, senderIdentityKey);
  } catch {
    return false;
  }
}

interface ChatOpenInput {
  envelope: unknown;
  /** The chat key of the sender's sender key for the item's epoch (`chatKeyOf`). */
  chatKey: SenderKey;
  sender: DevicePublicKeys;
}

/** Shape, sender, circle and epoch, signature: everything before a secret is used. */
function authenticateChat({ envelope, chatKey, sender }: ChatOpenInput) {
  const parsed = parseChat(envelope);
  const { data, header, ct, sig } = parsed;
  if (data.senderDeviceId !== sender.deviceId || data.senderDeviceId !== chatKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'item is from another device');
  }
  if (data.circleId !== chatKey.circleId || data.epoch !== chatKey.epoch) {
    throw new BarguCryptoError('KEY_MISMATCH', 'item uses another circle or epoch');
  }
  if (!verifyWithLabel(LABELS.chatSignature, concatBytes(header, ct), sig, sender.identityKey)) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid item signature');
  }
  return parsed;
}

/**
 * Opens an item of a circle. Order: shape, sender and key match, signature, key commitment,
 * decryption, payload, its id, then the 24-hour clock. There is no replay window: the caller shows
 * an id once (the server never stores an id twice) and drops what is older than 24 hours.
 */
export function decryptChat(input: ChatOpenInput & { now: number }): ChatPayload {
  const parsed = authenticateChat(input);
  const keyAndNonce = chatItemKey(input.chatKey.key, parsed.salt, parsed.base);
  try {
    return fresh(openItem(keyAndNonce, parsed, LABELS.chatCommit), input.now);
  } finally {
    keyAndNonce.key.fill(0);
  }
}

/**
 * The key and nonce of one item of a circle, for a report (docs/ADR/0035 §9): only of an item this
 * phone could open, and nothing but that item's own key (never the chat or sender key).
 */
export function revealChatItem(input: ChatOpenInput): ItemKey {
  const parsed = authenticateChat(input);
  const keyAndNonce = chatItemKey(input.chatKey.key, parsed.salt, parsed.base);
  try {
    openItem(keyAndNonce, parsed, LABELS.chatCommit);
    return { key: toBase64url(keyAndNonce.key), nonce: toBase64url(keyAndNonce.nonce) };
  } finally {
    keyAndNonce.key.fill(0);
  }
}

// --- Items for one person -----------------------------------------------------------------------

interface DirectBaseFields {
  senderDeviceId: string;
  recipientDeviceId: string;
  id: string;
  ephemeralKey: Uint8Array;
}

/** version(1) ‖ senderDeviceId(16) ‖ recipientDeviceId(16) ‖ id(16) ‖ ephemeralKey(32): 81 bytes. */
function directBase(fields: DirectBaseFields): Uint8Array {
  return concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    uuidToBytes(fields.senderDeviceId),
    uuidToBytes(fields.recipientDeviceId),
    uuidToBytes(fields.id),
    fields.ephemeralKey,
  );
}

function directItemKey(
  sharedSecret: Uint8Array,
  ephemeralKey: Uint8Array,
  recipientDhKey: Uint8Array,
  base: Uint8Array,
): KeyAndNonce {
  return deriveKeyAndNonce(
    sharedSecret,
    concatBytes(ephemeralKey, recipientDhKey),
    LABELS.directKdf,
    base,
  );
}

interface DirectSealInput {
  sender: DeviceKeys;
  recipient: DevicePublicKeys;
  payload: ChatPayload;
}

/** @internal Seals already padded bytes for one person; for tests of a malicious sender. */
export function sealDirectPaddedWith(
  { sender, recipient }: Omit<DirectSealInput, 'payload'>,
  plaintext: Uint8Array,
  id: string,
  ephemeralSecretKey: Uint8Array,
  commitOf: (keyAndNonce: KeyAndNonce) => Uint8Array = (keyAndNonce) =>
    commitTo(LABELS.directCommit, keyAndNonce),
): DirectEnvelope {
  const ephemeralKey = x25519PublicKey(ephemeralSecretKey);
  const fields = {
    senderDeviceId: sender.deviceId,
    recipientDeviceId: recipient.deviceId,
    id,
    ephemeralKey,
  };
  const base = directBase(fields);
  const sharedSecret = x25519SharedSecret(ephemeralSecretKey, recipient.dhKey);
  const keyAndNonce = directItemKey(sharedSecret, ephemeralKey, recipient.dhKey, base);
  sharedSecret.fill(0);
  const commit = commitOf(keyAndNonce);
  const header = concatBytes(base, commit);
  let ct: Uint8Array;
  try {
    ct = aeadSeal(keyAndNonce, plaintext, header);
  } finally {
    keyAndNonce.key.fill(0);
  }
  const sig = signWithLabel(
    LABELS.directSignature,
    concatBytes(header, ct),
    sender.identity.secretKey,
  );
  return {
    v: PROTOCOL_VERSION,
    senderDeviceId: fields.senderDeviceId,
    recipientDeviceId: fields.recipientDeviceId,
    id,
    ephemeralKey: toBase64url(ephemeralKey),
    commit: toBase64url(commit),
    ct: toBase64url(ct),
    sig: toBase64url(sig),
  };
}

/** @internal Deterministic core of `sealDirect`; the ephemeral secret must be fresh randomness. */
export function sealDirectWith(
  input: DirectSealInput,
  ephemeralSecretKey: Uint8Array,
): DirectEnvelope {
  const { plaintext, id } = paddedPayload(input.payload);
  try {
    return sealDirectPaddedWith(input, plaintext, id, ephemeralSecretKey);
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Seals an item for one person's device (docs/ADR/0035 §3): a fresh X25519 key per item, as a sender
 * key is distributed, signed by this device. The sender keeps its own copy on the phone.
 */
export function sealDirect(input: DirectSealInput): DirectEnvelope {
  const ephemeralSecretKey = randomBytes(KEY_BYTES);
  try {
    return sealDirectWith(input, ephemeralSecretKey);
  } finally {
    ephemeralSecretKey.fill(0);
  }
}

function parseDirect(envelope: unknown) {
  const parsed = directEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid item envelope');
  const data = parsed.data;
  const ephemeralKey = fromBase64url(data.ephemeralKey, KEY_BYTES);
  const commit = fromBase64url(data.commit, COMMIT_BYTES);
  const base = directBase({ ...data, ephemeralKey });
  return {
    data,
    ephemeralKey,
    base,
    commit,
    header: concatBytes(base, commit),
    ct: fromBase64url(data.ct),
    sig: fromBase64url(data.sig, SIGNATURE_BYTES),
    id: data.id,
  };
}

/** Server-side relay check of an item for one person. Never throws. */
export function verifyDirectEnvelope(envelope: unknown, senderIdentityKey: Uint8Array): boolean {
  try {
    const { header, ct, sig } = parseDirect(envelope);
    return verifyWithLabel(LABELS.directSignature, concatBytes(header, ct), sig, senderIdentityKey);
  } catch {
    return false;
  }
}

interface DirectOpenInput {
  envelope: unknown;
  recipient: DeviceKeys;
  /** A device of someone this phone shares a circle with, whose identity key it trusts. */
  sender: DevicePublicKeys;
}

function authenticateDirect({ envelope, recipient, sender }: DirectOpenInput) {
  const parsed = parseDirect(envelope);
  const { data, header, ct, sig } = parsed;
  if (data.senderDeviceId !== sender.deviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'item is from another device');
  }
  if (data.recipientDeviceId !== recipient.deviceId) {
    throw new BarguCryptoError('WRONG_RECIPIENT', 'item is addressed to another device');
  }
  if (!verifyWithLabel(LABELS.directSignature, concatBytes(header, ct), sig, sender.identityKey)) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid item signature');
  }
  return parsed;
}

function directKeyOf(
  recipient: DeviceKeys,
  parsed: ReturnType<typeof authenticateDirect>,
): KeyAndNonce {
  const sharedSecret = x25519SharedSecret(recipient.dh.secretKey, parsed.ephemeralKey);
  try {
    return directItemKey(sharedSecret, parsed.ephemeralKey, recipient.dh.publicKey, parsed.base);
  } finally {
    sharedSecret.fill(0);
  }
}

/**
 * Opens an item sent to this device. Order: shape, sender and recipient, signature, X25519 (low
 * order refused), key commitment, decryption, payload, its id, the 24-hour clock.
 */
export function openDirect(input: DirectOpenInput & { now: number }): ChatPayload {
  const parsed = authenticateDirect(input);
  const keyAndNonce = directKeyOf(input.recipient, parsed);
  try {
    return fresh(openItem(keyAndNonce, parsed, LABELS.directCommit), input.now);
  } finally {
    keyAndNonce.key.fill(0);
  }
}

/** The key and nonce of one item sent to this device, for a report (docs/ADR/0035 §9). */
export function revealDirectItem(input: DirectOpenInput): ItemKey {
  const parsed = authenticateDirect(input);
  const keyAndNonce = directKeyOf(input.recipient, parsed);
  try {
    openItem(keyAndNonce, parsed, LABELS.directCommit);
    return { key: toBase64url(keyAndNonce.key), nonce: toBase64url(keyAndNonce.nonce) };
  } finally {
    keyAndNonce.key.fill(0);
  }
}

// --- Reports (server) ---------------------------------------------------------------------------

/**
 * The server's check of a reported item (docs/ADR/0035 §9): the sender device's signature, then
 * the key commitment of the key and nonce the reporter gave, then decryption and the payload. What
 * comes out is what that device sent: the signature covers the commitment, and a second key that
 * matches it would be a SHA-256 collision. Throws when anything fails.
 */
export function openReportedItem(input: {
  envelope: unknown;
  key: string;
  nonce: string;
  senderIdentityKey: Uint8Array;
}): ChatPayload {
  // A circle's item names its circle, one for a person their device: the shapes never overlap.
  const isChat = chatEnvelopeSchema.safeParse(input.envelope).success;
  const parsed = isChat ? parseChat(input.envelope) : parseDirect(input.envelope);
  const signature = isChat ? LABELS.chatSignature : LABELS.directSignature;
  if (
    !verifyWithLabel(
      signature,
      concatBytes(parsed.header, parsed.ct),
      parsed.sig,
      input.senderIdentityKey,
    )
  ) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid item signature');
  }
  const keyAndNonce = {
    key: fromBase64url(input.key, KEY_BYTES),
    nonce: fromBase64url(input.nonce, NONCE_BYTES),
  };
  try {
    return openItem(keyAndNonce, parsed, isChat ? LABELS.chatCommit : LABELS.directCommit);
  } finally {
    keyAndNonce.key.fill(0);
  }
}

// --- Photo files --------------------------------------------------------------------------------

/** version(1) ‖ nonce(12) ‖ commitment(32) */
const PHOTO_HEAD_BYTES = 1 + NONCE_BYTES + COMMIT_BYTES;

function photoAad(blobId: string, head: Uint8Array): Uint8Array {
  return concatBytes(labelBytes(LABELS.photoFile), uuidToBytes(blobId), head);
}

/** @internal Deterministic core of `sealChatPhoto`; `nonce` must be fresh randomness. */
export function sealChatPhotoWith(
  key: Uint8Array,
  blobId: string,
  image: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
  if (image.length === 0 || PHOTO_HEAD_BYTES + image.length + TAG_BYTES > CHAT_PHOTO_MAX_BYTES) {
    throw new BarguCryptoError('PAYLOAD_TOO_LARGE', 'photo too large or empty');
  }
  const keyAndNonce = { key, nonce };
  const head = concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    nonce,
    commitTo(LABELS.photoCommit, keyAndNonce),
  );
  return concatBytes(head, aeadSeal(keyAndNonce, image, photoAad(blobId, head)));
}

/**
 * Seals a photo for upload (docs/ADR/0035 §4) with its own one-time key (`generatePhotoKey`): the
 * file names its id and commits to its key. The item that shares the key carries the file's SHA-256
 * (`photoHashOf`).
 */
export function sealChatPhoto(key: Uint8Array, blobId: string, image: Uint8Array): Uint8Array {
  return sealChatPhotoWith(key, blobId, image, randomBytes(NONCE_BYTES));
}

/** The SHA-256 of a sealed file, as its item carries it. */
export function photoHashOf(sealed: Uint8Array): string {
  return toBase64url(sha256Hash(sealed));
}

/**
 * Opens a downloaded photo: it must be the file its item names (hash), then its key commitment,
 * then decryption with its id authenticated. Throws if anything does not match.
 */
export function openChatPhoto(input: {
  key: Uint8Array;
  blobId: string;
  hash: string;
  sealed: Uint8Array;
}): Uint8Array {
  const { key, sealed } = input;
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
  if (
    sealed.length < PHOTO_HEAD_BYTES + TAG_BYTES ||
    sealed.length > CHAT_PHOTO_MAX_BYTES ||
    sealed[0] !== PROTOCOL_VERSION
  ) {
    throw new BarguCryptoError('MALFORMED', 'invalid sealed photo');
  }
  if (!sameBytes(sha256Hash(sealed), fromBase64url(input.hash, COMMIT_BYTES))) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'the file is not the one its item names');
  }
  const head = sealed.subarray(0, PHOTO_HEAD_BYTES);
  const keyAndNonce = { key, nonce: head.subarray(1, 1 + NONCE_BYTES) };
  if (!sameBytes(commitTo(LABELS.photoCommit, keyAndNonce), head.subarray(1 + NONCE_BYTES))) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'the key does not match the file');
  }
  return aeadOpen(keyAndNonce, sealed.subarray(PHOTO_HEAD_BYTES), photoAad(input.blobId, head));
}
