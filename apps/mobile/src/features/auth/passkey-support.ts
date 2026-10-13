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
