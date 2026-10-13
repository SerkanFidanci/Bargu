jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));

import { passkeyFailure } from './passkeys';

describe('passkeyFailure', () => {
  it.each([
    [{ error: 'UserCancelled', message: '' }, 'cancelled'],
    [{ error: 'Interrupted', message: '' }, 'cancelled'],
    [{ error: 'NoCredentials', message: '' }, 'noCredential'],
    [{ error: 'CredentialAlreadyExists', message: '' }, 'exists'],
    [{ error: 'RequestFailed', message: '' }, 'failed'],
    [new Error('boom'), 'failed'],
    [null, 'failed'],
  ])('maps %p to %s', (error, expected) => {
    expect(passkeyFailure(error)).toBe(expected);
  });
});
