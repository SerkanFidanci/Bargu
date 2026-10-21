import { pushBodySchema, type PushBody } from '@bargu/schemas';

import { ID_BYTES, KEY_BYTES, LABELS, NOTICE_ID_BYTES, SIGNATURE_BYTES } from './constants.js';
import { bytesToUuid, concatBytes, utf8Decode, utf8Encode, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import type { DeviceKeys } from './keys.js';
import { randomBytes, signWithLabel, verifyWithLabel } from './primitives.js';
import { openSealed, sealForDeviceWith } from './sealed.js';
import {
  FROM_SERVER_SIGNED,
  type NoticeSigner,
  readServerNotice,
  type ServerSignature,
  signServerNotice,
} from './server-notice.js';

/**
 * First byte of a push's inner plaintext: who stands behind it. A server notice is signed (0x02,
 * server-notice.ts) when the server has a notice key, unsigned (0x00) otherwise.
 */
const FROM_SERVER = 0x00;
const FROM_DEVICE = 0x01;
const SIGNED_HEADER_BYTES = 1 + ID_BYTES + SIGNATURE_BYTES;

/** The device a push is sealed for: its id (bound into the signature) and its DH key. */
export interface PushRecipient {
  deviceId: string;
  dhKey: Uint8Array;
}

export interface OpenedPush {
  /** The member device that signed it; null for a server notice. */
  senderDeviceId: string | null;
  body: PushBody;
  /**
   * A server notice's signature as its box carried it (docs/ADR/0016, Ek 2026-10-21): null for an
   * unsigned notice and for a member's push. Not checked here: verifyServerNotice does.
   */
  serverSignature: ServerSignature | null;
}

function bodyBytes(body: PushBody): Uint8Array {
  const parsed = pushBodySchema.safeParse(body);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid push body');
  return utf8Encode(JSON.stringify(parsed.data));
}

/** What the sending device signs: recipient and sender bound to the body (no re-addressing). */
function signedPart(recipientDeviceId: string, senderDeviceId: string, body: Uint8Array) {
  return concatBytes(uuidToBytes(recipientDeviceId), uuidToBytes(senderDeviceId), body);
}

/**
 * @internal Deterministic core; the ephemeral secret and the notice id must be fresh randomness in
 * production.
 */
export function sealPushWith(
  input: {
    recipient: PushRecipient;
    sender: DeviceKeys | null;
    body: PushBody;
    signer?: NoticeSigner | null;
  },
  ephemeralSecretKey: Uint8Array,
  noticeId: Uint8Array,
): string {
  const { recipient, sender, body } = input;
  const signer = input.signer ?? null;
  // Notices are the server's own news; everything a member says is signed by their device.
  if ((sender === null) !== (body.kind === 'notice') || (sender !== null && signer !== null)) {
    throw new BarguCryptoError('MALFORMED', 'notices come from the server, the rest from devices');
  }
  const json = bodyBytes(body);
  let inner: Uint8Array;
  if (sender === null) {
    // The notice's own time is the one signed: a single clock for freshness.
    inner =
      signer === null
        ? concatBytes(Uint8Array.of(FROM_SERVER), json)
        : signServerNotice({
            signer,
            recipientDeviceId: recipient.deviceId,
            body: json,
            issuedAt: body.ts,
            id: noticeId,
          });
  } else {
    const signature = signWithLabel(
      LABELS.pushSignature,
      signedPart(recipient.deviceId, sender.deviceId, json),
      sender.identity.secretKey,
    );
    inner = concatBytes(Uint8Array.of(FROM_DEVICE), uuidToBytes(sender.deviceId), signature, json);
  }
  return sealForDeviceWith(recipient.dhKey, inner, ephemeralSecretKey);
}

/**
 * Seals what a notification says for one device (docs/PROTOCOL.md §9): a sealed box (only that
 * device opens it, Google and Apple see ciphertext of a padded size) around the body, signed by
 * the sending member's device, or for a server notice by the server's notice key (`signer`; a
 * server without one seals it unsigned). Openable by the iOS Notification Service Extension with
 * CryptoKit alone.
 */
export function sealPush(input: {
  recipient: PushRecipient;
  sender: DeviceKeys | null;
  body: PushBody;
  signer?: NoticeSigner | null;
}): string {
  const ephemeralSecretKey = randomBytes(KEY_BYTES);
  try {
    return sealPushWith(input, ephemeralSecretKey, randomBytes(NOTICE_ID_BYTES));
  } finally {
    ephemeralSecretKey.fill(0);
  }
}

/**
 * Opens a push sealed for this device. A member's push must be signed by the identity key the app
 * already trusts for that device (`senderIdentityKey` returns null for devices it does not know)
 * and can never be a notice; a server push can only be a notice. A notice's signature comes back
 * unchecked: only verifyServerNotice tells a real one from a member's forgery. Freshness and
 * duplicates are the caller's (the body carries `ts`).
 */
export function openPush(input: {
  recipient: DeviceKeys;
  sealed: string;
  senderIdentityKey: (deviceId: string) => Uint8Array | null;
}): OpenedPush {
  const inner = openSealed(input.recipient, input.sealed);
  let senderDeviceId: string | null = null;
  let serverSignature: ServerSignature | null = null;
  let json: Uint8Array;
  if (inner[0] === FROM_SERVER) {
    json = inner.subarray(1);
  } else if (inner[0] === FROM_SERVER_SIGNED) {
    const notice = readServerNotice(inner, input.recipient.deviceId);
    json = notice.body;
    serverSignature = notice.signature;
  } else if (inner[0] === FROM_DEVICE && inner.length > SIGNED_HEADER_BYTES) {
    senderDeviceId = bytesToUuid(inner.subarray(1, 1 + ID_BYTES));
    const signature = inner.subarray(1 + ID_BYTES, SIGNED_HEADER_BYTES);
    json = inner.subarray(SIGNED_HEADER_BYTES);
    const identityKey = input.senderIdentityKey(senderDeviceId);
    if (identityKey === null) {
      throw new BarguCryptoError('KEY_MISMATCH', 'push from a device this phone does not know');
    }
    const signed = signedPart(input.recipient.deviceId, senderDeviceId, json);
    if (!verifyWithLabel(LABELS.pushSignature, signed, signature, identityKey)) {
      throw new BarguCryptoError('BAD_SIGNATURE', 'invalid push signature');
    }
  } else {
    throw new BarguCryptoError('MALFORMED', 'invalid push');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(json));
  } catch (error) {
    if (error instanceof BarguCryptoError) throw error;
    throw new BarguCryptoError('MALFORMED', 'push body is not valid JSON');
  }
  const body = pushBodySchema.safeParse(parsed);
  if (
    !body.success ||
    (senderDeviceId === null) !== (body.data.kind === 'notice') ||
    (serverSignature !== null && serverSignature.issuedAt !== body.data.ts)
  ) {
    throw new BarguCryptoError('MALFORMED', 'invalid push body');
  }
  return { senderDeviceId, body: body.data, serverSignature };
}
