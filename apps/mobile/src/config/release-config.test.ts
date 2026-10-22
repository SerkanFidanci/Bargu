import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AndroidConfig } from 'expo/config-plugins';

import createConfig, {
  BACKUP_RULES,
  backupRules,
  EXTRACTION_RULES,
  extractionRules,
  pointAtRules,
} from '../../app.config';
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
  // expo-screen-capture registers its Android 14+ capture callback at start: blocked, the app
  // closes at once (869a7af).
  'android.permission.DETECT_SCREEN_CAPTURE',
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

  it('turns test billing and the developer tools on for development and preview only', () => {
    for (const name of ['development', 'preview']) {
      expect(profile(name).env).toMatchObject({
        EXPO_PUBLIC_DEV_TOOLS: '1',
        EXPO_PUBLIC_TEST_BILLING: '1',
      });
    }
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

  it('keeps the permission expo-screen-capture needs when it starts on Android 14 and later', () => {
    // The module registers its capture callback in OnCreate, listener or not; Android throws
    // without DETECT_SCREEN_CAPTURE and the app closes at start (869a7af on the owner's phone).
    const module = join(
      dirname(require.resolve('expo-screen-capture/package.json')),
      'android/src/main/java/expo/modules/screencapture/ScreenCaptureModule.kt',
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the installed library's own source, a fixed path
    const source = readFileSync(module, 'utf8');
    expect(source).toContain('registerScreenCaptureCallback');
    expect(config.android?.blockedPermissions ?? []).not.toContain(
      'android.permission.DETECT_SCREEN_CAPTURE',
    );
  });

  it('blocks the launcher badge permissions of ShortcutBadger, which only count badges', () => {
    const badge = (config.android?.blockedPermissions ?? []).filter(
      (name) => /launcher|badge/i.test(name) && !name.startsWith('android.permission.'),
    );
    expect(badge.length).toBeGreaterThanOrEqual(15);
  });
});

/** The storage domains Android backs up (and the device-protected ones): all must be excluded. */
const ALL_DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

/** Every `exclude` of a rules section as `domain:path`, and the elements it holds besides. */
function excluded(section: unknown): { rules: string[]; others: string[] } {
  const body = section as { exclude?: { $: { domain: string; path: string } }[] };
  const { exclude = [], ...others } = body;
  return {
    rules: exclude.map(({ $ }) => `${$.domain}:${$.path}`),
    others: Object.keys(others),
  };
}

describe('Android backup (apps/mobile/README.md "Android yedekleme")', () => {
  const everything = ALL_DOMAINS.map((domain) => `${domain}:.`);

  /** A manifest as the prebuild template and expo-secure-store's backup option would leave it. */
  function manifestWith(
    attributes: Record<string, string>,
  ): AndroidConfig.Manifest.AndroidManifest {
    return {
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        queries: [],
        application: [{ $: { 'android:name': '.MainApplication', ...attributes } }],
      },
    };
  }

  it('is off: Expo writes android:allowBackup="false" from the app config', () => {
    expect(config.android?.allowBackup).toBe(false);
    const manifest = manifestWith({ 'android:allowBackup': 'true' });
    AndroidConfig.AllowBackup.setAllowBackup(config, manifest);
    expect(manifest.manifest.application?.[0]?.$['android:allowBackup']).toBe('false');
  });

  it('points Android 11 and older, and Android 12+ with its device transfer, at Bargu rules', () => {
    // expo-secure-store's own pair is replaced, not kept beside: one set in the manifest.
    const manifest = manifestWith({
      'android:fullBackupContent': '@xml/secure_store_backup_rules',
      'android:dataExtractionRules': '@xml/secure_store_data_extraction_rules',
    });
    pointAtRules(manifest);
    const attributes = manifest.manifest.application?.[0]?.$;
    expect(attributes?.['android:fullBackupContent']).toBe(`@xml/${BACKUP_RULES}`);
    expect(attributes?.['android:dataExtractionRules']).toBe(`@xml/${EXTRACTION_RULES}`);
    expect(BACKUP_RULES).not.toContain('secure_store');
    expect(EXTRACTION_RULES).not.toContain('secure_store');
  });

  it("leaves expo-secure-store's backup rules out, so the manifest has one set of rules", () => {
    const entry = (config.plugins ?? []).find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-secure-store',
    );
    expect(entry).toEqual(['expo-secure-store', { configureAndroidBackup: false }]);
  });

  it('excludes everything from the old rules, and includes nothing', () => {
    const [root, ...rest] = Object.entries(backupRules());
    expect(rest).toEqual([]);
    expect(root?.[0]).toBe('full-backup-content');
    const { rules, others } = excluded(root?.[1]);
    expect(rules).toEqual(everything);
    expect(others).toEqual([]);
  });

  it('excludes everything from cloud backup AND from the device transfer, and includes nothing', () => {
    const [root, ...rest] = Object.entries(extractionRules());
    expect(rest).toEqual([]);
    expect(root?.[0]).toBe('data-extraction-rules');
    const sections = root?.[1] as Record<string, unknown>;
    expect(Object.keys(sections).sort()).toEqual(['cloud-backup', 'device-transfer']);
    for (const section of Object.values(sections)) {
      const { rules, others } = excluded(section);
      expect(rules).toEqual(everything);
      expect(others).toEqual([]);
    }
  });
});
