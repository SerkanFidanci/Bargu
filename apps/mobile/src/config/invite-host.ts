const LABEL_CHARACTERS = /^[a-z0-9-]+$/;

/** A DNS label: 1-63 of a-z, 0-9 and "-", not starting or ending with "-". */
const isLabel = (label: string): boolean =>
  label.length <= 63 &&
  LABEL_CHARACTERS.test(label) &&
  !label.startsWith('-') &&
  !label.endsWith('-');

/**
 * The host invite links are opened on, from `EXPO_PUBLIC_INVITE_HOST` (docs/ADR/0009 Ek,
 * 2026-10-22): a bare, lower-case DNS host name of at least two labels, or nothing. The same rule
 * as the server's INVITE_HOST (apps/api src/config/env.ts) and the build's intent filter
 * (app.config.ts). Anything else is no host: the app then opens no https link at all, and a wrong
 * value never reaches the router (the build itself refuses it, app.config.ts).
 */
export function parseInviteHost(configured: string | undefined): string | undefined {
  if (configured === undefined || configured.length === 0 || configured.length > 253) {
    return undefined;
  }
  const labels = configured.split('.');
  return labels.length >= 2 && labels.every(isLabel) ? configured : undefined;
}

/**
 * This build's invite host: the staging host in development and preview builds (eas.json), none in
 * production until the permanent domain exists (K12). Without one, only bargu:// links open the
 * app (features/links/incoming-link.ts).
 */
// Static `process.env.EXPO_PUBLIC_*` access is required for Expo to inline the value.
export const inviteHost: string | undefined = parseInviteHost(process.env.EXPO_PUBLIC_INVITE_HOST);
