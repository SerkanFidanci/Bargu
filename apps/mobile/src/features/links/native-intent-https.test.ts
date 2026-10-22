import { getInitialURL, subscribe } from 'expo-router/build/link/linking';
import { type EmitterSubscription, Linking, Platform } from 'react-native';

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

  it('opens what the app shares, the token in the fragment', () => {
    expect(redirectSystemPath({ path: `https://${HOST}/i#${TOKEN}`, initial: true })).toBe(
      `/i/${TOKEN}`,
    );
    expect(redirectSystemPath({ path: `https://${HOST}/g#${TOKEN}`, initial: false })).toBe(
      `/g/${TOKEN}`,
    );
  });

  it('still sends every other https link to the map', () => {
    for (const path of [
      `https://evil.example/i/${TOKEN}`,
      `https://evil.example/i#${TOKEN}`,
      `https://${HOST}.evil.example/i#${TOKEN}`,
      `https://${HOST}@evil.example/i/${TOKEN}`,
      `https://evil.example@${HOST}/i#${TOKEN}`,
      `https://${HOST}:8443/i#${TOKEN}`,
      `http://${HOST}/i#${TOKEN}`,
      `https://${HOST}/i/${TOKEN}?x=1`,
      `https://${HOST}/i?x=1#${TOKEN}`,
      `https://${HOST}/i#${TOKEN}#`,
      `https://${HOST}/i#`,
      `https://${HOST}/i%23${TOKEN}`,
      `https://${HOST}/hesap`,
      `https://${HOST}`,
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(HOME);
    }
  });

  it('never throws, whatever comes', () => {
    for (const path of [
      '',
      '%',
      `https://${HOST}`,
      `https://${HOST}/%`,
      `https://${HOST}/i#`,
      'https://',
      'https:',
      '#',
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(HOME);
    }
    expect(redirectSystemPath({ path: 'https://'.padEnd(100_000, 'a'), initial: true })).toBe(HOME);
    expect(
      redirectSystemPath({ path: `https://${HOST}/i#`.padEnd(100_000, '#'), initial: true }),
    ).toBe(HOME);
  });
});

/**
 * What the phone really hands the router. React Native's Android IntentModule answers
 * getInitialURL with `intent.data.toString()` and tells a running app about a new intent with
 * `emitNewIntentReceived(uri)`, an event `url` with `uri.toString()` (react-native 0.86.3,
 * ReactAndroid IntentModule.kt and DeviceEventManagerModule.kt). `Uri.toString()` of an App Link's
 * data is the whole link as it was tapped, fragment included (Android matches an intent filter on
 * scheme, host and path and ignores the fragment). expo-router 57.0.25 passes that string,
 * unchanged, to redirectSystemPath (getLinkingConfig.js getInitialURL, link/linking.js subscribe).
 * The strings below are what an App Link tap on the shared link gives.
 */
describe('the intent data of a tapped App Link reaches redirectSystemPath with its fragment', () => {
  const shared = `https://${HOST}/i#${TOKEN}`;
  const sharedGuardian = `https://${HOST}/g#${TOKEN}`;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('on a cold start (Linking.getInitialURL, Android)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(shared);
    // expo-router's own getInitialURL, then the filter it calls next (getLinkingConfig.js).
    const url = await getInitialURL();
    expect(initial).toHaveBeenCalled();
    expect(url).toBe(shared);
    expect(redirectSystemPath({ path: String(url), initial: true })).toBe(`/i/${TOKEN}`);
  });

  it('on a new intent for a running app (the `url` event)', async () => {
    let deliver: ((event: { url: string }) => void) | undefined;
    jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, handler) => {
      deliver = handler;
      return { remove: jest.fn() } as unknown as EmitterSubscription;
    });
    const opened: string[] = [];
    const unsubscribe = subscribe(
      { redirectSystemPath },
      undefined,
    )((href) => {
      opened.push(href);
    });
    // Two taps, as DeviceEventManagerModule.emitNewIntentReceived sends them.
    deliver?.({ url: shared });
    deliver?.({ url: sharedGuardian });
    deliver?.({ url: `https://evil.example/i#${TOKEN}` });
    deliver?.({ url: `https://${HOST}/i#` });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    // The first two open their screens; the others never reach the router as anything but the map.
    expect(opened).toEqual([`/i/${TOKEN}`, `/g/${TOKEN}`, HOME, HOME]);
  });
});
