import { senderKeyDistributionSchema, type SenderKeyDistribution } from '@bargu/schemas';

import { KEY_BYTES, LABELS, PROTOCOL_VERSION, SIGNATURE_BYTES, TAG_BYTES } from './constants.js';
import { concatBytes, fromBase64url, toBase64url, u32be, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import type { DeviceKeys, DevicePublicKeys } from './keys.js';
import {
  aeadOpen,
  aeadSeal,
  deriveKeyAndNonce,
  randomBytes,
  signWithLabel,
  verifyWithLabel,
  x25519PublicKey,
  x25519SharedSecret,
} from './primitives.js';

/**
 * A sender key: 32 random bytes owned by one member device for one circle and epoch. Every message
 * that device sends to the circle in that epoch is keyed from it.
 */
export interface SenderKey {
  readonly circleId: string;
  readonly epoch: number;
  readonly senderDeviceId: string;
  readonly key: Uint8Array;
}

export function generateSenderKey(input: {
  circleId: string;
  epoch: number;
  senderDeviceId: string;
}): SenderKey {
  // Validate ids and epoch up front so a bad key can never be distributed.
  uuidToBytes(input.circleId);
  uuidToBytes(input.senderDeviceId);
  u32be(input.epoch);
  return { ...input, key: randomBytes(KEY_BYTES) };
}

interface DistributionHeaderFields {
  circleId: string;
  epoch: number;
  senderDeviceId: string;
  recipientDeviceId: string;
  ephemeralKey: Uint8Array;
}

/** version(1) ‖ circleId(16) ‖ epoch(u32 BE) ‖ senderDeviceId(16) ‖ recipientDeviceId(16) ‖ ephemeralKey(32) */
function distributionHeader(fields: DistributionHeaderFields): Uint8Array {
  return concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    uuidToBytes(fields.circleId),
    u32be(fields.epoch),
    uuidToBytes(fields.senderDeviceId),
    uuidToBytes(fields.recipientDeviceId),
    fields.ephemeralKey,
  );
}

function distributionKey(
  sharedSecret: Uint8Array,
  ephemeralKey: Uint8Array,
  recipientDhKey: Uint8Array,
  header: Uint8Array,
) {
  return deriveKeyAndNonce(
    sharedSecret,
    concatBytes(ephemeralKey, recipientDhKey),
    LABELS.senderKeyDistributionKdf,
    header,
  );
}

interface CreateDistributionInput {
  senderKey: SenderKey;
  sender: DeviceKeys;
  recipient: DevicePublicKeys;
}

/** @internal Deterministic core; the ephemeral secret must be fresh randomness in production. */
export function createSenderKeyDistributionWith(
  { senderKey, sender, recipient }: CreateDistributionInput,
  ephemeralSecretKey: Uint8Array,
): SenderKeyDistribution {
  if (sender.deviceId !== senderKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'sender key belongs to another device');
  }
  const ephemeralKey = x25519PublicKey(ephemeralSecretKey);
  const fields = {
    circleId: senderKey.circleId,
    epoch: senderKey.epoch,
    senderDeviceId: senderKey.senderDeviceId,
    recipientDeviceId: recipient.deviceId,
    ephemeralKey,
  };
  const header = distributionHeader(fields);
  const sharedSecret = x25519SharedSecret(ephemeralSecretKey, recipient.dhKey);
  const keyAndNonce = distributionKey(sharedSecret, ephemeralKey, recipient.dhKey, header);
  sharedSecret.fill(0);
  const ct = aeadSeal(keyAndNonce, senderKey.key, header);
  keyAndNonce.key.fill(0);
  const sig = signWithLabel(
    LABELS.senderKeyDistributionSignature,
    concatBytes(header, ct),
    sender.identity.secretKey,
  );
  return {
    v: PROTOCOL_VERSION,
    circleId: fields.circleId,
    epoch: fields.epoch,
    senderDeviceId: fields.senderDeviceId,
    recipientDeviceId: fields.recipientDeviceId,
    ephemeralKey: toBase64url(ephemeralKey),
    ct: toBase64url(ct),
    sig: toBase64url(sig),
  };
}

/**
 * Wraps `senderKey` for one recipient device: X25519 with a fresh ephemeral key, HKDF-SHA256,
 * ChaCha20-Poly1305, signed by the sender's identity key. One distribution per recipient device.
 */
export function createSenderKeyDistribution(input: CreateDistributionInput): SenderKeyDistribution {
  const ephemeralSecretKey = randomBytes(KEY_BYTES);
  try {
    return createSenderKeyDistributionWith(input, ephemeralSecretKey);
  } finally {
    ephemeralSecretKey.fill(0);
  }
}

function parseDistribution(distribution: unknown) {
  const parsed = senderKeyDistributionSchema.safeParse(distribution);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid sender key distribution');
  const data = parsed.data;
  const ephemeralKey = fromBase64url(data.ephemeralKey, KEY_BYTES);
  const ct = fromBase64url(data.ct, KEY_BYTES + TAG_BYTES);
  const sig = fromBase64url(data.sig, SIGNATURE_BYTES);
  const header = distributionHeader({ ...data, ephemeralKey });
  return { data, ephemeralKey, ct, sig, header };
}

/**
 * Server-side check before storing a distribution: well-formed and signed by the claimed sender
 * device's identity key. Never throws.
 */
export function verifySenderKeyDistribution(
  distribution: unknown,
  senderIdentityKey: Uint8Array,
): boolean {
  try {
    const { ct, sig, header } = parseDistribution(distribution);
    return verifyWithLabel(
      LABELS.senderKeyDistributionSignature,
      concatBytes(header, ct),
      sig,
      senderIdentityKey,
    );
  } catch {
    return false;
  }
}

/**
 * Unwraps a sender key addressed to `recipient`. Order: shape, addressing, signature, then
 * decryption, so forged or misrouted distributions are rejected before any secret is used.
 */
export function openSenderKeyDistribution(input: {
  distribution: unknown;
  recipient: DeviceKeys;
  sender: DevicePublicKeys;
}): SenderKey {
  const { data, ephemeralKey, ct, sig, header } = parseDistribution(input.distribution);
  if (data.senderDeviceId !== input.sender.deviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'distribution is from another device');
  }
  if (data.recipientDeviceId !== input.recipient.deviceId) {
    throw new BarguCryptoError('WRONG_RECIPIENT', 'distribution is addressed to another device');
  }
  if (
    !verifyWithLabel(
      LABELS.senderKeyDistributionSignature,
      concatBytes(header, ct),
      sig,
      input.sender.identityKey,
    )
  ) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid sender key distribution signature');
  }
  const sharedSecret = x25519SharedSecret(input.recipient.dh.secretKey, ephemeralKey);
  const keyAndNonce = distributionKey(
    sharedSecret,
    ephemeralKey,
    input.recipient.dh.publicKey,
    header,
  );
  sharedSecret.fill(0);
  try {
    const key = aeadOpen(keyAndNonce, ct, header);
    return { circleId: data.circleId, epoch: data.epoch, senderDeviceId: data.senderDeviceId, key };
  } finally {
    keyAndNonce.key.fill(0);
  }
}
