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
  },
  plugins: [
    'expo-router',
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
    // QR codes only (adding friends, comparing safety numbers): camera, never the microphone.
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
  },
});
