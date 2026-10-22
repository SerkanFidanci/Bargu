import { inviteTokenSchema } from '@bargu/schemas';

import { inviteHost } from '@/config/invite-host';

/** Longer than this is no link of Bargu's (an invite link is about 60 characters). */
export const MAX_LINK_LENGTH = 256;
/** Where a link the app does not know leads: the map. */
export const HOME = '/';

/**
 * The only screens a link from outside may open: an invite and a guardian request, each with a
 * token of the one form the server makes. They come in three forms (docs/ADR/0009 Ek and Ek 2,
 * 2026-10-22):
 *
 * - `bargu://i/<token>`, `bargu://g/<token>`: the first form; the app's own scheme. A bare
 *   `bargu://` opens the app.
 * - `https://<invite host>/i/<token>`, `/g/<token>`: the invite page's own address with the token in
 *   the path (Android App Links), kept while links of that form are still around.
 * - `https://<invite host>/i#<token>`, `/g#<token>`: what the app shares. The token is in the
 *   fragment, so it never goes in an HTTP request (server, proxy and preview crawlers do not see it).
 *
 * No other https link opens anything.
 */
const SCREENS: ReadonlySet<string> = new Set(['i', 'g']);

/** A Bargu link: which screen it opens and the token (of the server's form) it carries. */
export interface BarguLink {
  screen: 'i' | 'g';
  token: string;
}

/** Lower case for A-Z only: String.toLowerCase would also fold other characters into ASCII (the Kelvin sign into k). */
const asciiLowerCase = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/**
 * The screen and token of a Bargu link in any of the three forms, or null: never trusted blindly.
 * Checked before anything is parsed (Faz 10 scan note: a malformed percent-encoding in
 * expo-router's query-string, decode-uri-component 0.2.2, could freeze the app). Too long, another
 * scheme, any percent-encoding (so no `%23` either), a query, a second `#`, an unknown screen or a
 * malformed token: null. No Bargu link has any of those.
 *
 * An https link is Bargu's only when it is exactly one of the two https forms above on this build's
 * invite host: the host compared whole (so no other host, no lookalike such as the real host as a
 * prefix, a suffix, a subdomain or a user-info name, no port, no trailing dot, no http), nothing
 * before, between or after the screen and the token (not even a trailing slash), and a fragment only
 * straight after `/i` or `/g`. Without an invite host (`host` undefined, as in production for now)
 * no https link opens.
 *
 * `lenient` is for what the system hands the router (a bare `/i/<token>` path too, and a trailing
 * slash on `bargu://`); a scanned code or a pasted link is strict.
 */
export function parseBarguLink(
  link: string,
  host: string | undefined = inviteHost,
  lenient = false,
): BarguLink | null {
  if (link.length > MAX_LINK_LENGTH) return null;
  if (/[%?\\\s]/.test(link)) return null;
  const hash = link.indexOf('#');
  const fragment = hash < 0 ? undefined : link.slice(hash + 1);
  if (fragment?.includes('#') === true) return null;
  const address = hash < 0 ? link : link.slice(0, hash);

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(address);
  let path = address;
  let secure = false;
  if (scheme !== null) {
    const name = scheme[1]?.toLowerCase();
    const rest = scheme[2] ?? '';
    if (name === 'bargu') {
      path = `/${rest}`;
    } else if (name === 'https' && host !== undefined) {
      // The authority is everything up to the first slash: it must be the host and nothing else.
      const slash = rest.indexOf('/');
      if (slash < 0 || asciiLowerCase(rest.slice(0, slash)) !== host) return null;
      path = rest.slice(slash);
      secure = true;
    } else {
      return null;
    }
  } else if (!lenient) {
    return null;
  }

  if (fragment !== undefined) {
    // The token in the fragment: only straight after /i or /g of the invite host.
    if (!secure || (path !== '/i' && path !== '/g')) return null;
    return inviteTokenSchema.safeParse(fragment).success
      ? { screen: path === '/i' ? 'i' : 'g', token: fragment }
      : null;
  }

  const trimmed = lenient && !secure && path.endsWith('/') ? path.slice(0, -1) : path;
  const [empty, screen, token, ...rest] = trimmed.split('/');
  if (empty !== '' || rest.length > 0 || screen === undefined || !SCREENS.has(screen)) return null;
  const parsed = inviteTokenSchema.safeParse(token);
  return parsed.success ? { screen: screen === 'g' ? 'g' : 'i', token: parsed.data } : null;
}

/**
 * What a link from outside the app opens (app/+native-intent.tsx): the screen of a Bargu link
 * (parseBarguLink, lenient), or the map for anything else.
 */
export function incomingPath(link: string, host: string | undefined = inviteHost): string {
  const parsed = parseBarguLink(link, host, true);
  return parsed === null ? HOME : `/${parsed.screen}/${parsed.token}`;
}
