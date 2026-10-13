import { z } from 'zod';

/** Unpadded base64url text of exactly `bytes` bytes. */
function base64urlOf(bytes: number) {
  const length = Math.ceil((bytes * 4) / 3);
  return z
    .string()
    .length(length)
    .regex(/^[A-Za-z0-9_-]*$/);
}

const u32 = z.number().int().min(0).max(0xffff_ffff);

/**
 * Every message plaintext is padded to exactly this size, whatever its kind or precision, so the
 * envelope size reveals nothing (docs/PROTOCOL.md §5). All v1 payloads fit; a WS frame stays < 2 KB.
 */
export const MESSAGE_PADDED_BYTES = 512;
const AEAD_TAG_BYTES = 16;

/**
 * Encrypted message on the wire (BARGU_PLAN §3.1, docs/PROTOCOL.md §5). The server can verify
 * `sig` and route by the cleartext header, but never sees the payload.
 */
export const messageEnvelopeSchema = z
  .object({
    v: z.literal(1),
    circleId: z.uuid(),
    epoch: u32,
    senderDeviceId: z.uuid(),
    seq: u32,
    /** Per-message random salt for key derivation (16 bytes). */
    salt: base64urlOf(16),
    /** Padded payload plus 16-byte tag: always the same length. */
    ct: base64urlOf(MESSAGE_PADDED_BYTES + AEAD_TAG_BYTES),
    sig: base64urlOf(64),
  })
  .strict();

export type MessageEnvelope = z.infer<typeof messageEnvelopeSchema>;

/**
 * A sender key wrapped for exactly one recipient device (docs/PROTOCOL.md §4). Stored by the
 * server as an opaque blob and delivered to that device only.
 */
export const senderKeyDistributionSchema = z
  .object({
    v: z.literal(1),
    circleId: z.uuid(),
    epoch: u32,
    senderDeviceId: z.uuid(),
    recipientDeviceId: z.uuid(),
    ephemeralKey: base64urlOf(32),
    /** Encrypted 32-byte sender key plus 16-byte tag. */
    ct: base64urlOf(32 + AEAD_TAG_BYTES),
    sig: base64urlOf(64),
  })
  .strict();

export type SenderKeyDistribution = z.infer<typeof senderKeyDistributionSchema>;

/** Public key material a device publishes when it registers (docs/PROTOCOL.md §3). */
export const deviceKeyBundleSchema = z
  .object({
    deviceId: z.uuid(),
    identityKey: base64urlOf(32),
    dhKey: base64urlOf(32),
    dhKeySignature: base64urlOf(64),
  })
  .strict();

export type DeviceKeyBundle = z.infer<typeof deviceKeyBundleSchema>;
