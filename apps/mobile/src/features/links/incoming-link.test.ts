import { redirectSystemPath } from '../../app/+native-intent';
import { HOME, incomingPath, MAX_LINK_LENGTH } from './incoming-link';

/** A token of the server's form: 32 random bytes, base64url without padding (43 characters). */
const TOKEN = 'Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3';

describe('links from outside the app (Faz 10 scan note 1)', () => {
  it("open Bargu's own invite and guardian links", () => {
    expect(incomingPath(`bargu://i/${TOKEN}`)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(`bargu://g/${TOKEN}`)).toBe(`/g/${TOKEN}`);
    expect(incomingPath(`BARGU://i/${TOKEN}/`)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(`/i/${TOKEN}`)).toBe(`/i/${TOKEN}`);
    expect(incomingPath('bargu://')).toBe(HOME);
  });

  it('send a malformed or heavily percent-encoded link to the map, quickly', () => {
    // The kind that could make decode-uri-component 0.2.2 work for very long.
    const heavy = `bargu://i/${'%C2%B5%E0%A4%A'.repeat(15)}`;
    const broken = 'bargu://i/%E0%A4%A';
    const started = Date.now();
    expect(incomingPath(heavy)).toBe(HOME);
    expect(incomingPath(broken)).toBe(HOME);
    expect(incomingPath(`bargu://i/${TOKEN}?next=%ff%fe`)).toBe(HOME);
    expect(incomingPath(`bargu://i/${TOKEN}#%`)).toBe(HOME);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('send anything too long, another scheme or an unknown screen to the map', () => {
    expect(incomingPath(`bargu://i/${'A'.repeat(MAX_LINK_LENGTH)}`)).toBe(HOME);
    expect(incomingPath(`https://evil.example/i/${TOKEN}`)).toBe(HOME);
    expect(incomingPath(`javascript://i/${TOKEN}`)).toBe(HOME);
    expect(incomingPath('bargu://security')).toBe(HOME);
    expect(incomingPath('bargu://_dev/billing')).toBe(HOME);
    expect(incomingPath(`bargu://i/${TOKEN}/accept`)).toBe(HOME);
    expect(incomingPath('bargu://i/short')).toBe(HOME);
    expect(incomingPath(`bargu://i/..\\${TOKEN}`)).toBe(HOME);
    expect(incomingPath(`bargu://i/ ${TOKEN}`)).toBe(HOME);
  });

  it('never throws to the router, whatever comes', () => {
    for (const path of ['', '%', '\u0000', 'bargu://i/%%%%', 'x'.repeat(100_000)]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(HOME);
    }
  });
});
