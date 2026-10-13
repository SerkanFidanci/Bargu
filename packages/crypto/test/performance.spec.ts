import { describe, expect, it } from 'vitest';

import { createSenderState, decryptMessage, encryptMessage } from '../src/message.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

// Regression guard on the Faz 1 budget (< 5 ms per encryption). The authoritative measurement runs
// on a phone via the app's /_dev/crypto screen; Node is far faster, so this only catches big slips.
const BUDGET_MS = 5;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('performance', () => {
  it('encrypts and decrypts a location well within the budget', () => {
    const alice = testDevice(ids.aliceDevice, 1);
    const senderKey = generateSenderKey({
      circleId: ids.circle,
      epoch: 1,
      senderDeviceId: ids.aliceDevice,
    });
    let state = createSenderState(senderKey);
    const replay = new ReplayGuard();
    const encryptTimes: number[] = [];
    const decryptTimes: number[] = [];

    for (let i = 0; i < 220; i++) {
      const start = performance.now();
      const { envelope, nextState } = encryptMessage({
        state,
        sender: alice,
        payload: locationPayload,
      });
      const encrypted = performance.now();
      decryptMessage({ envelope, senderKey, sender: publicKeysOf(alice), replay });
      const decrypted = performance.now();
      state = nextState;
      if (i >= 20) {
        encryptTimes.push(encrypted - start);
        decryptTimes.push(decrypted - encrypted);
      }
    }

    expect(median(encryptTimes)).toBeLessThan(BUDGET_MS);
    expect(median(decryptTimes)).toBeLessThan(BUDGET_MS);
  });
});
