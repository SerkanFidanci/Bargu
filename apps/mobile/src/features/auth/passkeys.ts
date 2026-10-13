import { Passkey, type PasskeyCreateRequest } from 'react-native-passkey';

import { api, passkeyOptionsSchema } from './auth-store';

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

/** Adds a passkey to the signed-in account (the server binds it to the account id). */
export async function addPasskey(): Promise<void> {
  const { challengeId, options } = passkeyOptionsSchema.parse(
    await api.authed('/v1/auth/passkey/register/options', { method: 'POST' }),
  );
  const credential = await Passkey.create(options as unknown as PasskeyCreateRequest);
  await api.authed('/v1/auth/passkey/register', {
    method: 'POST',
    body: { challengeId, response: credential },
  });
}
