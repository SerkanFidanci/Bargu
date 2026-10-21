import { inviteTokenSchema } from '@bargu/schemas';

/** Longer than this is no link of Bargu's (an invite link is about 55 characters). */
export const MAX_LINK_LENGTH = 256;
/** Where a link the app does not know leads: the map. */
export const HOME = '/';

/**
 * The only screens a link from outside may open: an invite (bargu://i/…) and a guardian request
 * (bargu://g/…), each with a token of the one form the server makes. A bare bargu:// opens the app.
 */
const SCREENS: ReadonlySet<string> = new Set(['i', 'g']);

/**
 * What a link from outside the app opens (app/+native-intent.tsx), checked before the router
 * parses it (Faz 10 scan note: a malformed percent-encoding in expo-router's query-string,
 * decode-uri-component 0.2.2, could freeze the app). Too long, another scheme, any percent-
 * encoding, a query or fragment, an unknown screen or a malformed token: the map instead. No
 * Bargu link has any of those; the token is checked again on its screen.
 */
export function incomingPath(link: string): string {
  if (link.length > MAX_LINK_LENGTH) return HOME;
  if (/[%?#\\\s]/.test(link)) return HOME;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(link);
  if (scheme !== null && scheme[1]?.toLowerCase() !== 'bargu') return HOME;
  const path = scheme === null ? link : `/${scheme[2] ?? ''}`;
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const [empty, screen, token, ...rest] = trimmed.split('/');
  if (empty !== '' || rest.length > 0 || screen === undefined || !SCREENS.has(screen)) return HOME;
  const parsed = inviteTokenSchema.safeParse(token);
  return parsed.success ? `/${screen}/${parsed.data}` : HOME;
}
