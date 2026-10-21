// Signed server notices (docs/ADR/0016, Ek 2026-10-21; docs/PROTOCOL.md §9; QA-28 B-1). The
// server's own news is sealed to the recipient device's DH key, which every member of its circles
// knows: unsigned, any member could seal a "notice" of their own (a `watch` that keeps a friend's
// phone live). Signed with the server's notice key, bound to the recipient device, dated and
// numbered, a phone can tell the server's notices from anyone else's.
import { KEY_BYTES, LABELS, NOTICE_ID_BYTES, SIGNATURE_BYTES } from './constants.js';
import { asciiBytes, concatBytes, readU64be, toBase64url, u64be, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import { signWithLabel, verifyWithLabel } from './primitives.js';
import { parseTrustedKeys, SIGNING_KID, signingPublicKey } from './trusted-keys.js';

/** First byte of a push's inner plaintext for a signed server notice (0x00 unsigned, 0x01 member). */
export const FROM_SERVER_SIGNED = 0x02;
/** Version of the signed layout: its first byte. */
const NOTICE_VERSION = 1;
/**
 * How far ahead of the phone's clock a notice may be dated (PM, QA-28 B-1): a phone a little
 * behind still takes the server's notices; further ahead, it is dropped.
 */
export const NOTICE_MAX_FUTURE_MS = 5 * 60_000;

/** The server's notice key (NOTICE_SIGNING_KEY, an Ed25519 seed) and the id apps know it by. */
export interface NoticeSigner {
  secretKey: Uint8Array;
  kid: string;
}

/** What a signed notice says of itself, once checked (verifyServerNotice). */
export interface ServerNoticeStamp {
  kid: string;
  /** Random for every notice (16 bytes, base64url): a second box with it is a replay. */
  id: string;
  /** When the server signed it (Unix ms); always the notice's own `ts`. */
  issuedAt: number;
}

/** A notice's signature as its box carried it, not checked yet (openPush returns it). */
export interface ServerSignature extends ServerNoticeStamp {
  /** The Ed25519 signature. */
  readonly signature: Uint8Array;
  /** The exact bytes it must cover, bound to the device that opened the box. */
  readonly signed: Uint8Array;
}

interface NoticeHeader {
  kid: string;
  issuedAt: number;
  id: Uint8Array;
}

/**
 * The signed bytes, fixed and unambiguous (not JSON): version(1) ‖ len(kid)(1) ‖ kid ‖
 * recipientDeviceId(16) ‖ issuedAt(8, BE, ms) ‖ id(16) ‖ body. The body (the notice's canonical
 * JSON) comes last, so its length is what remains.
 */
function noticeBytes(header: NoticeHeader, recipientDeviceId: string, body: Uint8Array) {
  const kid = asciiBytes(header.kid);
  return concatBytes(
    Uint8Array.of(NOTICE_VERSION, kid.length),
    kid,
    uuidToBytes(recipientDeviceId),
    u64be(header.issuedAt),
    header.id,
    body,
  );
}

/**
 * A server notice's inner plaintext for one device, signed (the API's push worker, through
 * sealPush): 0x02 ‖ len(kid) ‖ kid ‖ issuedAt(8) ‖ id(16) ‖ sig(64) ‖ body. `body` is the notice's
 * canonical JSON and `issuedAt` its `ts`; `id` must be fresh randomness.
 */
export function signServerNotice(input: {
  signer: NoticeSigner;
  recipientDeviceId: string;
  body: Uint8Array;
  issuedAt: number;
  id: Uint8Array;
}): Uint8Array {
  const { signer } = input;
  if (signer.secretKey.length !== KEY_BYTES) {
    throw new BarguCryptoError('INVALID_KEY', 'notice signing key must be 32 bytes');
  }
  if (!SIGNING_KID.test(signer.kid) || input.id.length !== NOTICE_ID_BYTES) {
    throw new BarguCryptoError('MALFORMED', 'invalid notice key id or notice id');
  }
  const header = { kid: signer.kid, issuedAt: input.issuedAt, id: input.id };
  const signature = signWithLabel(
    LABELS.serverNotice,
    noticeBytes(header, input.recipientDeviceId, input.body),
    signer.secretKey,
  );
  const kid = asciiBytes(signer.kid);
  return concatBytes(
    Uint8Array.of(FROM_SERVER_SIGNED, kid.length),
    kid,
    u64be(input.issuedAt),
    input.id,
    signature,
    input.body,
  );
}

/**
 * Reads a signed notice's inner plaintext (its first byte is 0x02) as the device
 * `recipientDeviceId` opened it: the body bytes and the signature, which is NOT checked here.
 */
export function readServerNotice(
  inner: Uint8Array,
  recipientDeviceId: string,
): { body: Uint8Array; signature: ServerSignature } {
  const kidLength = inner[1] ?? 0;
  const idAt = 2 + kidLength + 8;
  const bodyAt = idAt + NOTICE_ID_BYTES + SIGNATURE_BYTES;
  const kid = String.fromCharCode(...inner.subarray(2, 2 + kidLength));
  if (inner.length <= bodyAt || !SIGNING_KID.test(kid)) {
    throw new BarguCryptoError('MALFORMED', 'invalid server notice');
  }
  const header = {
    kid,
    issuedAt: readU64be(inner.subarray(2 + kidLength, idAt)),
    id: inner.slice(idAt, idAt + NOTICE_ID_BYTES),
  };
  const body = inner.subarray(bodyAt);
  return {
    body,
    signature: Object.freeze({
      kid,
      id: toBase64url(header.id),
      issuedAt: header.issuedAt,
      signature: inner.slice(idAt + NOTICE_ID_BYTES, bodyAt),
      signed: noticeBytes(header, recipientDeviceId, body),
    }),
  };
}

/**
 * Whether an opened push is a notice the server really sent to this device (QA-28 B-1): signed by
 * a key this app trusts (`keys`, from its build: EXPO_PUBLIC_NOTICE_KEYS), for the device that
 * opened it, not older than `maxAgeMs` nor dated more than NOTICE_MAX_FUTURE_MS ahead, and with
 * an id `seen` does not know. Its stamp, or null for
 * anything else: an unsigned notice, a member's push, a key it does not know, a wrong signature, a
 * stale or replayed one. Never throws: a notice that cannot be checked is dropped without a word.
 * The signature travels as raw bytes inside the sealed box, so no text form can be non-canonical.
 */
export function verifyServerNotice(
  opened: {
    senderDeviceId: string | null;
    body: { kind: string };
    serverSignature: ServerSignature | null;
  },
  input: {
    keys: ReadonlyMap<string, Uint8Array>;
    now: number;
    maxAgeMs: number;
    seen?: (id: string) => boolean;
  },
): ServerNoticeStamp | null {
  try {
    const signed = opened.serverSignature;
    if (signed === null || opened.senderDeviceId !== null || opened.body.kind !== 'notice') {
      return null;
    }
    const age = input.now - signed.issuedAt;
    if (age > input.maxAgeMs || -age > NOTICE_MAX_FUTURE_MS || input.seen?.(signed.id) === true) {
      return null;
    }
    const key = input.keys.get(signed.kid);
    if (key === undefined) return null;
    return verifyWithLabel(LABELS.serverNotice, signed.signed, signed.signature, key)
      ? { kid: signed.kid, id: signed.id, issuedAt: signed.issuedAt }
      : null;
  } catch {
    return null;
  }
}

/** The public half of NOTICE_SIGNING_KEY, for the apps' EXPO_PUBLIC_NOTICE_KEYS. */
export const noticePublicKey = signingPublicKey;

/**
 * The notice keys an app trusts, from its build's configuration: `kid:base64url` pairs separated
 * by commas (EXPO_PUBLIC_NOTICE_KEYS). An entry that is not a valid key is left out.
 */
export const parseNoticeKeys = parseTrustedKeys;
