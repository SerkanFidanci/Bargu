import type { Payload } from '@bargu/schemas';
import { describe, expect, it } from 'vitest';

import { fromBase64url, toBase64url } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { decryptMessage, decryptStoredMessage, encryptMessage } from '../src/message.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const senderKey = generateSenderKey({
  circleId: ids.circle,
  epoch: 2,
  senderDeviceId: alice.deviceId,
});

const place: Payload = {
  kind: 'place',
  id: ids.place,
  name: 'Ev',
  emoji: '🏠',
  lat: 41.0082,
  lng: 28.9784,
  radius: 250,
  ts: 1_791_880_000_000,
};

function seal(payload: Payload, seq = 0) {
  return encryptMessage({ state: { senderKey, nextSeq: seq }, sender: alice, payload }).envelope;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('stored messages (places)', () => {
  const open = (envelope: unknown) =>
    decryptStoredMessage({ envelope, senderKey, sender: publicKeysOf(alice) });

  it('opens a place again and again, whatever the replay window saw since', () => {
    const envelope = seal(place, 3);
    const replay = new ReplayGuard();
    // The author's later messages (locations) move the window far past the stored one.
    for (let seq = 4; seq < 200; seq++) {
      decryptMessage({
        envelope: seal({ ...locationPayload, ts: locationPayload.ts + seq }, seq),
        senderKey,
        sender: publicKeysOf(alice),
        replay,
      });
    }
    expect(open(envelope)).toEqual(place);
    expect(open(envelope)).toEqual(place);
  });

  it('accepts only places: no other message escapes the replay window this way', () => {
    expect(codeOf(() => open(seal(locationPayload)))).toBe('MALFORMED');
    expect(codeOf(() => open(seal({ kind: 'bump', ts: 1 })))).toBe('MALFORMED');
  });

  it('still checks author, circle, epoch and signature', () => {
    const envelope = seal(place);
    const ct = fromBase64url(envelope.ct);
    ct[0] = (ct[0] ?? 0) ^ 1;
    expect(codeOf(() => open({ ...envelope, ct: toBase64url(ct) }))).toBe('BAD_SIGNATURE');
    expect(codeOf(() => open({ ...envelope, epoch: 3 }))).toBe('KEY_MISMATCH');
    expect(
      codeOf(() => decryptStoredMessage({ envelope, senderKey, sender: publicKeysOf(bob) })),
    ).toBe('KEY_MISMATCH');
    expect(codeOf(() => open({ ...envelope, v: 2 }))).toBe('MALFORMED');
  });
});
