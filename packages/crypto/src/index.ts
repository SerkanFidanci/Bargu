// Public API of the Bargu E2EE protocol (docs/PROTOCOL.md). Internal deterministic helpers used by
// the fixture tests are deliberately not exported.
export { REKEY_INTERVAL_MS, SAFETY_NUMBER_ITERATIONS } from './constants.js';
export { fromBase64url, toBase64url } from './encoding.js';
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
  decryptDocument,
  decryptHistory,
  decryptMessage,
  decryptStoredMessage,
  encryptDocument,
  encryptHistory,
  encryptMessage,
  historyKeyOf,
  verifyDocumentEnvelope,
  verifyHistoryEnvelope,
  verifyMessageEnvelope,
  type EncryptResult,
  type SenderState,
} from './message.js';
export { REPLAY_WINDOW, ReplayGuard, type ReplayState, type ReplayVerdict } from './replay.js';
export { openSealed, sealForDevice } from './sealed.js';
export { openPush, sealPush, type OpenedPush, type PushRecipient } from './push.js';
export {
  SAFETY_NUMBER_ROUNDS_PER_PAUSE,
  safetyNumber,
  safetyNumberAsync,
  safetyNumberQrMatches,
  verifySafetyNumberQr,
  type SafetyNumber,
  type SafetyNumberParty,
} from './safety-number.js';
export { applyPrecision, PRECISION_CELL_KM, type PrecisionLevel } from './precision.js';
export { rekeyReason, type RekeyReason } from './rekey.js';
export {
  deriveOtpCode,
  deriveWebCode,
  emailLookupKey,
  generateRequestNonce,
  generateToken,
  hashToken,
  normalizeEmail,
  OTP_DIGITS,
  pseudonym,
  REQUEST_MAX_SKEW_MS,
  REQUEST_NONCE_BYTES,
  signRequest,
  verifyOtpCode,
  verifyRequestSignature,
  verifyWebCode,
  WEB_CODE_DIGITS,
  type RequestToSign,
} from './auth.js';
export { openAtRest, sealAtRest } from './at-rest.js';
export { voteId } from './documents.js';
export {
  generatePhotoKey,
  MAX_PHOTO_BYTES,
  openProfilePhoto,
  sealProfilePhoto,
} from './profile.js';
export {
  bytesEqual,
  randomUuid,
  sha256,
  signingKeyFromSeed,
  verificationKeyFromRaw,
  type OkpJwk,
} from './server.js';
export {
  curveBackend,
  installNativePrimitives,
  uninstallNativePrimitives,
  type NativeInstallResult,
} from './native.js';
export type { NativeCurvePrimitives } from './primitives.js';
