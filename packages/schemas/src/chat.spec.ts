import { describe, expect, it } from 'vitest';

import {
  CHAT_PHOTO_MAX_BYTES,
  CHAT_PHOTO_MAX_SIDE,
  CHAT_REACTIONS,
  CHAT_TEXT_MAX,
  chatPayloadSchema,
  codePointsOf,
} from './chat.js';

const id = '0190f7a4-3333-7333-8333-000000000001';
const target = '0190f7a4-3333-7333-8333-000000000002';
const ts = 1_791_880_000_000;
const key = 'A'.repeat(43);

describe('items of messages and moments (docs/ADR/0035 §5)', () => {
  it('counts characters as people do: an emoji once', () => {
    expect(codePointsOf('👋')).toBe(1);
    expect(codePointsOf('şu\nbu')).toBe(5);
    expect(codePointsOf('')).toBe(0);
  });

  it('takes texts of 1 to 1000 characters, never only spaces', () => {
    const text = (value: string) =>
      chatPayloadSchema.safeParse({ kind: 'text', id, text: value, ts });
    expect(text('👋'.repeat(CHAT_TEXT_MAX)).success).toBe(true);
    expect(text('👋'.repeat(CHAT_TEXT_MAX + 1)).success).toBe(false);
    expect(text('').success).toBe(false);
    expect(text(' \n ').success).toBe(false);
  });

  it('bounds a photo: its size, its sides, its caption', () => {
    const photo = (over: object) =>
      chatPayloadSchema.safeParse({
        kind: 'photo',
        id,
        blobId: target,
        key,
        size: 1000,
        hash: key,
        w: 1200,
        h: 1600,
        story: false,
        ts,
        ...over,
      }).success;
    expect(photo({})).toBe(true);
    expect(photo({ caption: 'Taksim' })).toBe(true);
    expect(photo({ size: CHAT_PHOTO_MAX_BYTES + 1 })).toBe(false);
    expect(photo({ w: CHAT_PHOTO_MAX_SIDE + 1 })).toBe(false);
    expect(photo({ caption: 'x'.repeat(201) })).toBe(false);
    expect(photo({ key: 'short' })).toBe(false);
    expect(photo({ lat: 41 })).toBe(false);
  });

  it('names the target of a delete or a screenshot notice, and knows no other kind', () => {
    expect(chatPayloadSchema.safeParse({ kind: 'del', id, target, ts }).success).toBe(true);
    expect(chatPayloadSchema.safeParse({ kind: 'shot', id, target, ts }).success).toBe(true);
    expect(chatPayloadSchema.safeParse({ kind: 'del', id, ts }).success).toBe(false);
    expect(chatPayloadSchema.safeParse({ kind: 'loc', id, ts }).success).toBe(false);
  });

  it('takes a nearby invite with nothing in it but when (ADR 0037)', () => {
    expect(chatPayloadSchema.safeParse({ kind: 'near', id, ts }).success).toBe(true);
    // No place or distance can ride along.
    expect(chatPayloadSchema.safeParse({ kind: 'near', id, ts, lat: 41, lng: 29 }).success).toBe(
      false,
    );
    expect(chatPayloadSchema.safeParse({ kind: 'near', id, ts, meters: 300 }).success).toBe(false);
  });

  it('takes one of six reactions, or none to take it back, and nothing else (Ek 2)', () => {
    expect(CHAT_REACTIONS).toHaveLength(6);
    for (const emoji of [...CHAT_REACTIONS, null]) {
      expect(chatPayloadSchema.safeParse({ kind: 'react', id, target, emoji, ts }).success).toBe(
        true,
      );
    }
    for (const emoji of ['x', '', '❤️❤️', undefined]) {
      expect(chatPayloadSchema.safeParse({ kind: 'react', id, target, emoji, ts }).success).toBe(
        false,
      );
    }
    expect(
      chatPayloadSchema.safeParse({ kind: 'react', id, target, emoji: null, ts, extra: 1 }).success,
    ).toBe(false);
  });
});
