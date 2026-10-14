import { z } from 'zod';

/**
 * An encrypted profile photo (docs/ADR/0014): `ciphertext` is version ‖ nonce ‖ sealed JPEG,
 * base64url (a JPEG of at most 40 KB, sealed). The server never holds the key.
 */
export const photoSchema = z
  .object({
    photoId: z.uuid(),
    ciphertext: z
      .string()
      .min(56)
      .max(55_000)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type Photo = z.infer<typeof photoSchema>;
export const photoUploadSchema = photoSchema;
