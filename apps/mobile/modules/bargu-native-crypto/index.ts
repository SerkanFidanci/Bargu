import type { NativeCurvePrimitives } from '@bargu/crypto';
import { requireOptionalNativeModule } from 'expo';

/**
 * Platform implementations of the curve operations (docs/ADR/0007). `null` where the native code
 * is not in the binary (Jest, an old build); @bargu/crypto then keeps its JS reference.
 */
export default requireOptionalNativeModule<NativeCurvePrimitives>('BarguNativeCrypto');
