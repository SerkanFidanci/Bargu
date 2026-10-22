import { exportDeviceKeyBundle, generateDeviceKeys, randomUuid } from '@bargu/crypto';

import { forgetBundlesOf, forgetCheckedBundles, verifiedBundle } from './bundle-cache';

const checks = { count: 0 };
jest.mock('@bargu/crypto', () => {
  const actual = jest.requireActual<typeof import('@bargu/crypto')>('@bargu/crypto');
  return {
    ...actual,
    verifyDeviceKeyBundle: (...args: Parameters<typeof actual.verifyDeviceKeyBundle>) => {
      checks.count += 1;
      return actual.verifyDeviceKeyBundle(...args);
    },
  };
});

const bundleOf = () => exportDeviceKeyBundle(generateDeviceKeys(randomUuid()));

beforeEach(() => {
  forgetCheckedBundles();
  checks.count = 0;
});

describe('checked device bundles', () => {
  it('are checked once, however often they are asked for', () => {
    const bundle = bundleOf();
    const first = verifiedBundle(bundle);
    for (let index = 0; index < 50; index += 1) {
      expect(verifiedBundle({ ...bundle })).toBe(first);
    }
    expect(checks.count).toBe(1);
    expect(first.deviceId).toBe(bundle.deviceId);
  });

  it('are never taken for another bundle: any changed field is checked again and refused', () => {
    const bundle = bundleOf();
    const other = bundleOf();
    verifiedBundle(bundle);
    // Another phone's identity key under this phone's id and signature.
    expect(() => verifiedBundle({ ...bundle, identityKey: other.identityKey })).toThrow();
    // Another DH key, the signature no longer fits it.
    expect(() => verifiedBundle({ ...bundle, dhKey: other.dhKey })).toThrow();
    expect(() => verifiedBundle({ ...bundle, dhKeySignature: other.dhKeySignature })).toThrow();
    expect(() => verifiedBundle({ ...bundle, deviceId: other.deviceId })).toThrow();
    expect(checks.count).toBe(5);
  });

  it('are not remembered when they fail, so a forged one is refused every time', () => {
    const bundle = bundleOf();
    const forged = { ...bundle, dhKeySignature: bundleOf().dhKeySignature };
    expect(() => verifiedBundle(forged)).toThrow();
    expect(() => verifiedBundle(forged)).toThrow();
    expect(checks.count).toBe(2);
  });

  it('of a person no circle is shared with any more are forgotten, and only theirs', () => {
    const gone = bundleOf();
    const stays = bundleOf();
    verifiedBundle(gone);
    verifiedBundle(stays);
    forgetBundlesOf(new Set([gone.deviceId]));
    checks.count = 0;
    verifiedBundle(stays);
    expect(checks.count).toBe(0);
    verifiedBundle(gone);
    expect(checks.count).toBe(1);
  });

  it('keep a bounded number, the oldest going first', () => {
    const first = bundleOf();
    verifiedBundle(first);
    for (let index = 0; index < 300; index += 1) verifiedBundle(bundleOf());
    checks.count = 0;
    verifiedBundle(first);
    // It was among the oldest: checked again, not held for ever.
    expect(checks.count).toBe(1);
  });
});
