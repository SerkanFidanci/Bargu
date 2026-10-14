import { describe, expect, it } from 'vitest';

import { BarguCryptoError } from '../src/errors.js';
import {
  generatePhotoKey,
  MAX_PHOTO_BYTES,
  openProfilePhoto,
  sealProfilePhoto,
} from '../src/index.js';

const PHOTO = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const OTHER = '0190f7a4-5b6c-7d8e-9f01-23456789abce';

describe('profile photos', () => {
  it('open only with their key and their own id', () => {
    const key = generatePhotoKey();
    const image = new Uint8Array(2_000).map((_, index) => index % 251);
    const sealed = sealProfilePhoto(key, PHOTO, image);
    expect(sealed.length).toBe(image.length + 1 + 24 + 16);
    expect(openProfilePhoto(key, PHOTO, sealed)).toEqual(image);
    // The server cannot pass the photo off as another one, nor change a byte.
    expect(() => openProfilePhoto(key, OTHER, sealed)).toThrow(BarguCryptoError);
    const tampered = sealed.slice();
    tampered[40] = (tampered[40] ?? 0) ^ 1;
    expect(() => openProfilePhoto(key, PHOTO, tampered)).toThrow(BarguCryptoError);
    expect(() => openProfilePhoto(generatePhotoKey(), PHOTO, sealed)).toThrow(BarguCryptoError);
  });

  it('refuses to open malformed data or with a bad key', () => {
    const key = generatePhotoKey();
    const sealed = sealProfilePhoto(key, PHOTO, new Uint8Array(100).fill(7));
    expect(() => openProfilePhoto(new Uint8Array(16), PHOTO, sealed)).toThrow(BarguCryptoError);
    expect(() => openProfilePhoto(key, PHOTO, sealed.subarray(0, 30))).toThrow(BarguCryptoError);
    const otherVersion = sealed.slice();
    otherVersion[0] = 99;
    expect(() => openProfilePhoto(key, PHOTO, otherVersion)).toThrow(BarguCryptoError);
  });

  it('refuses empty or oversized photos and bad keys', () => {
    const key = generatePhotoKey();
    expect(() => sealProfilePhoto(key, PHOTO, new Uint8Array(0))).toThrow(BarguCryptoError);
    expect(() => sealProfilePhoto(key, PHOTO, new Uint8Array(MAX_PHOTO_BYTES + 1))).toThrow(
      BarguCryptoError,
    );
    expect(() => sealProfilePhoto(new Uint8Array(16), PHOTO, new Uint8Array(10))).toThrow(
      BarguCryptoError,
    );
  });
});
