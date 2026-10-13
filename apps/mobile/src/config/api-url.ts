import { z } from 'zod';

/** Port the API listens on in local development (apps/api/.env.example). */
export const DEV_API_PORT = 3000;

const httpsUrl = z.url({ protocol: /^https$/ });
const httpOrHttpsUrl = z.url({ protocol: /^https?$/ });

export interface ApiUrlInput {
  /** `EXPO_PUBLIC_API_URL`, if set. */
  configuredUrl: string | undefined;
  /** Metro dev server address (`host:port`) reported by Expo in development. */
  hostUri: string | undefined;
  isDev: boolean;
}

/**
 * Resolves the API base URL.
 * - An explicit `EXPO_PUBLIC_API_URL` always wins. Release builds require HTTPS.
 * - In development without one, the API is assumed on the machine running Metro, so a phone on the
 *   same Wi-Fi works without configuration.
 */
export function resolveApiUrl({ configuredUrl, hostUri, isDev }: ApiUrlInput): string {
  if (configuredUrl) {
    const parsed = (isDev ? httpOrHttpsUrl : httpsUrl).safeParse(configuredUrl);
    if (!parsed.success) {
      throw new Error(
        isDev
          ? 'EXPO_PUBLIC_API_URL must be an http(s) URL'
          : 'EXPO_PUBLIC_API_URL must be an https URL in release builds',
      );
    }
    return parsed.data.replace(/\/+$/, '');
  }
  if (isDev && hostUri) {
    const host = hostUri.slice(0, hostUri.lastIndexOf(':')) || hostUri;
    return `http://${host}:${String(DEV_API_PORT)}`;
  }
  throw new Error('EXPO_PUBLIC_API_URL is required');
}

export interface MapUrlInput {
  /** `EXPO_PUBLIC_MAP_URL`, if set. */
  configuredUrl: string | undefined;
  apiUrl: string;
  isDev: boolean;
}

/**
 * Base URL of the self-hosted map files (vector tiles, label fonts, icons). Defaults to `/map` on
 * the API host, so the phone talks to no third party while showing the map (BARGU_PLAN §1).
 */
export function resolveMapUrl({ configuredUrl, apiUrl, isDev }: MapUrlInput): string {
  if (!configuredUrl) return `${apiUrl}/map`;
  const parsed = (isDev ? httpOrHttpsUrl : httpsUrl).safeParse(configuredUrl);
  if (!parsed.success) {
    throw new Error(
      isDev
        ? 'EXPO_PUBLIC_MAP_URL must be an http(s) URL'
        : 'EXPO_PUBLIC_MAP_URL must be an https URL in release builds',
    );
  }
  return parsed.data.replace(/\/+$/, '');
}
