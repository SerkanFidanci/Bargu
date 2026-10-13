import { describe, expect, it } from 'vitest';

import {
  AVATAR_EMOJIS,
  avatarSchema,
  displayNameSchema,
  isReservedUsername,
  normalizeUsername,
  profileUpdateSchema,
  usernameSchema,
} from './index.js';

describe('usernames', () => {
  it('normalise what people type', () => {
    expect(normalizeUsername('  @Ayse.Yilmaz ')).toBe('ayse.yilmaz');
    expect(usernameSchema.parse('@Deniz_42')).toBe('deniz_42');
  });

  it.each(['ali', 'ayse.yilmaz', 'can_1', 'a1b', '12345678901234567890'])('accept %s', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(21)],
    ['leading dot', '.ali'],
    ['trailing dot', 'ali.'],
    ['double dot', 'ali..veli'],
    ['Turkish letters', 'ayşe'],
    ['dotless i', 'ılgın'],
    ['space', 'ali veli'],
    ['dash', 'ali-veli'],
    ['emoji', 'ali😀'],
  ])('reject %s', (_, name) => {
    expect(usernameSchema.safeParse(name).success).toBe(false);
  });

  it('reserve names that pose as the service, also when dotted or underscored', () => {
    for (const name of ['admin', 'bargu', 'b.a.r.g.u', '_support_', 'destek', 'Yonetici']) {
      expect(usernameSchema.safeParse(name).success, name).toBe(false);
    }
    expect(isReservedUsername('bargu_fan')).toBe(false);
  });
});

describe('display names', () => {
  it('trim and fold whitespace', () => {
    expect(displayNameSchema.parse('  Ayşe   Yılmaz ')).toBe('Ayşe Yılmaz');
    // Pasted line breaks become spaces: a name is always one line.
    expect(displayNameSchema.parse('Ali\nVeli\u2028Can')).toBe('Ali Veli Can');
  });

  it('allow letters of any script and emoji (joined sequences included)', () => {
    for (const name of ['Ömer', 'Zoë', 'Мария', 'محمد', '李雷', 'Ece 👩\u200D💻']) {
      expect(displayNameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it.each([
    ['empty', '   '],
    ['too long', 'a'.repeat(41)],
    ['control character', 'Ali\u0007'],
    ['bidi override', 'Ali\u202Eilev'],
    ['bidi isolate', 'Ali\u2066x'],
    ['only invisible characters', '\u200B\u200B'],
  ])('reject %s', (_, name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('avatars', () => {
  it('accept a palette colour with or without an emoji from the set', () => {
    expect(avatarSchema.parse({ color: 0, emoji: null })).toEqual({ color: 0, emoji: null });
    for (const emoji of AVATAR_EMOJIS) {
      expect(avatarSchema.safeParse({ color: 11, emoji }).success, emoji).toBe(true);
    }
  });

  it('fit every emoji of the set in the database column', () => {
    for (const emoji of AVATAR_EMOJIS) {
      expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(16);
    }
    expect(new Set(AVATAR_EMOJIS).size).toBe(AVATAR_EMOJIS.length);
  });

  it.each([
    ['colour out of range', { color: 12, emoji: null }],
    ['negative colour', { color: -1, emoji: null }],
    ['fractional colour', { color: 1.5, emoji: null }],
    ['emoji outside the set', { color: 1, emoji: '🫠' }],
    ['text instead of emoji', { color: 1, emoji: 'A' }],
    ['two emoji', { color: 1, emoji: '😀😀' }],
    ['extra field', { color: 1, emoji: null, url: 'https://x' }],
  ])('reject %s', (_, avatar) => {
    expect(avatarSchema.safeParse(avatar).success).toBe(false);
  });
});

describe('profile updates', () => {
  it('accept any subset of fields', () => {
    expect(profileUpdateSchema.parse({ username: 'Ali' })).toEqual({ username: 'ali' });
    expect(
      profileUpdateSchema.parse({ displayName: 'Ali', avatar: { color: 3, emoji: '🦊' } }),
    ).toEqual({ displayName: 'Ali', avatar: { color: 3, emoji: '🦊' } });
  });

  it('reject an empty update and unknown fields', () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ email: 'a@b.c' }).success).toBe(false);
  });
});
