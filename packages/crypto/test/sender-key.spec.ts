import { describe, expect, it } from 'vitest';

import { fromBase64url, toBase64url } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { createSenderState, decryptMessage, encryptMessage } from '../src/message.js';
import { ReplayGuard } from '../src/replay.js';
import {
  createSenderKeyDistribution,
  createSenderKeyDistributionWith,
  generateSenderKey,
  openSenderKeyDistribution,
  verifySenderKeyDistribution,
} from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const carol = testDevice(ids.carolDevice, 5);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

function flipByte(base64: string, index: number): string {
  const bytes = fromBase64url(base64);
  bytes[index % bytes.length] = (bytes[index % bytes.length] ?? 0) ^ 0x01;
  return toBase64url(bytes);
}

describe('sender key distribution', () => {
  const senderKey = generateSenderKey({
    circleId: ids.circle,
    epoch: 4,
    senderDeviceId: ids.aliceDevice,
  });
  const distribution = createSenderKeyDistribution({
    senderKey,
    sender: alice,
    recipient: publicKeysOf(bob),
  });

  it('delivers the exact sender key to the addressed device only', () => {
    const opened = openSenderKeyDistribution({
      distribution,
      recipient: bob,
      sender: publicKeysOf(alice),
    });
    expect(opened).toEqual(senderKey);
    expect(
      codeOf(() =>
        openSenderKeyDistribution({ distribution, recipient: carol, sender: publicKeysOf(alice) }),
      ),
    ).toBe('WRONG_RECIPIENT');
  });

  it('uses a fresh ephemeral key for every distribution', () => {
    const again = createSenderKeyDistribution({
      senderKey,
      sender: alice,
      recipient: publicKeysOf(bob),
    });
    expect(again.ephemeralKey).not.toBe(distribution.ephemeralKey);
  });

  it('lets the server verify the signature without the key', () => {
    expect(verifySenderKeyDistribution(distribution, alice.identity.publicKey)).toBe(true);
    expect(verifySenderKeyDistribution(distribution, bob.identity.publicKey)).toBe(false);
    expect(
      verifySenderKeyDistribution({ ...distribution, epoch: 5 }, alice.identity.publicKey),
    ).toBe(false);
    expect(verifySenderKeyDistribution('garbage', alice.identity.publicKey)).toBe(false);
  });

  it.each(['ct', 'ephemeralKey', 'sig'] as const)('rejects a tampered %s', (field) => {
    const tampered = { ...distribution, [field]: flipByte(distribution[field], 5) };
    expect(
      codeOf(() =>
        openSenderKeyDistribution({
          distribution: tampered,
          recipient: bob,
          sender: publicKeysOf(alice),
        }),
      ),
    ).toBe('BAD_SIGNATURE');
  });

  it('rejects a distribution attributed to the wrong sender', () => {
    expect(
      codeOf(() =>
        openSenderKeyDistribution({ distribution, recipient: bob, sender: publicKeysOf(carol) }),
      ),
    ).toBe('KEY_MISMATCH');
  });

  it('fails decryption when a malicious sender encrypted to another DH key', () => {
    const misdirected = createSenderKeyDistributionWith(
      { senderKey, sender: alice, recipient: { ...publicKeysOf(bob), dhKey: carol.dh.publicKey } },
      new Uint8Array(32).fill(7),
    );
    expect(
      codeOf(() =>
        openSenderKeyDistribution({
          distribution: misdirected,
          recipient: bob,
          sender: publicKeysOf(alice),
        }),
      ),
    ).toBe('DECRYPT_FAILED');
  });

  it('refuses to wrap another device’s sender key', () => {
    expect(
      codeOf(() =>
        createSenderKeyDistribution({ senderKey, sender: bob, recipient: publicKeysOf(carol) }),
      ),
    ).toBe('KEY_MISMATCH');
  });

  it('rejects malformed input and invalid identifiers', () => {
    expect(
      codeOf(() =>
        openSenderKeyDistribution({
          distribution: {},
          recipient: bob,
          sender: publicKeysOf(alice),
        }),
      ),
    ).toBe('MALFORMED');
    expect(
      codeOf(() => generateSenderKey({ circleId: 'x', epoch: 0, senderDeviceId: ids.aliceDevice })),
    ).toBe('MALFORMED');
    expect(
      codeOf(() =>
        generateSenderKey({ circleId: ids.circle, epoch: -1, senderDeviceId: ids.aliceDevice }),
      ),
    ).toBe('MALFORMED');
  });
});

describe('membership change (rekey)', () => {
  it('a removed member cannot read messages of the new epoch', () => {
    // Epoch 1: Bob and Carol both receive Alice's key.
    const epoch1 = generateSenderKey({
      circleId: ids.circle,
      epoch: 1,
      senderDeviceId: ids.aliceDevice,
    });
    const carolsOldKey = openSenderKeyDistribution({
      distribution: createSenderKeyDistribution({
        senderKey: epoch1,
        sender: alice,
        recipient: publicKeysOf(carol),
      }),
      recipient: carol,
      sender: publicKeysOf(alice),
    });

    // Carol is removed: epoch 2 is distributed to Bob only.
    const epoch2 = generateSenderKey({
      circleId: ids.circle,
      epoch: 2,
      senderDeviceId: ids.aliceDevice,
    });
    const toBob = createSenderKeyDistribution({
      senderKey: epoch2,
      sender: alice,
      recipient: publicKeysOf(bob),
    });
    const { envelope } = encryptMessage({
      state: createSenderState(epoch2),
      sender: alice,
      payload: locationPayload,
    });

    // Bob reads it.
    const bobsKey = openSenderKeyDistribution({
      distribution: toBob,
      recipient: bob,
      sender: publicKeysOf(alice),
    });
    expect(
      decryptMessage({
        envelope,
        senderKey: bobsKey,
        sender: publicKeysOf(alice),
        replay: new ReplayGuard(),
      }),
    ).toEqual(locationPayload);

    // Carol cannot open Bob's distribution, her old key is for the wrong epoch, and relabelling it
    // as epoch 2 does not help.
    expect(
      codeOf(() =>
        openSenderKeyDistribution({
          distribution: toBob,
          recipient: carol,
          sender: publicKeysOf(alice),
        }),
      ),
    ).toBe('WRONG_RECIPIENT');
    expect(
      codeOf(() =>
        decryptMessage({
          envelope,
          senderKey: carolsOldKey,
          sender: publicKeysOf(alice),
          replay: new ReplayGuard(),
        }),
      ),
    ).toBe('KEY_MISMATCH');
    expect(
      codeOf(() =>
        decryptMessage({
          envelope,
          senderKey: { ...carolsOldKey, epoch: 2 },
          sender: publicKeysOf(alice),
          replay: new ReplayGuard(),
        }),
      ),
    ).toBe('DECRYPT_FAILED');
  });
});
