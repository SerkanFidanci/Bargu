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
    icon: './assets/expo.icon',
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
  },
});
