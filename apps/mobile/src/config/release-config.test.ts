import { join } from 'node:path';

import createConfig from '../../app.config';
import easJson from '../../eas.json';

/**
 * The store-release rules that live in configuration files (apps/mobile/README.md "Mağaza sürümü"): a
 * wrong edit here would not fail any other test, only a store upload weeks later.
 */
interface BuildProfile {
  extends?: string;
  node?: string;
  pnpm?: string;
  distribution?: string;
  autoIncrement?: boolean;
  env?: Record<string, string>;
  android?: { buildType?: string };
}

interface EasJson {
  cli: { appVersionSource: string };
  build: Record<string, BuildProfile>;
}

const eas: EasJson = easJson;

/** Flags that switch developer-only code on (see scripts/check-bundle.mjs). */
const DEV_FLAGS = [
  'EXPO_PUBLIC_DEV_TOOLS',
  'EXPO_PUBLIC_TEST_BILLING',
  'EXPO_PUBLIC_BG_LIVE',
  'EXPO_PUBLIC_COSMETIC_KEYS',
];

/** What every permission in the release manifest is for: these stay (README "Android izinleri"). */
const KEPT_PERMISSIONS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CAMERA',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  // Local reminders and library tasks are set again after a restart.
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // The app lock: BiometricPrompt uses the fingerprint permission on Android 7 and 8 (minSdk 24).
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'com.google.android.c2dm.permission.RECEIVE',
];

const config = createConfig({
  projectRoot: join(__dirname, '../..'),
  staticConfigPath: null,
  packageJsonPath: null,
  config: {},
});

function profile(name: string): BuildProfile {
  const found = eas.build[name];
  if (found === undefined) throw new Error(`eas.json has no "${name}" profile`);
  return found;
}

describe('EAS build profiles', () => {
  it('builds the store release as an app bundle (K1): Google Play takes no APK', () => {
    expect(profile('production').android?.buildType).toBe('app-bundle');
    expect(profile('production').distribution).toBe('store');
  });

  it('keeps the test builds installable by hand: preview and development stay APKs', () => {
    expect(profile('preview').android?.buildType).toBe('apk');
    expect(profile('development').android?.buildType).toBe('apk');
  });

  it('numbers the versionCode from one remote counter that only goes up (K4)', () => {
    // EAS keeps the counter; cloud and local production builds share it. "local" would make every
    // machine count on its own.
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(profile('production').autoIncrement).toBe(true);
    // A versionCode written here would be ignored today and win the day someone flips the source.
    expect(config.android).toBeDefined();
    expect(config.android).not.toHaveProperty('versionCode');
  });

  it('turns no developer or staging flag on for production', () => {
    const base = profile('base').env ?? {};
    const production = profile('production').env ?? {};
    for (const flag of DEV_FLAGS) {
      expect(base).not.toHaveProperty(flag);
      expect(production).not.toHaveProperty(flag);
    }
  });
});

describe('app config', () => {
  it('names the closed-test version 0.9.0 (1.0.0 is the public release)', () => {
    expect(config.version).toBe('0.9.0');
  });

  it('removes from the release manifest what Bargu does not use, and nothing it needs', () => {
    const blocked = config.android?.blockedPermissions ?? [];
    for (const name of [
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.DETECT_SCREEN_CAPTURE',
      'android.permission.READ_APP_BADGE',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
    ]) {
      expect(blocked).toContain(name);
    }
    for (const name of KEPT_PERMISSIONS) {
      expect(blocked).not.toContain(name);
    }
    expect(new Set(blocked).size).toBe(blocked.length);
  });

  it('blocks the launcher badge permissions of ShortcutBadger, which only count badges', () => {
    const badge = (config.android?.blockedPermissions ?? []).filter(
      (name) => /launcher|badge/i.test(name) && !name.startsWith('android.permission.'),
    );
    expect(badge.length).toBeGreaterThanOrEqual(15);
  });
});
