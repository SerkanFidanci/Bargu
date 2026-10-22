import { inviteTokenFrom } from '../circles/invite-link';
import { guardianTokenFrom } from './guardian-link';

const TOKEN = 'A'.repeat(42) + 'b';

describe('guardianTokenFrom (docs/ADR/0023 §4)', () => {
  it("reads the token of a child's guardian code, and only that", () => {
    expect(guardianTokenFrom(`bargu://g/${TOKEN}`)).toBe(TOKEN);
    expect(guardianTokenFrom(` bargu://g/${TOKEN}\n`)).toBe(TOKEN);
    for (const scanned of [
      '',
      TOKEN,
      `bargu://i/${TOKEN}`,
      `https://evil.example/g/${TOKEN}`,
      `bargu://g/${TOKEN}x`,
      `bargu://g/${TOKEN}/extra`,
    ]) {
      expect(guardianTokenFrom(scanned)).toBeNull();
    }
    // A guardian code is never taken for an invite, nor the other way round.
    expect(inviteTokenFrom(`bargu://g/${TOKEN}`)).toBeNull();
  });

  it("reads all three forms on the invite host: bargu://, the page's path form, the fragment", () => {
    const host = 'api.46-62-162-70.sslip.io';
    for (const scanned of [
      `bargu://g/${TOKEN}`,
      `https://${host}/g/${TOKEN}`,
      `https://${host}/g#${TOKEN}`,
      ` https://${host}/g#${TOKEN}\n`,
    ]) {
      expect(guardianTokenFrom(scanned, host)).toBe(TOKEN);
    }
    for (const scanned of [
      `https://${host}/i#${TOKEN}`,
      `https://evil.example/g#${TOKEN}`,
      `https://${host}@evil.example/g#${TOKEN}`,
      `https://${host}:443/g#${TOKEN}`,
      `https://${host}/g#${TOKEN}#`,
      `https://${host}/g#`,
      `https://${host}/g%23${TOKEN}`,
      `https://${host}/g?x#${TOKEN}`,
      `https://${host}/g/#${TOKEN}`,
      `bargu://g#${TOKEN}`,
    ]) {
      expect(guardianTokenFrom(scanned, host)).toBeNull();
    }
    expect(inviteTokenFrom(`https://${host}/g#${TOKEN}`, host)).toBeNull();
    expect(guardianTokenFrom(`https://${host}/g#${TOKEN}`, undefined)).toBeNull();
  });
});
