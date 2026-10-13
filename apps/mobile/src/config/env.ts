import Constants from 'expo-constants';

import { resolveApiUrl, resolveMapUrl } from './api-url';

const apiUrl = resolveApiUrl({
  // Static `process.env.EXPO_PUBLIC_*` access is required for Expo to inline the value.
  configuredUrl: process.env.EXPO_PUBLIC_API_URL,
  hostUri: Constants.expoConfig?.hostUri,
  isDev: __DEV__,
});

/** Validated runtime configuration. Throws at startup when misconfigured (fail fast). */
export const env = {
  apiUrl,
  mapUrl: resolveMapUrl({
    configuredUrl: process.env.EXPO_PUBLIC_MAP_URL,
    apiUrl,
    isDev: __DEV__,
  }),
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;

/** Developer screens (e.g. /_dev/crypto). On in development and preview builds, off in production. */
export const DEV_TOOLS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';
