import { HISTORY_SLOT_MS, type TrailPayload } from '@bargu/schemas';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { fromBase64url, utf8Encode } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import {
  createSenderState,
  decryptHistory,
  decryptMessage,
  encryptHistory,
  encryptMessage,
  encryptPaddedWith,
  FORMATS,
  historyKeyOf,
  verifyHistoryEnvelope,
  verifyMessageEnvelope,
} from '../src/message.js';
import { pad } from '../src/padding.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const senderKey = generateSenderKey({
  circleId: ids.circle,
  epoch: 3,
  senderDeviceId: alice.deviceId,
});
const state = createSenderState(senderKey);
const from = 1_791_880_200_000;

const trail = (points: number, wide = false): TrailPayload => ({
  kind: 'trail',
  from,
  points: Array.from({ length: points }, (_, i) =>
    wide ? [900, -9_000_000, -18_000_000, 10_000] : [i * 3, 4_100_823 + i, 2_897_841 + i, 9],
  ),
  ts: from + HISTORY_SLOT_MS,
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const seal = (payload: TrailPayload) => encryptHistory({ state, sender: alice, payload });
const open = (envelope: unknown, key = historyKeyOf(senderKey)) =>
  decryptHistory({ envelope, historyKey: key, sender: publicKeysOf(alice) });

describe('location history (docs/ADR/0019)', () => {
  it('opens with the history key of the epoch, again and again', () => {
    const { envelope, nextState } = seal(trail(3));
    expect(open(envelope)).toEqual(trail(3));
    expect(open(envelope)).toEqual(trail(3));
    // The sequence moves on; the state keeps the sender key itself.
    expect(nextState).toEqual({ senderKey, nextSeq: 1 });
  });

  it('pads to the smallest of three sizes: still, walking, driving', () => {
    const sizes = [trail(1), trail(60), trail(250, true)].map(
      (payload) => fromBase64url(seal(payload).envelope.ct).length,
    );
    expect(sizes).toEqual([528, 2064, 8208]);
  });

  it('keeps history and live locations apart: neither key opens the other', () => {
    const history = seal(trail(2)).envelope;
    const message = encryptMessage({ state, sender: alice, payload: locationPayload }).envelope;
    // The sender key itself does not open history…
    expect(codeOf(() => open(history, senderKey))).toBe('DECRYPT_FAILED');
    // …nor the history key a location, and the signatures do not pass for each other.
    expect(
      codeOf(() =>
        decryptMessage({
          envelope: message,
          senderKey: historyKeyOf(senderKey),
          sender: publicKeysOf(alice),
          replay: new ReplayGuard(),
        }),
      ),
    ).toBe('DECRYPT_FAILED');
    expect(verifyHistoryEnvelope(history, alice.identity.publicKey)).toBe(true);
    expect(verifyHistoryEnvelope(history, bob.identity.publicKey)).toBe(false);
    expect(verifyMessageEnvelope(history, alice.identity.publicKey)).toBe(false);
    expect(codeOf(() => open(message))).toBe('BAD_SIGNATURE');
  });

  it('derives one key per sender and epoch, the same on every phone', () => {
    const fixed = {
      circleId: ids.circle,
      epoch: 4,
      senderDeviceId: ids.aliceDevice,
      key: new Uint8Array(32).fill(0x42),
    };
    // Pinned (docs/PROTOCOL.md): HMAC-SHA256(key, label ‖ circleId ‖ epoch ‖ senderDeviceId).
    expect(bytesToHex(historyKeyOf(fixed).key)).toBe(
      '33eafe12b39f3500e7f88cddbb599fb1b0726477af2355bb575b09d27b67d962',
    );
    expect(bytesToHex(historyKeyOf(fixed).key)).not.toBe(
      bytesToHex(historyKeyOf({ ...fixed, epoch: 5 }).key),
    );
    expect(historyKeyOf(fixed)).toMatchObject({ circleId: ids.circle, epoch: 4 });
  });

  it('refuses what is not a trail, sealing and opening', () => {
    expect(codeOf(() => seal({ ...trail(1), from: from + 1 }))).toBe('MALFORMED');
    // A member with a valid key signs a history envelope around a location.
    const padded = pad(utf8Encode(JSON.stringify(locationPayload)), 512, 512);
    const { envelope } = encryptPaddedWith(
      { state: { senderKey: historyKeyOf(senderKey), nextSeq: 0 }, sender: alice },
      padded,
      new Uint8Array(16),
      FORMATS.history,
    );
    expect(codeOf(() => open(envelope))).toBe('MALFORMED');
  });
});
