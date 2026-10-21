import { describe, expect, it } from 'vitest';

import {
  cosmeticPublicKey,
  issueCosmeticPass,
  parseCosmeticKeys,
  verifyCosmeticPass,
} from '../src/cosmetics.js';
import { randomBytes } from '../src/primitives.js';

const DAY = 24 * 3600_000;
const NOW = Date.UTC(2026, 9, 16);
const alice = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const bob = '0190f7a4-5b6c-7d8e-9f01-23456789abce';
const staging = randomBytes(32);
const production = randomBytes(32);
const trusted = parseCosmeticKeys(`stg-1:${cosmeticPublicKey(staging)}`);

const pass = (overrides: Partial<Parameters<typeof issueCosmeticPass>[0]> = {}) =>
  issueCosmeticPass({
    secretKey: staging,
    kid: 'stg-1',
    userId: alice,
    packs: ['rings', 'frames'],
    issuedAt: NOW,
    expiresAt: NOW + 30 * DAY,
    ...overrides,
  });
const check = (value: unknown, userId = alice, now = NOW + DAY) =>
  verifyCosmeticPass(value, { keys: trusted, userId, now });

describe('cosmetic pass (docs/ADR/0025)', () => {
  it('holds when signed by a trusted key, for its account, in time', () => {
    const given = pass();
    expect(given.packs).toEqual(['frames', 'rings']);
    expect(Object.keys(given).sort()).toEqual(
      ['expiresAt', 'issuedAt', 'kid', 'packs', 'sig', 'userId', 'v'].sort(),
    );
    expect(check(given)).toEqual(new Set(['frames', 'rings']));
  });

  it('does not hold signed by another key, even under a trusted kid', () => {
    expect(check(pass({ secretKey: production }))).toBeNull();
  });

  it('does not hold expired', () => {
    expect(check(pass(), alice, NOW + 30 * DAY)).toBeNull();
  });

  it("does not hold as someone else's", () => {
    expect(check(pass(), bob)).toBeNull();
  });

  it('gives only the packs it names, and none added afterwards', () => {
    const given = pass({ packs: ['rings'] });
    expect(check(given)?.has('frames')).toBe(false);
    expect(check({ ...given, packs: ['frames', 'rings'] })).toBeNull();
    expect(check({ ...given, packs: ['rings', 'rings'] })).toBeNull();
  });

  it('does not hold under a kid this app does not know (production trusts no staging key)', () => {
    expect(check(pass({ kid: 'stg-2' }))).toBeNull();
    const productionApp = parseCosmeticKeys(`prd-1:${cosmeticPublicKey(production)}`);
    expect(verifyCosmeticPass(pass(), { keys: productionApp, userId: alice, now: NOW })).toBeNull();
  });

  it('is issued only with a 32-byte key and for a pass within bounds', () => {
    expect(() => pass({ secretKey: randomBytes(16) })).toThrow('32 bytes');
    for (const bad of [{ kid: 'Not A Kid' }, { packs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }]) {
      expect(() => pass(bad)).toThrow('invalid cosmetic pass');
    }
  });

  it('does not hold, and does not throw, with a non-canonical last signature character (QA-28 B-2)', () => {
    const given = pass();
    // 64 bytes in 86 characters leave 4 spare bits in the last one: only A, Q, g and w are
    // canonical there. Every other value must come back as "no pass", never as an exception.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const letters = alphabet.split('');
    expect(letters.filter((_, index) => index % 16 === 0)).toEqual(['A', 'Q', 'g', 'w']);
    for (const last of letters) {
      const sig = given.sig.slice(0, -1) + last;
      const result = check({ ...given, sig });
      if (sig === given.sig) expect(result).toEqual(new Set(['frames', 'rings']));
      else expect(result).toBeNull();
    }
  });

  it('leaves out a small-order key: it would accept forged passes', () => {
    expect(parseCosmeticKeys(`stg-9:AQ${'A'.repeat(41)}`).size).toBe(0);
  });

  it('never throws on rubbish, and reads several keys from the build configuration', () => {
    for (const value of [null, 1, 'pass', {}, { ...pass(), sig: 'x' }, { ...pass(), v: 2 }]) {
      expect(check(value)).toBeNull();
    }
    const keys = parseCosmeticKeys(
      ` stg-1:${cosmeticPublicKey(staging)}, stg-2:${cosmeticPublicKey(production)},bad,x:y`,
    );
    expect([...keys.keys()]).toEqual(['stg-1', 'stg-2']);
    expect(parseCosmeticKeys(undefined).size).toBe(0);
  });
});
