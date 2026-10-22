import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';
import {
  AndroidConfig as ConfigPluginsAndroid,
  type ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  XML,
} from 'expo/config-plugins';

type AndroidConfig = NonNullable<ExpoConfig['android']>;

/** Reverse-DNS app identifier; permanent once published to the stores. */
const APP_ID = 'app.bargu';

/** EAS project (`eas init`); identifiers, not secrets. */
const EAS_OWNER = 'otenus';
const EAS_PROJECT_ID = '56c64a85-3555-4469-a686-4af1c67aa9ce';

/**
 * Fonts embedded at build time (never fetched at runtime): Inter for text, Bricolage Grotesque for
 * display. See src/theme/typography.ts for how each weight is selected per platform.
 */
const FONT_DIR = 'node_modules/@expo-google-fonts';

/**
 * Apple developer team (10 characters), from the EAS environment once the Apple account exists.
 * Until then iOS builds cannot be signed and the notification extension shares nothing.
 */
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
/**
 * Keychain group the app shares with its Notification Service Extension (docs/ADR/0016): the
 * device's X25519 key, the trusted contacts and the mutes, nothing else.
 */
const PUSH_KEYCHAIN_GROUP = 'app.bargu.push';

/** Brand violet (src/theme/colors.ts lightColors.primary), for the icon background and splash. */
const BRAND_VIOLET = '#5B34F2';

/**
 * Android App Links (docs/ADR/0009 Ek and Ek 2, 2026-10-22): with the invite host set for this
 * build profile (eas.json EXPO_PUBLIC_INVITE_HOST: the staging host in development and preview,
 * none in production until the permanent domain exists), https://<host>/i and /g open the app. That
 * is the form the app shares, https://<host>/i#<token>: Android matches the path and ignores the
 * fragment, which stays in the intent's data (the app reads it, src/features/links/incoming-link.ts).
 * The earlier form with the token in the path, /i/<token> and /g/<token>, opens it too. The
 * intent filter names each path exactly (`path`) and the old form by its prefix (`pathPrefix`
 * "/i/"); a bare prefix "/i" would also take /invite/card.png and anything else starting with i.
 * Android verifies the claim against https://<host>/.well-known/assetlinks.json (apps/api, which
 * names the package and this build's signing certificate); until it verifies, those links open in
 * the browser, on the invite page. The same value is what the app lets through, so a wrong one
 * fails the build here. Same rule as the app's src/config/invite-host.ts and the server's
 * INVITE_HOST.
 */
const INVITE_HOST = process.env.EXPO_PUBLIC_INVITE_HOST;
const isHostLabel = (label: string): boolean =>
  label.length <= 63 &&
  /^[a-z0-9-]+$/.test(label) &&
  !label.startsWith('-') &&
  !label.endsWith('-');
export function inviteIntentFilters(
  host: string | undefined,
): NonNullable<AndroidConfig['intentFilters']> {
  if (host === undefined || host === '') return [];
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || !labels.every(isHostLabel)) {
    throw new Error(
      'EXPO_PUBLIC_INVITE_HOST must be a lower-case host name such as invite.example.com ' +
        '(no scheme, port or path)',
    );
  }
  return [
    {
      action: 'VIEW',
      autoVerify: true,
      data: [
        // What the app shares: https://<host>/i#<token>, /g#<token> (the fragment is no path).
        { scheme: 'https', host, path: '/i' },
        { scheme: 'https', host, path: '/g' },
        // The earlier form: https://<host>/i/<token>, /g/<token>.
        { scheme: 'https', host, pathPrefix: '/i/' },
        { scheme: 'https', host, pathPrefix: '/g/' },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];
}

/**
 * Android backup off, for good (apps/mobile/README.md "Android yedekleme"): nothing of Bargu goes
 * to Google Drive and nothing is carried to a new phone by the device-to-device transfer. The only
 * data store is the AES-256 vault whose key lives in SecureStore; a restore would put the file on a
 * phone that does not hold the key, which the app could only read as broken. Three things have to
 * agree, because each Android version reads a different one:
 *
 *   - `android:allowBackup="false"` (Android 11 and older; cloud backup on 12+). It comes from
 *     `android.allowBackup` below, where Expo itself writes it into the manifest.
 *   - `android:fullBackupContent` (Android 11 and older): rules that exclude everything.
 *   - `android:dataExtractionRules` (Android 12+): the same, for cloud backup AND device transfer.
 *     Android 12+ keeps doing the device-to-device transfer unless these rules exclude it,
 *     whatever `allowBackup` says.
 *
 * expo-secure-store's own `configureAndroidBackup` writes a second pair of those two attributes
 * (rules that only keep its preferences out of an otherwise included backup). It is switched off in
 * the plugin list below, so the merged manifest carries exactly this one set. The built manifest
 * is checked by scripts/check-manifest.mjs.
 *
 * Written here, not as a file of its own: Expo transpiles app.config.ts alone and cannot require a
 * second TypeScript file from it.
 */
export const BACKUP_RULES = 'bargu_backup_rules';
export const EXTRACTION_RULES = 'bargu_data_extraction_rules';

/**
 * Every storage domain Android knows: the app's data directory and its parts, external storage,
 * and the device-protected (direct boot) counterparts.
 */
const BACKUP_DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
] as const;

