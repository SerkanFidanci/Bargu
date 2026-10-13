import type { ConfigContext, ExpoConfig } from 'expo/config';

// `extra.eas.projectId` is added once `eas init` has linked the project (see apps/mobile/README.md).

/** Reverse-DNS app identifier; permanent once published to the stores. */
const APP_ID = 'app.bargu';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Bargu',
  slug: 'bargu',
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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
