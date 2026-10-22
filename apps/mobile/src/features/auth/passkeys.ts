import { Passkey, type PasskeyCreateRequest } from 'react-native-passkey';

import { api, passkeyOptionsSchema } from './auth-store';

export { passkeyDiagnostic, passkeyFailure, passkeysSupported } from './passkey-support';

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
