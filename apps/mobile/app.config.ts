import type { ConfigContext, ExpoConfig } from 'expo/config';

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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Bargu',
  slug: 'bargu',
  owner: EAS_OWNER,
  version: '0.1.0',
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
    // The photo picker library declares the microphone (for video); Bargu never records sound.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
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
    // Device keys never leave the phone: excluded from Android auto backup (and iCloud by the
    // *_THIS_DEVICE_ONLY keychain class used in src/features/auth/device-key-store.ts).
    ['expo-secure-store', { configureAndroidBackup: true }],
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
