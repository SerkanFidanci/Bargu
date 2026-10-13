import { Passkey } from 'react-native-passkey';

/** Whether this phone can create and use passkeys (Android 9+ with Credential Manager, iOS 15+). */
export function passkeysSupported(): boolean {
  try {
    return Passkey.isSupported();
  } catch {
    return false;
  }
}

export type PasskeyFailure = 'cancelled' | 'noCredential' | 'exists' | 'failed';

/**
 * What went wrong with the platform authenticator, for the message to show. A cancel is the user's
 * choice and shows nothing.
 */
export function passkeyFailure(error: unknown): PasskeyFailure {
  const code =
    typeof error === 'object' && error !== null && 'error' in error ? String(error.error) : '';
  if (code === 'UserCancelled' || code === 'Interrupted') return 'cancelled';
  if (code === 'NoCredentials') return 'noCredential';
  if (code === 'CredentialAlreadyExists') return 'exists';
  return 'failed';
}

/**
 * Technical detail of a passkey failure, appended to the message in development and preview builds
 * only (diagnosing the platform authenticator on a tester's phone). Codes and messages, no keys.
 */
export function passkeyDiagnostic(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && 'status' in error) {
    return `${String(error.status)} ${String(error.code)}`;
  }
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const message = 'message' in error ? String(error.message) : '';
    return `${String(error.error)}: ${message}`.slice(0, 160);
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 160);
  return 'unknown';
}
