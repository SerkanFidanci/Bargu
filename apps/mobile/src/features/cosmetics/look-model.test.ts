import { cosmeticPublicKey, issueCosmeticPass, parseCosmeticKeys } from '@bargu/crypto';
import { COSMETIC_PASS_TTL_MS } from '@bargu/schemas';

import { card, somebody } from '../location/test-support';
import { audienceOf, lookAt, lookMarker, lookOf, passDue } from './look-model';
import { isMoving, type LookChoice } from './look-styles';

const DAY = 24 * 3600_000;
const NOW = Date.UTC(2026, 9, 21);
const ADA = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const BOB = '0190f7a4-5b6c-7d8e-9f01-23456789abce';
// The staging server's signing key, and another that no app trusts.
const STAGING = new Uint8Array(32).fill(7);
const STRANGER = new Uint8Array(32).fill(9);
const TRUSTED = parseCosmeticKeys(`stg-1:${cosmeticPublicKey(STAGING)}`);

const pass = (overrides: Partial<Parameters<typeof issueCosmeticPass>[0]> = {}) =>
  issueCosmeticPass({
    secretKey: STAGING,
    kid: 'stg-1',
    userId: ADA,
    packs: ['rings', 'frames'],
    issuedAt: NOW,
    expiresAt: NOW + 30 * DAY,
    ...overrides,
  });
const WEARING: LookChoice = { ring: 'sparkle', frame: 'gold' };
const show = (signed = pass(), choice = WEARING, userId = ADA, now = NOW + DAY) =>
  lookOf(userId, choice, signed, TRUSTED, now);

describe('what a pass lets a pin wear (docs/ADR/0025 §3, the pin addendum)', () => {
  it('shows the ring pattern and the frame when the pass holds and names both packs', () => {
    expect(show()).toEqual({ ring: 'sparkle', frame: 'gold', until: NOW + 30 * DAY });
  });

  it('shows the plain look without a pass, and for a plain choice', () => {
    expect(lookOf(ADA, WEARING, null, TRUSTED, NOW)).toBeNull();
    expect(show(pass(), { ring: null, frame: null })).toBeNull();
  });

  it('shows the plain look when the signature is not from a trusted key (wrong key, same kid)', () => {
    expect(show(pass({ secretKey: STRANGER }))).toBeNull();
  });

  it('shows the plain look under a kid this build does not know, or trusts no key at all', () => {
    expect(show(pass({ kid: 'stg-2' }))).toBeNull();
    // A production build trusts only the production key: a staging pass shows nothing there.
    expect(lookOf(ADA, WEARING, pass(), parseCosmeticKeys(undefined), NOW + DAY)).toBeNull();
  });

  it('shows the plain look once the pass has run out', () => {
    expect(show(pass(), WEARING, ADA, NOW + 30 * DAY - 1)).not.toBeNull();
    expect(show(pass(), WEARING, ADA, NOW + 30 * DAY)).toBeNull();
    expect(show(pass(), WEARING, ADA, NOW + 31 * DAY)).toBeNull();
  });

  it("shows the plain look when the pass is another account's (a copied pass)", () => {
    expect(show(pass({ userId: BOB }), WEARING, ADA)).toBeNull();
    expect(show(pass({ userId: BOB }), WEARING, BOB)).not.toBeNull();
  });

  it('shows the plain look for a pass that was changed after it was signed', () => {
    const given = pass({ packs: ['rings'] });
    // Frames added to a pass that only names rings: the signature no longer matches.
    expect(show({ ...given, packs: ['frames', 'rings'] })).toBeNull();
    expect(show({ ...given, expiresAt: given.expiresAt + DAY })).toBeNull();
  });

  it('shows only the part whose pack the pass names, the rest plain', () => {
    expect(show(pass({ packs: ['rings'] }))).toEqual({
      ring: 'sparkle',
      frame: undefined,
      until: NOW + 30 * DAY,
    });
    expect(show(pass({ packs: ['frames'] }))).toEqual({
      ring: undefined,
      frame: 'gold',
      until: NOW + 30 * DAY,
    });
    // A frame chosen with only the rings pack is nothing at all.
    expect(show(pass({ packs: ['rings'] }), { ring: null, frame: 'gold' })).toBeNull();
  });

  it('shows the plain look for a style this app does not know, or one of the other pack', () => {
    // A newer app's style, and a frame given where a ring belongs.
    expect(show(pass(), { ring: 'rainbow', frame: null })).toBeNull();
    expect(show(pass(), { ring: 'gold', frame: 'sparkle' })).toBeNull();
    expect(show(pass(), { ring: 'dots', frame: 'rainbow' })).toEqual({
      ring: 'dots',
      frame: undefined,
      until: NOW + 30 * DAY,
    });
  });

  it('never throws on a pass that is rubbish', () => {
    for (const value of [{}, { ...pass(), sig: 'x' }, { ...pass(), v: 2 }]) {
      expect(lookOf(ADA, WEARING, value as never, TRUSTED, NOW)).toBeNull();
    }
  });
});

