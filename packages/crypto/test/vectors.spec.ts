// Official test vectors, copied from the RFC texts (rfc-editor.org), run through the exact library
// entry points the protocol uses.
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { aeadOpen, aeadSeal, x25519PublicKey, x25519SharedSecret } from '../src/primitives.js';
import { hex } from './helpers.js';

describe('RFC 7748 — X25519', () => {
  it.each([
    [
      'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4',
      'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c',
      'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
    ],
    [
      '4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d',
      'e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493',
      '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957',
    ],
  ])('§5.2 scalar %s', (scalar, u, expected) => {
    expect(bytesToHex(x25519SharedSecret(hex(scalar), hex(u)))).toBe(expected);
  });

  it('§6.1 Diffie-Hellman between Alice and Bob', () => {
    const alice = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bob = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
    const alicePublic = x25519PublicKey(alice);
    const bobPublic = x25519PublicKey(bob);
    expect(bytesToHex(alicePublic)).toBe(
      '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    );
    expect(bytesToHex(bobPublic)).toBe(
      'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
    );
    const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    expect(bytesToHex(x25519SharedSecret(alice, bobPublic))).toBe(shared);
    expect(bytesToHex(x25519SharedSecret(bob, alicePublic))).toBe(shared);
  });
});

describe('RFC 8032 §7.1 — Ed25519', () => {
  it.each([
    {
      name: 'TEST 1',
      secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', // gitleaks:allow (published RFC 8032 §7.1 test vector)
      publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      message: '',
      signature:
        'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
        '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    },
    {
      name: 'TEST 2',
      secret: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', // gitleaks:allow (published RFC 8032 §7.1 test vector)
      publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
      message: '72',
      signature:
        '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da' +
        '085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
    },
    {
      name: 'TEST 3',
      secret: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', // gitleaks:allow (published RFC 8032 §7.1 test vector)
      publicKey: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
      message: 'af82',
      signature:
        '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac' +
        '18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
    },
  ])('$name', ({ secret, publicKey, message, signature }) => {
    expect(bytesToHex(ed25519.getPublicKey(hex(secret)))).toBe(publicKey);
    expect(bytesToHex(ed25519.sign(hex(message), hex(secret)))).toBe(signature);
    expect(ed25519.verify(hex(signature), hex(message), hex(publicKey), { zip215: false })).toBe(
      true,
    );
  });
});

describe('RFC 8439 §2.8.2 — AEAD_CHACHA20_POLY1305', () => {
  const key = hex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = hex('070000004041424344454647');
  const aad = hex('50515253c0c1c2c3c4c5c6c7');
  const plaintext = utf8ToBytes(
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
  );
  const ciphertext = hex(`
    d31a8d34648e60db7b86afbc53ef7ec2 a4aded51296e08fea9e2b5a736ee62d6
    3dbea45e8ca9671282fafb69da92728b 1a71de0a9e060b2905d6a5b67ecd3b36
    92ddbd7f2d778b8c9803aee328091b58 fab324e4fad675945585808b4831d7bc
    3ff4def08e4b7a9de576d26586cec64b 6116`);
  const tag = hex('1ae10b594f09e26a7e902ecbd0600691');

  it('encrypts to the published ciphertext and tag', () => {
    const sealed = aeadSeal({ key, nonce }, plaintext, aad);
    expect(bytesToHex(sealed)).toBe(bytesToHex(ciphertext) + bytesToHex(tag));
    expect(aeadOpen({ key, nonce }, sealed, aad)).toEqual(plaintext);
  });
});

describe('RFC 5869 A.1 — HKDF-SHA256', () => {
  it('derives the published OKM', () => {
    const okm = hkdf(
      sha256,
      hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'),
      hex('000102030405060708090a0b0c'),
      hex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    );
    expect(bytesToHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });
});
