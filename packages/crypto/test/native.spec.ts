import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { afterEach, describe, expect, it } from 'vitest';

import { BarguCryptoError } from '../src/errors.js';
import { encryptMessage, createSenderState, decryptMessage } from '../src/message.js';
import { curveBackend, installNativePrimitives, uninstallNativePrimitives } from '../src/native.js';
import {
  signWithLabel,
  verifyWithLabel,
  x25519PublicKey,
  x25519SharedSecret,
  type NativeCurvePrimitives,
} from '../src/primitives.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

/** A correct "native" implementation, backed by the reference and counting its calls. */
function faithful(): NativeCurvePrimitives & { calls: number } {
  const impl = {
    calls: 0,
    ed25519Sign: (secretKey: Uint8Array, message: Uint8Array) => {
      impl.calls++;
      return ed25519.sign(message, secretKey);
    },
    ed25519Verify: (publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => {
      impl.calls++;
      return ed25519.verify(signature, message, publicKey, { zip215: false });
    },
    x25519PublicKey: (secretKey: Uint8Array) => {
      impl.calls++;
      return x25519.getPublicKey(secretKey);
    },
    x25519SharedSecret: (secretKey: Uint8Array, publicKey: Uint8Array) => {
      impl.calls++;
      return x25519.getSharedSecret(secretKey, publicKey);
    },
  };
  return impl;
}

afterEach(() => {
  uninstallNativePrimitives();
});

describe('native curve primitives', () => {
  it('are installed after a passing self-test and then carry the protocol', () => {
    const impl = faithful();
    expect(curveBackend()).toBe('reference');
    expect(installNativePrimitives(impl)).toEqual({ active: true });
    expect(curveBackend()).toBe('native');

    const before = impl.calls;
    const alice = testDevice(ids.aliceDevice, 1);
    const senderKey = generateSenderKey({
      circleId: ids.circle,
      epoch: 1,
      senderDeviceId: ids.aliceDevice,
    });
    const { envelope } = encryptMessage({
      state: createSenderState(senderKey),
      sender: alice,
      payload: locationPayload,
    });
    expect(
      decryptMessage({
        envelope,
        senderKey,
        sender: publicKeysOf(alice),
        replay: new ReplayGuard(),
      }),
    ).toEqual(locationPayload);
    expect(impl.calls).toBeGreaterThan(before);
  });

  it.each([
    ['signs garbage', { ed25519Sign: () => new Uint8Array(64) }],
    ['rejects valid signatures', { ed25519Verify: () => false }],
    ['accepts anything', { ed25519Verify: () => true }],
    ['derives another X25519 public key', { x25519PublicKey: () => new Uint8Array(32).fill(9) }],
    ['agrees on another secret', { x25519SharedSecret: () => new Uint8Array(32).fill(9) }],
    [
      'throws',
      {
        x25519PublicKey: () => {
          throw new Error('native failure');
        },
      },
    ],
  ])('are refused when the implementation %s', (_, override) => {
    const result = installNativePrimitives({ ...faithful(), ...override });
    expect(result.active).toBe(false);
    expect(curveBackend()).toBe('reference');
  });

  it('are refused when verification accepts a malleated (non-canonical) signature', () => {
    // Lax verification: reduces S modulo L first, so S + L also verifies. Strict RFC 8032 must not.
    const order = 2n ** 252n + 27742317777372353535851937790883648493n;
    const lax: NativeCurvePrimitives = {
      ...faithful(),
      ed25519Verify: (publicKey, message, signature) => {
        let value = 0n;
        for (let i = 63; i >= 32; i--) value = (value << 8n) | BigInt(signature[i] ?? 0);
        value %= order;
        const reduced = signature.slice();
        for (let i = 32; i < 64; i++) {
          reduced[i] = Number(value & 0xffn);
          value >>= 8n;
        }
        return ed25519.verify(reduced, message, publicKey, { zip215: false });
      },
    };
    expect(installNativePrimitives(lax)).toMatchObject({ active: false });
  });

  it('never let malformed native output into the protocol', () => {
    const impl = faithful();
    expect(installNativePrimitives(impl).active).toBe(true);
    // The platform module misbehaves after installation.
    Object.assign(impl, {
      ed25519Sign: () => new Uint8Array(10),
      ed25519Verify: () => {
        throw new Error('crash');
      },
      x25519SharedSecret: () => new Uint8Array(32),
    });
    const secret = new Uint8Array(32).fill(3);
    expect(() => signWithLabel('bargu/v1/msg-sig', Uint8Array.of(1), secret)).toThrow(
      BarguCryptoError,
    );
    expect(
      verifyWithLabel('bargu/v1/msg-sig', Uint8Array.of(1), new Uint8Array(64), new Uint8Array(32)),
    ).toBe(false);
    expect(() => x25519SharedSecret(secret, x25519PublicKey(secret))).toThrow(BarguCryptoError);
  });
});
