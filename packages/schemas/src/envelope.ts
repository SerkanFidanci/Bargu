import { z } from 'zod';

/** Unpadded base64url text of exactly `bytes` bytes. */
function base64urlOf(bytes: number) {
  const length = Math.ceil((bytes * 4) / 3);
  return z
    .string()
    .length(length)
    .regex(/^[A-Za-z0-9_-]*$/);
}

/** Unpadded base64url text whose decoded size is within [min, max] bytes. */
function base64urlBetween(min: number, max: number) {
  return z
    .string()
    .min(Math.ceil((min * 4) / 3))
    .max(Math.ceil((max * 4) / 3))
    .regex(/^[A-Za-z0-9_-]*$/);
}

const u32 = z.number().int().min(0).max(0xffff_ffff);

/** Largest padded plaintext inside a message envelope (keeps a WS frame under 2 KB). */
export const MAX_MESSAGE_PLAINTEXT_BYTES = 1024;
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
    ct: base64urlBetween(AEAD_TAG_BYTES + 128, AEAD_TAG_BYTES + MAX_MESSAGE_PLAINTEXT_BYTES),
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
