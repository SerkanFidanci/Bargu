// Hermes has no Web Crypto. @bargu/crypto (via @noble) reads `crypto.getRandomValues` at call time
// and throws if it is missing, so install the OS CSPRNG (iOS SecRandomCopyBytes, Android
// SecureRandom) through expo-crypto before anything generates keys. Imported first in _layout.
import { getRandomValues } from 'expo-crypto';

const host = globalThis as { crypto?: { getRandomValues?: unknown } };

if (typeof host.crypto?.getRandomValues !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: { ...host.crypto, getRandomValues },
    configurable: true,
    enumerable: true,
    writable: true,
  });
}
