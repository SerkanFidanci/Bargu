import { describe, expect, it, vi } from 'vitest';

import { BarguCryptoError } from '../src/errors.js';
import { SAFETY_NUMBER_ITERATIONS } from '../src/constants.js';
import {
  checkSafetyNumberQr,
  SAFETY_NUMBER_ROUNDS_PER_PAUSE,
  safetyNumber,
  safetyNumberAsync,
  safetyNumberQrMatches,
  verifySafetyNumberQr,
  type SafetyNumberParty,
} from '../src/safety-number.js';
import { ids, testDevice } from './helpers.js';

const alice = {
  userId: ids.aliceUser,
  identityKey: testDevice(ids.aliceDevice, 1).identity.publicKey,
};
const bob = { userId: ids.bobUser, identityKey: testDevice(ids.bobDevice, 3).identity.publicKey };

describe('safetyNumber', () => {
  const number = safetyNumber(alice, bob);

  it('is the same 60 digits on both phones', () => {
    expect(number.digits).toMatch(/^\d{60}$/);
    expect(safetyNumber(bob, alice)).toEqual(number);
    expect(number.groups).toHaveLength(12);
    expect(number.groups.join('')).toBe(number.digits);
  });

  it('changes when either identity key changes (device change warning)', () => {
    const bobNewDevice = { ...bob, identityKey: testDevice(ids.bobDevice, 7).identity.publicKey };
    const changed = safetyNumber(alice, bobNewDevice);
    expect(changed.digits).not.toBe(number.digits);
    // Alice's half stays, Bob's half changes.
    const aliceHalf = [number.digits.slice(0, 30), number.digits.slice(30)].filter((half) =>
      changed.digits.includes(half),
    );
    expect(aliceHalf).toHaveLength(1);
  });

  it('verifies a scanned QR code', () => {
    expect(verifySafetyNumberQr(number.qr, bob, alice)).toBe(true);
    const mallory = { ...bob, identityKey: testDevice(ids.bobDevice, 9).identity.publicKey };
    expect(verifySafetyNumberQr(number.qr, alice, mallory)).toBe(false);
    expect(verifySafetyNumberQr('bargu-sn:1:garbage', alice, bob)).toBe(false);
  });

  it('rejects invalid input', () => {
    expect(() => safetyNumber(alice, alice)).toThrow(BarguCryptoError);
    expect(() => safetyNumber(alice, { ...bob, identityKey: new Uint8Array(31) })).toThrow(
      BarguCryptoError,
    );
  });
});

describe('safetyNumberAsync', () => {
  it('gives the same number while pausing between short slices (the screen keeps animating)', async () => {
    let pauses = 0;
    const result = await safetyNumberAsync(alice, bob, () => {
      pauses += 1;
      return Promise.resolve();
    });
    expect(result).toEqual(safetyNumber(alice, bob));
    expect(pauses).toBe((2 * SAFETY_NUMBER_ITERATIONS) / SAFETY_NUMBER_ROUNDS_PER_PAUSE);
  });

  it('matches a scanned code against the computed number, and nothing else', async () => {
    const result = await safetyNumberAsync(alice, bob, () => Promise.resolve());
    expect(safetyNumberQrMatches(safetyNumber(bob, alice).qr, result)).toBe(true);
    const carol = {
      userId: ids.aliceUser,
      identityKey: testDevice(ids.aliceDevice, 2).identity.publicKey,
    };
    expect(safetyNumberQrMatches(safetyNumber(carol, bob).qr, result)).toBe(false);
    expect(safetyNumberQrMatches('', result)).toBe(false);
  });

  it('says which side sees a different key when a scanned code does not match (2026-10-16)', async () => {
    const pause = () => Promise.resolve();
    const check = (scanned: string, me: SafetyNumberParty = alice, them: SafetyNumberParty = bob) =>
      checkSafetyNumberQr(scanned, me, them, pause);
    expect(await check(safetyNumber(bob, alice).qr)).toBe('match');
    // Bob's phone has a new key Alice's phone does not know yet (or someone in the middle).
    const bobNew = { ...bob, identityKey: testDevice(ids.bobDevice, 7).identity.publicKey };
    expect(await check(safetyNumber(bobNew, alice).qr)).toBe('theirsDiffers');
    // Bob's phone still has an old key for Alice.
    const aliceOld = { ...alice, identityKey: testDevice(ids.aliceDevice, 5).identity.publicKey };
    expect(await check(safetyNumber(bob, aliceOld).qr)).toBe('mineDiffers');
    expect(await check(safetyNumber(bobNew, aliceOld).qr)).toBe('bothDiffer');
    // Some other code: an invite link, a broken one, a short one.
    expect(await check('https://bargu.app/i/abc')).toBe('notSafetyNumber');
    expect(await check('bargu-sn:1:***')).toBe('notSafetyNumber');
    expect(await check('bargu-sn:1:AAAA')).toBe('notSafetyNumber');
    await expect(check(safetyNumber(bob, alice).qr, alice, alice)).rejects.toThrow(
      BarguCryptoError,
    );
  });

  it('refuses the same user twice, before any work', async () => {
    const pause = vi.fn(() => Promise.resolve());
    await expect(safetyNumberAsync(alice, alice, pause)).rejects.toThrow(BarguCryptoError);
    expect(pause).not.toHaveBeenCalled();
  });
});
