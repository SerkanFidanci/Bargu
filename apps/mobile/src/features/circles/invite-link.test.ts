import { inviteTokenFrom } from './invite-link';

const TOKEN = 'A'.repeat(42) + 'b';

describe('inviteTokenFrom', () => {
  it('reads the token of a Bargu invite link or QR code', () => {
    expect(inviteTokenFrom(`bargu://i/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFrom(` bargu://i/${TOKEN}\n`)).toBe(TOKEN);
  });

  it('refuses anything else', () => {
    for (const scanned of [
      '',
      TOKEN,
      `https://evil.example/i/${TOKEN}`,
      `bargu://i/${TOKEN}x`,
      `bargu://i/${TOKEN.slice(1)}`,
      `bargu://i/${TOKEN}/extra`,
      'bargu-sn:1:abc',
    ]) {
      expect(inviteTokenFrom(scanned)).toBeNull();
    }
  });
});
