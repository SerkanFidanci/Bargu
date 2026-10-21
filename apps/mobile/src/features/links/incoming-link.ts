import { inviteTokenSchema } from '@bargu/schemas';

import { inviteHost } from '@/config/invite-host';

/** Longer than this is no link of Bargu's (an invite link is about 55 characters). */
export const MAX_LINK_LENGTH = 256;
/** Where a link the app does not know leads: the map. */
export const HOME = '/';

/**
 * The only screens a link from outside may open: an invite (bargu://i/…) and a guardian request
 * (bargu://g/…), each with a token of the one form the server makes. A bare bargu:// opens the app.
 * The same two open from the invite page's own address, https://<invite host>/i/… and /g/… (Android
 * App Links, docs/ADR/0009 Ek, 2026-10-22): no other https link opens anything.
 */
const SCREENS: ReadonlySet<string> = new Set(['i', 'g']);

/** Lower case for A-Z only: String.toLowerCase would also fold other characters into ASCII (the Kelvin sign into k). */
const asciiLowerCase = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/**
 * What a link from outside the app opens (app/+native-intent.tsx), checked before the router
 * parses it (Faz 10 scan note: a malformed percent-encoding in expo-router's query-string,
 * decode-uri-component 0.2.2, could freeze the app). Too long, another scheme, any percent-
 * encoding, a query or fragment, an unknown screen or a malformed token: the map instead. No
 * Bargu link has any of those; the token is checked again on its screen.
 *
 * An https link is Bargu's only when it is exactly https://<this build's invite host>/i/<token> or
 * /g/<token>: the host compared whole (so no other host, no lookalike such as the real host as a
 * prefix, a suffix, a subdomain or a user-info name, no port, no trailing dot, no http), the path
 * with nothing before, between or after the screen and the token (not even a trailing slash).
 * Without an invite host (`inviteHost` undefined, as in production for now) no https link opens.
 */
export function incomingPath(link: string, host: string | undefined = inviteHost): string {
  if (link.length > MAX_LINK_LENGTH) return HOME;
  if (/[%?#\\\s]/.test(link)) return HOME;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(link);
  let path = link;
  let secure = false;
  if (scheme !== null) {
    const name = scheme[1]?.toLowerCase();
    const rest = scheme[2] ?? '';
    if (name === 'bargu') {
      path = `/${rest}`;
    } else if (name === 'https' && host !== undefined) {
      // The authority is everything up to the first slash: it must be the host and nothing else.
      const slash = rest.indexOf('/');
      if (slash < 0 || asciiLowerCase(rest.slice(0, slash)) !== host) return HOME;
      path = rest.slice(slash);
      secure = true;
    } else {
      return HOME;
    }
  }
  const trimmed = !secure && path.endsWith('/') ? path.slice(0, -1) : path;
  const [empty, screen, token, ...rest] = trimmed.split('/');
  if (empty !== '' || rest.length > 0 || screen === undefined || !SCREENS.has(screen)) return HOME;
  const parsed = inviteTokenSchema.safeParse(token);
  return parsed.success ? `/${screen}/${parsed.data}` : HOME;
}
