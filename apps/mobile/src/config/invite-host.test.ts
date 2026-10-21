import { inviteHost, parseInviteHost } from './invite-host';

describe('parseInviteHost (EXPO_PUBLIC_INVITE_HOST)', () => {
  it('takes a bare lower-case host name', () => {
    expect(parseInviteHost('api.46-62-162-70.sslip.io')).toBe('api.46-62-162-70.sslip.io');
    expect(parseInviteHost('bargu.app')).toBe('bargu.app');
    expect(parseInviteHost('a-b.c1.example.com')).toBe('a-b.c1.example.com');
  });

  it('is no host when unset or empty (production for now)', () => {
    expect(parseInviteHost(undefined)).toBeUndefined();
    expect(parseInviteHost('')).toBeUndefined();
  });

  it.each([
    'https://bargu.app',
    'bargu.app/',
    'bargu.app/i',
    'bargu.app:443',
    'me@bargu.app',
    'Bargu.app',
    ' bargu.app',
    'bargu.app ',
    'bargu.app.',
    '.bargu.app',
    'bargu..app',
    '-bargu.app',
    'bargu-.app',
    'localhost',
    'bargu_app.com',
    'x'.repeat(64) + '.app',
    'a.'.repeat(130) + 'app',
    '*.bargu.app',
    '127.0.0.1:3000',
  ])('refuses %j rather than guess what was meant', (value) => {
    expect(parseInviteHost(value)).toBeUndefined();
  });

  it('reads this build as it was configured (none under test)', () => {
    expect(inviteHost).toBeUndefined();
  });
});
