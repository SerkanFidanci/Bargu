import { redirectSystemPath } from '../../app/+native-intent';
import { HOME } from './incoming-link';

// A preview build: its invite host is configured (eas.json EXPO_PUBLIC_INVITE_HOST).
jest.mock('@/config/invite-host', () => ({ inviteHost: 'api.46-62-162-70.sslip.io' }));

const HOST = 'api.46-62-162-70.sslip.io';
const TOKEN = 'Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3';

describe('+native-intent with an invite host (Android App Links)', () => {
  it("opens the invite page's own links on the same screens as bargu://", () => {
    expect(redirectSystemPath({ path: `https://${HOST}/i/${TOKEN}`, initial: true })).toBe(
      `/i/${TOKEN}`,
    );
    expect(redirectSystemPath({ path: `https://${HOST}/g/${TOKEN}`, initial: false })).toBe(
      `/g/${TOKEN}`,
    );
    expect(redirectSystemPath({ path: `bargu://i/${TOKEN}`, initial: true })).toBe(`/i/${TOKEN}`);
  });

  it('still sends every other https link to the map', () => {
    for (const path of [
      `https://evil.example/i/${TOKEN}`,
      `https://${HOST}.evil.example/i/${TOKEN}`,
      `https://${HOST}@evil.example/i/${TOKEN}`,
      `https://evil.example@${HOST}/i/${TOKEN}`,
      `https://${HOST}:8443/i/${TOKEN}`,
      `http://${HOST}/i/${TOKEN}`,
      `https://${HOST}/i/${TOKEN}?x=1`,
      `https://${HOST}/hesap`,
      `https://${HOST}`,
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(HOME);
    }
  });

  it('never throws, whatever comes', () => {
    for (const path of ['', '%', `https://${HOST}`, `https://${HOST}/%`, 'https://', 'https:']) {
      expect(redirectSystemPath({ path, initial: true })).toBe(HOME);
    }
    expect(redirectSystemPath({ path: 'https://'.padEnd(100_000, 'a'), initial: true })).toBe(HOME);
  });
});