describe('when a look still shows, and when a pass is due', () => {
  it('shows a look until its pass ends', () => {
    const look = { ring: 'dots' as const, until: NOW + DAY };
    expect(lookAt(look, NOW)).toBe(look);
    expect(lookAt(look, NOW + DAY)).toBeUndefined();
    expect(lookAt(null, NOW)).toBeUndefined();
    expect(lookAt(undefined, NOW)).toBeUndefined();
  });

  it('asks for a pass when there is none or less than half of its 30 days is left', () => {
    expect(passDue(null, NOW)).toBe(true);
    const fresh = pass();
    expect(passDue(fresh, NOW + DAY)).toBe(false);
    expect(passDue(fresh, NOW + COSMETIC_PASS_TTL_MS / 2 - 1)).toBe(false);
    expect(passDue(fresh, NOW + COSMETIC_PASS_TTL_MS / 2 + 1)).toBe(true);
  });

  it('asks for a pass when the plan has a pack the pass does not name', () => {
    const rings = pass({ packs: ['rings'] });
    expect(passDue(rings, NOW + DAY, ['rings'])).toBe(false);
    expect(passDue(rings, NOW + DAY, ['rings', 'frames'])).toBe(true);
    expect(passDue(rings, NOW + DAY, [])).toBe(false);
  });
});

describe('who a look is for, and what a circle last got (docs/ADR/0025 §3)', () => {
  const friends = [somebody(), somebody(), somebody()];
  const me = somebody();
  const members = [me, ...friends].map((person) => card(person));
  const trusting = (ids: readonly string[]) => (member: { userId: string }) =>
    ids.includes(member.userId);
  const everyone = friends.map((friend) => friend.userId);

  it('is the same for the same trusted phones, whatever the order', () => {
    const first = audienceOf({ members }, me.userId, trusting(everyone));
    const reversed = audienceOf({ members: [...members].reverse() }, me.userId, trusting(everyone));
    expect(first).toBe(reversed);
  });

  it('changes with a new member, a new phone, or trust given later', () => {
    const [ann, ben, cem] = friends;
    if (ann === undefined || ben === undefined || cem === undefined) throw new Error('friends');
    const two = [me, ann, ben].map((person) => card(person));
    const before = audienceOf({ members: two }, me.userId, trusting([ann.userId, ben.userId]));
    // A third member (new member).
    const three = [...two, card(cem)];
    expect(audienceOf({ members: three }, me.userId, trusting(everyone))).not.toBe(before);
    // Ben's new phone is not trusted until the user accepts the key change; then it is.
    const benNew = { ...card(ben), device: card(somebody()).device };
    const swapped = [card(me), card(ann), benNew];
    const held = audienceOf({ members: swapped }, me.userId, trusting([ann.userId]));
    expect(held).not.toBe(before);
    expect(
      audienceOf({ members: swapped }, me.userId, trusting([ann.userId, ben.userId])),
    ).not.toBe(held);
  });

  it('leaves out the user, members not active, and members with no phone', () => {
    const [ann] = friends;
    if (ann === undefined) throw new Error('friends');
    const base = audienceOf({ members: [card(me), card(ann)] }, me.userId, trusting([ann.userId]));
    const invited = card(somebody(), 'invited');
    const noPhone = { ...card(somebody()), device: null };
    const extra = audienceOf(
      { members: [card(me), card(ann), invited, noPhone] },
      me.userId,
      () => true,
    );
    expect(extra).toBe(base);
  });

  it('sends a circle the look again when its epoch, the choice, the pass or its readers change', () => {
    const marker = (epoch: number, ring: string | null, pass_ = pass(), audience = 'a') =>
      lookMarker(epoch, { ring, frame: null }, pass_, audience);
    const base = marker(1, 'dots');
    expect(marker(1, 'dots')).toBe(base);
    expect(marker(2, 'dots')).not.toBe(base);
    expect(marker(1, 'stripes')).not.toBe(base);
    expect(marker(1, 'dots', pass({ issuedAt: NOW + 1 }))).not.toBe(base);
    expect(marker(1, 'dots', pass(), 'b')).not.toBe(base);
    expect(marker(1, null)).not.toBe(base);
    expect(lookMarker(1, { ring: null, frame: null }, null, 'a')).toBe('1:-:-:-:a');
  });
});

describe('which looks move', () => {
  it('moves sparkle, holo and neon; the others hold still', () => {
    expect(isMoving({ ring: 'sparkle' })).toBe(true);
    expect(isMoving({ frame: 'holo' })).toBe(true);
    expect(isMoving({ frame: 'neon' })).toBe(true);
    expect(isMoving({ ring: 'stripes', frame: 'gold' })).toBe(false);
    expect(isMoving({ ring: 'dots', frame: 'dashed' })).toBe(false);
    expect(isMoving({ ring: 'gradient' })).toBe(false);
    expect(isMoving({})).toBe(false);
  });
});
