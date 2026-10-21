import { z } from 'zod';

/**
 * Cosmetic packs (docs/ADR/0025, ADR 0024 §7): looks only, nothing works differently with them.
 * Each pack is bought once for good (`cosmetic:<pack>`) and gives these looks. They are drawn on
 * the map pin (ADR 0025 addendum of 2026-10-21): a pattern on its ring, a frame around it.
 */
export const COSMETIC_PACKS = {
  /** "Halka desenleri": patterns on the pin's ring. */
  rings: ['stripes', 'dots', 'gradient', 'sparkle'],
  /** "Pin çerçeveleri": frames around the pin. */
  frames: ['holo', 'gold', 'neon', 'dashed'],
} as const;
export type CosmeticPack = keyof typeof COSMETIC_PACKS;
/** The packs as products (an entitlement's `product`): only these can be bought. */
export const COSMETIC_PRODUCTS = [
  'cosmetic:rings',
  'cosmetic:frames',
] as const satisfies readonly `cosmetic:${CosmeticPack}`[];
/** A pack as a product id (`cosmetic:rings`). */
export type CosmeticProduct = (typeof COSMETIC_PRODUCTS)[number];
export type RingPattern = (typeof COSMETIC_PACKS.rings)[number];
export type FrameStyle = (typeof COSMETIC_PACKS.frames)[number];

/**
 * A pass names at most this many packs: with the look it has to fit one 512-byte message
 * (packages/crypto message.spec checks the largest). More packs later: a pass for the packs in use.
 */
export const COSMETIC_PASS_MAX_PACKS = 6;
/** How long a pass holds; the phone asks for a new one once less than half is left. */
export const COSMETIC_PASS_TTL_MS = 30 * 24 * 3600_000;

/** A pack's or a look's id: newer apps may know more of them than this one. */
export const cosmeticIdSchema = z.string().regex(/^[a-z0-9_]{1,16}$/);
/** Which server key signed a pass (staging and production have their own). */
export const cosmeticKidSchema = z.string().regex(/^[a-z0-9-]{1,16}$/);

/**
 * The server's signed word on which packs an account has (docs/ADR/0025 §1): the account, the packs,
 * when it was given and until when it holds. Nothing else: no price, date of purchase or source.
 */
export const cosmeticPassSchema = z
  .object({
    v: z.literal(1),
    kid: cosmeticKidSchema,
    userId: z.uuid(),
    packs: z.array(cosmeticIdSchema).max(COSMETIC_PASS_MAX_PACKS),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    /** Ed25519 over the pass's fixed bytes (packages/crypto cosmetics.ts), base64url. */
    sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();
export type CosmeticPass = z.infer<typeof cosmeticPassSchema>;

/** GET /v1/me/cosmetics/pass: the caller's own pass, null without any pack. */
export const cosmeticPassReplySchema = z.object({ pass: cosmeticPassSchema.nullable() });
export type CosmeticPassReply = z.infer<typeof cosmeticPassReplySchema>;