const excludeEverything = () => BACKUP_DOMAINS.map((domain) => ({ $: { domain, path: '.' } }));

/** `res/xml` rules for Android 11 and older (`android:fullBackupContent`), as the XML writer takes them. */
export function backupRules() {
  return { 'full-backup-content': { exclude: excludeEverything() } };
}

/** `res/xml` rules for Android 12 and newer (`android:dataExtractionRules`). */
export function extractionRules() {
  return {
    'data-extraction-rules': {
      'cloud-backup': { exclude: excludeEverything() },
      'device-transfer': { exclude: excludeEverything() },
    },
  };
}

/** Points the `<application>` element at the two rule files. */
export function pointAtRules(manifest: ConfigPluginsAndroid.Manifest.AndroidManifest): void {
  const application = ConfigPluginsAndroid.Manifest.getMainApplicationOrThrow(manifest);
  application.$['android:fullBackupContent'] = `@xml/${BACKUP_RULES}`;
  application.$['android:dataExtractionRules'] = `@xml/${EXTRACTION_RULES}`;
}

export const withNoAndroidBackup: ConfigPlugin = (config) => {
  const pointed = withAndroidManifest(config, (current) => {
    pointAtRules(current.modResults);
    return current;
  });
  // The rule files go into the prebuilt project's resources (android/ is generated).
  return withDangerousMod(pointed, [
    'android',
    async (current) => {
      const resources = await ConfigPluginsAndroid.Paths.getResourceFolderAsync(
        current.modRequest.projectRoot,
      );
      await XML.writeXMLAsync({
        path: join(resources, 'xml', `${BACKUP_RULES}.xml`),
        xml: backupRules(),
      });
      await XML.writeXMLAsync({
        path: join(resources, 'xml', `${EXTRACTION_RULES}.xml`),
        xml: extractionRules(),
      });
      return current;
    },
  ]);
};

/**
 * Permissions that libraries or the prebuild template add to the release manifest and Bargu does
 * not use: each is removed from the merged manifest (tools:node="remove"). Source and reason of
 * every one, and the ones that stay, are in apps/mobile/README.md "Android izinleri"; the list is
 * checked against the built manifest by scripts/build-android-local.sh (scripts/check-manifest.mjs)
 * and against the kept ones by src/config/release-config.test.ts.
 */
const BLOCKED_PERMISSIONS = [
  // The photo picker library declares the microphone (for video); Bargu never records sound.
  'android.permission.RECORD_AUDIO',
  // Prebuild template: the developer menu's overlay, debug builds only.
  'android.permission.SYSTEM_ALERT_WINDOW',
  // Template, expo-file-system, expo-image-picker, expo-screen-capture (Android 12 and older):
  // photos come from the system picker and the export is written to a folder the user picks (SAF),
  // neither needs them.
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  // expo-screen-capture, Android 12 and older: only for its screenshot listener, which Bargu does
  // not use. Google Play limits READ_MEDIA_IMAGES. DETECT_SCREEN_CAPTURE is NOT blocked: from
  // Android 14 the module registers its capture callback when it is created, whether anyone listens
  // or not, and without the permission that throws and the app closes at start (869a7af on the
  // owner's S25 Ultra). It is a normal permission: granted at install, never asked.
  'android.permission.READ_MEDIA_IMAGES',
  // expo-application's Install Referrer library: nothing in Bargu reads the install referrer.
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  // ShortcutBadger (expo-notifications): app icon badge counts on launchers; Bargu sets none.
  'android.permission.READ_APP_BADGE',
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.huawei.android.launcher.permission.CHANGE_BADGE',
  'com.huawei.android.launcher.permission.READ_SETTINGS',
  'com.huawei.android.launcher.permission.WRITE_SETTINGS',
  'com.majeur.launcher.permission.UPDATE_BADGE',
  'com.oppo.launcher.permission.READ_SETTINGS',
  'com.oppo.launcher.permission.WRITE_SETTINGS',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
];

const FONTS = {
  Inter: [
    [400, 'inter/400Regular/Inter_400Regular.ttf'],
    [500, 'inter/500Medium/Inter_500Medium.ttf'],
    [600, 'inter/600SemiBold/Inter_600SemiBold.ttf'],
    [700, 'inter/700Bold/Inter_700Bold.ttf'],
  ],
  'Bricolage Grotesque': [
    [700, 'bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'],
    [800, 'bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf'],
  ],
} as const;

const appConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Bargu',
  slug: 'bargu',
  owner: EAS_OWNER,
  // The closed test (docs/play-store/KONTROL-LISTESI.md D6); 1.0.0 is the public release.
  version: '0.9.0',
  scheme: 'bargu',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    // Permission texts follow the phone's language (native-locales/*.json).
    infoPlist: { CFBundleAllowMixedLocalizations: true },
    ...(APPLE_TEAM_ID === undefined ? {} : { appleTeamId: APPLE_TEAM_ID }),
    entitlements: {
      'keychain-access-groups': [`$(AppIdentifierPrefix)${PUSH_KEYCHAIN_GROUP}`],
    },
  },
  locales: { tr: './native-locales/tr.json', en: './native-locales/en.json' },
  android: {
    package: APP_ID,
    // Firebase config for push (FCM), provided by an EAS file variable; absent locally (push off).
    ...(process.env.GOOGLE_SERVICES_JSON === undefined
      ? {}
      : { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }),
    adaptiveIcon: {
      // Brand violet behind the pin (scripts/build-icons.mjs renders the layers).
      backgroundColor: BRAND_VIOLET,
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // No cloud backup and no restore on any Android version; the rules for Android 12+ and for the
    // device-to-device transfer come from withNoAndroidBackup (end of this file).
    allowBackup: false,
    blockedPermissions: BLOCKED_PERMISSIONS,
    // https invite links open the app (App Links); none for a build without an invite host.
    ...(INVITE_HOST === undefined || INVITE_HOST === ''
      ? {}
      : { intentFilters: inviteIntentFilters(INVITE_HOST) }),
  },
  plugins: [
    'expo-router',
    // The iOS Notification Service Extension (targets/notification-service, docs/ADR/0016).
    '@bacons/apple-targets',
    [
      'expo-splash-screen',
      {
        backgroundColor: BRAND_VIOLET,
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    ['expo-localization', { supportedLocales: { ios: ['tr', 'en'], android: ['tr', 'en'] } }],
    // Device keys never leave the phone: in no Android backup at all (allowBackup, and the rules of
    // withNoAndroidBackup at the end of this file) and not in iCloud (the *_THIS_DEVICE_ONLY
    // keychain class used in src/features/auth/device-key-store.ts). expo-secure-store's own backup
    // rules stay off, so the manifest carries one set of rules and not two.
    ['expo-secure-store', { configureAndroidBackup: false }],
    [
      'expo-font',
      {
        android: {
          fonts: Object.entries(FONTS).map(([fontFamily, files]) => ({
            fontFamily,
            fontDefinitions: files.map(([weight, file]) => ({
              path: `${FONT_DIR}/${file}`,
              weight,
            })),
          })),
        },
        ios: {
          fonts: Object.values(FONTS).flatMap((files) =>
            files.map(([, file]) => `${FONT_DIR}/${file}`),
          ),
        },
      },
    ],
    // MapLibre Native; Android keeps its own location engine (no Google Play services).
    '@maplibre/maplibre-react-native',
    // System notifications for friend and circle news (docs/ADR/0010); white pin on brand violet.
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: BRAND_VIOLET,
        defaultChannel: 'social',
      },
    ],
    // Location for circles (docs/ADR/0011): only the "while using" permission. On Android a
    // foreground service with a visible notification keeps it going on a locked screen, so the
    // background location permission is never asked for; iOS continues updates started in the app.
    [
      'expo-location',
      {
        // Turkish devices get native-locales/tr.json.
        locationWhenInUsePermission:
          'Bargu shares your location, end-to-end encrypted, only with the circles you choose.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/images/notification-icon.png',
      },
    ],
    // Profile photo from the library (docs/ADR/0014); never the microphone. Android 13+
    // uses the system photo picker without any permission.
    [
      'expo-image-picker',
      {
        // Turkish devices get native-locales/tr.json.
        photosPermission:
          'Bargu uses a photo you pick as your profile picture. It is encrypted before it leaves your phone.',
        // The camera stays for QR codes (expo-camera below); same text, nothing recorded.
        cameraPermission:
          "Bargu uses the camera to read your friend's QR code. Nothing is recorded.",
        microphonePermission: false,
      },
    ],
    // QR codes only (adding friends, comparing safety numbers): camera, never the microphone.
    // The optional app lock (Faz 9, docs/ADR/0021): Face ID, fingerprint or the phone's passcode.
    [
      'expo-local-authentication',
      {
        // Turkish devices get native-locales/tr.json.
        faceIDPermission: 'Bargu uses Face ID to unlock the app when you turn on the app lock.',
      },
    ],
    [
      'expo-camera',
      {
        // Turkish devices get native-locales/tr.json (see `locales` below).
        cameraPermission:
          "Bargu uses the camera to read your friend's QR code. Nothing is recorded.",
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
    // The full keychain group (team prefix included) the app writes for the extension.
    ...(APPLE_TEAM_ID === undefined
      ? {}
      : { iosPushKeychainGroup: `${APPLE_TEAM_ID}.${PUSH_KEYCHAIN_GROUP}` }),
  },
});

// The backup rules apply as a mod on the whole config: Expo types its plugin list as names only.
export default (context: ConfigContext): ExpoConfig => withNoAndroidBackup(appConfig(context));
