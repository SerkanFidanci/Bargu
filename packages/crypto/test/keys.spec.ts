import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { toBase64url } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import {
  exportDeviceKeyBundle,
  generateDeviceKeys,
  restoreDeviceKeys,
  verifyDeviceKeyBundle,
} from '../src/keys.js';
import { ids, testDevice } from './helpers.js';

function expectCode(fn: () => unknown, code: BarguCryptoError['code']) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BarguCryptoError);
    expect((error as BarguCryptoError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('device keys', () => {
  it('generates distinct keys that verify as a bundle', () => {
    const a = generateDeviceKeys(ids.aliceDevice);
    const b = generateDeviceKeys(ids.aliceDevice);
    expect(bytesToHex(a.identity.secretKey)).not.toBe(bytesToHex(b.identity.secretKey));

    const verified = verifyDeviceKeyBundle(exportDeviceKeyBundle(a));
    expect(verified.deviceId).toBe(ids.aliceDevice);
    expect(verified.identityKey).toEqual(a.identity.publicKey);
    expect(verified.dhKey).toEqual(a.dh.publicKey);
  });

  it('restores identical keys and signature from the stored secrets', () => {
    const original = generateDeviceKeys(ids.bobDevice);
    const restored = restoreDeviceKeys({
      deviceId: ids.bobDevice,
      identitySecretKey: original.identity.secretKey,
      dhSecretKey: original.dh.secretKey,
    });
    expect(restored).toEqual(original);
  });

  it('rejects secrets of the wrong size and invalid device ids', () => {
    expectCode(
      () =>
        restoreDeviceKeys({
          deviceId: ids.aliceDevice,
          identitySecretKey: new Uint8Array(31),
          dhSecretKey: new Uint8Array(32),
        }),
      'INVALID_KEY',
    );
    expectCode(() => generateDeviceKeys('not-a-uuid'), 'MALFORMED');
  });
});

describe('verifyDeviceKeyBundle', () => {
  const alice = testDevice(ids.aliceDevice, 1);
  const bundle = exportDeviceKeyBundle(alice);

  it('rejects malformed bundles', () => {
    expectCode(() => verifyDeviceKeyBundle({ ...bundle, extra: 1 }), 'MALFORMED');
    expectCode(() => verifyDeviceKeyBundle(null), 'MALFORMED');
  });

  it('rejects a DH key the identity key did not sign (server swapping keys)', () => {
    const mallory = testDevice(ids.aliceDevice, 9);
    expectCode(
      () => verifyDeviceKeyBundle({ ...bundle, dhKey: toBase64url(mallory.dh.publicKey) }),
      'BAD_SIGNATURE',
    );
  });

  it('rejects a bundle re-labelled with another device id', () => {
    expectCode(
      () => verifyDeviceKeyBundle({ ...bundle, deviceId: ids.bobDevice }),
      'BAD_SIGNATURE',
    );
  });

  it.each([
    ['not a curve point', new Uint8Array(32).fill(0xff)],
    ['the small-order identity point', Uint8Array.from([1, ...new Array<number>(31).fill(0)])],
  ])('rejects an identity key that is %s', (_, key) => {
    expectCode(
      () => verifyDeviceKeyBundle({ ...bundle, identityKey: toBase64url(key) }),
      'INVALID_KEY',
    );
  });
});
