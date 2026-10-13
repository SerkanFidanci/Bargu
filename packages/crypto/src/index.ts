// Public API of the Bargu E2EE protocol (docs/PROTOCOL.md). Internal deterministic helpers used by
// the fixture tests are deliberately not exported.
export { REKEY_INTERVAL_MS, SAFETY_NUMBER_ITERATIONS } from './constants.js';
export { BarguCryptoError, type CryptoErrorCode } from './errors.js';
export {
  exportDeviceKeyBundle,
  generateDeviceKeys,
  restoreDeviceKeys,
  verifyDeviceKeyBundle,
  type DeviceKeys,
  type DevicePublicKeys,
  type KeyPair,
} from './keys.js';
export {
  createSenderKeyDistribution,
  generateSenderKey,
  openSenderKeyDistribution,
  verifySenderKeyDistribution,
  type SenderKey,
} from './sender-key.js';
export {
  createSenderState,
  decryptMessage,
  encryptMessage,
  verifyMessageEnvelope,
  type EncryptResult,
  type SenderState,
} from './message.js';
export { ReplayGuard, type ReplayState } from './replay.js';
export { openSealed, sealForDevice } from './sealed.js';
export {
  safetyNumber,
  verifySafetyNumberQr,
  type SafetyNumber,
  type SafetyNumberParty,
} from './safety-number.js';
export { applyPrecision, PRECISION_CELL_KM, type PrecisionLevel } from './precision.js';
export { rekeyReason, type RekeyReason } from './rekey.js';
