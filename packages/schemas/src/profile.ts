import { z } from 'zod';

import { UNSAFE_TEXT } from './payload.js';

/**
 * Usernames are how friends find each other (no phone numbers, no contacts): lowercase ASCII
 * letters, digits, `_` and `.`, 3–20 characters, no leading, trailing or repeated dot. The database
 * enforces the character set too (migrations/0001).
 */
export const USERNAME_PATTERN = /^(?!\.)(?!.*\.\.)[a-z0-9_.]{3,20}(?<!\.)$/;

/**
 * Names that would let someone pose as the service or as staff. Compared after normalisation, and
 * also with dots and underscores removed (`b.a.r.g.u`, `_admin_`).
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'bargu',
  'bargusupport',
  'destek',
  'guvenlik',
  'help',
  'info',
  'mod',
  'moderator',
  'null',
  'official',
  'resmi',
  'root',
  'security',
  'staff',
  'support',
  'system',
  'team',
  'undefined',
  'yardim',
  'yetkili',
  'yonetici',
]);

/** What a user types, trimmed, without a leading `@`, lowercased (ASCII only: no locale casing). */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username) || RESERVED_USERNAMES.has(username.replace(/[._]/g, ''));
}

export const usernameSchema = z
  .string()
  .max(64)
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .regex(USERNAME_PATTERN)
      .refine((value) => !isReservedUsername(value), 'reserved'),
  );

/**
 * Display names are free text shown next to the avatar: 1–40 characters after trimming and folding
 * whitespace, no control or bidi-override characters (same rule as status texts), and at least one
 * visible letter, digit or emoji (a name of zero-width characters would render as nothing).
 */
export const displayNameSchema = z
  .string()
  .max(200)
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .refine((value) => !UNSAFE_TEXT.test(value), 'contains control or bidi characters')
      .refine((value) => /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(value), 'nothing visible'),
  );

/** Avatar palette size; the colours themselves are design tokens in the app. */
export const AVATAR_COLORS = 12;

/**
 * Emoji an avatar may carry: a fixed set, so every phone renders it (no new or multi-part
 * sequences missing from older fonts) and nothing else can be smuggled in.
 */
export const AVATAR_EMOJIS = [
  '😀',
  '😎',
  '🤓',
  '🥳',
  '😺',
  '🐶',
  '🦊',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐸',
  '🐵',
  '🦄',
  '🐙',
  '🐢',
  '🐝',
  '🦋',
  '🌻',
  '🌵',
  '🍀',
  '🌙',
  '⭐',
  '🔥',
  '⚡',
  '🌈',
  '🍕',
  '🍩',
  '☕',
  '⚽',
  '🏀',
  '🎸',
  '🎧',
  '🎮',
  '🚲',
  '🛹',
  '🚀',
  '⛵',
  '📚',
  '🎨',
  '📷',
  '💎',
  '👑',
  '🧭',
] as const;
const avatarEmojis: ReadonlySet<string> = new Set(AVATAR_EMOJIS);

/** Avatar without a photo: a palette colour and an optional emoji (photos come encrypted, later). */
export const avatarSchema = z
  .object({
    color: z
      .number()
      .int()
      .min(0)
      .max(AVATAR_COLORS - 1),
    emoji: z
      .string()
      .refine((value) => avatarEmojis.has(value), 'not an avatar emoji')
      .nullable(),
  })
  .strict();
export type Avatar = z.infer<typeof avatarSchema>;

export const usernameAvailabilityQuerySchema = z.object({ username: z.string().max(64) }).strict();

export const usernameAvailabilitySchema = z
  .object({
    /** The normalised name that was checked (what would be saved). */
    username: z.string(),
    available: z.boolean(),
    /** Why not: `invalid` (format), `reserved` (blocked name), `taken` (someone has it). */
    reason: z.enum(['invalid', 'reserved', 'taken']).nullable(),
  })
  .strict();
export type UsernameAvailability = z.infer<typeof usernameAvailabilitySchema>;

/** Onboarding and profile edits: every field optional, at least one present. */
export const profileUpdateSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    avatar: avatarSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'empty update');
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
