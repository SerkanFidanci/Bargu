import { inviteTokenFrom } from './invite-link';

const TOKEN = 'A'.repeat(42) + 'b';
const HOST = 'api.46-62-162-70.sslip.io';

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
      `bargu://i/${TOKEN}/`,
      `/i/${TOKEN}`,
      'bargu-sn:1:abc',
    ]) {
      expect(inviteTokenFrom(scanned)).toBeNull();
    }
  });

  it("reads all three forms: bargu://, the page's path form and the shared fragment form", () => {
    for (const scanned of [
      `bargu://i/${TOKEN}`,
      `https://${HOST}/i/${TOKEN}`,
      `https://${HOST}/i#${TOKEN}`,
      `  https://${HOST}/i#${TOKEN}\n`,
      `HTTPS://${HOST.toUpperCase()}/i#${TOKEN}`,
    ]) {
      expect(inviteTokenFrom(scanned, HOST)).toBe(TOKEN);
    }
  });

  it('refuses a fragment that is not exactly /i#<token> on the invite host', () => {
    for (const scanned of [
      // A guardian code is no invite.
      `https://${HOST}/g#${TOKEN}`,
      `https://${HOST}/g/${TOKEN}`,
      `bargu://g/${TOKEN}`,
      // Another host, port or scheme.
      `https://evil.example/i#${TOKEN}`,
      `https://${HOST}.evil.example/i#${TOKEN}`,
      `https://${HOST}@evil.example/i#${TOKEN}`,
      `https://${HOST}:443/i#${TOKEN}`,
      `http://${HOST}/i#${TOKEN}`,
      // A second #, an empty or malformed fragment, an encoded #, a query, another path.
      `https://${HOST}/i#${TOKEN}#`,
      `https://${HOST}/i#`,
      `https://${HOST}/i#${TOKEN}A`,
      `https://${HOST}/i%23${TOKEN}`,
      `https://${HOST}/i?x=1#${TOKEN}`,
      `https://${HOST}/i#${TOKEN}?x=1`,
      `https://${HOST}/i/#${TOKEN}`,
      `https://${HOST}/hesap#${TOKEN}`,
      `bargu://i#${TOKEN}`,
      // Not a whole link, or hidden inside text.
      `i#${TOKEN}`,
      `#${TOKEN}`,
      `see https://${HOST}/i#${TOKEN}`,
      `https://${HOST}/i#${TOKEN} now`,
    ]) {
      expect(inviteTokenFrom(scanned, HOST)).toBeNull();
    }
    // No invite host in this build: only bargu://.
    expect(inviteTokenFrom(`https://${HOST}/i#${TOKEN}`, undefined)).toBeNull();
    expect(inviteTokenFrom(`bargu://i/${TOKEN}`, undefined)).toBe(TOKEN);
  });
});
