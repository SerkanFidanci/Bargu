import Constants from 'expo-constants';

import { resolveApiUrl } from './api-url';

/** Validated runtime configuration. Throws at startup when misconfigured (fail fast). */
export const env = {
  apiUrl: resolveApiUrl({
    // Static `process.env.EXPO_PUBLIC_*` access is required for Expo to inline the value.
    configuredUrl: process.env.EXPO_PUBLIC_API_URL,
    hostUri: Constants.expoConfig?.hostUri,
    isDev: __DEV__,
  }),
} as const;
