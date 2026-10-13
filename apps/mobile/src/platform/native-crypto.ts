// Moves the curve operations of @bargu/crypto (Ed25519, X25519) to the platform: CryptoKit on iOS,
// Tink on Android. Pure-JS curve arithmetic on Hermes took 6.7 ms per signature (Faz 1 device
// benchmark, budget 5 ms). Installed only if the self-test against the JS reference passes;
// otherwise the reference stays in use. Imported right after the CSPRNG (the self-test needs it).
import { installNativePrimitives, type NativeInstallResult } from '@bargu/crypto';

import nativeCrypto from '../../modules/bargu-native-crypto';

function setup(): NativeInstallResult {
  if (nativeCrypto === null) return { active: false, reason: 'native module not in this build' };
  return installNativePrimitives(nativeCrypto);
}

/** Outcome of the startup self-test (shown on the developer benchmark screen). */
export const nativeCryptoStatus: NativeInstallResult = setup();
