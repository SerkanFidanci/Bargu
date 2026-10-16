/**
 * How new the app is, against the server's minimum (QA 19 P4, docs/ADR/0024 §10). Raised when an
 * app change means older apps would misread what the server sends (APKs before 32b0f2d cannot
 * read a paused circle). The app sends it on every request and on the event socket; an app that
 * sends nothing is level 0. A server whose minimum is above it answers 426 UPGRADE_REQUIRED.
 */
export const CLIENT_LEVEL = 1;

/** Request header carrying CLIENT_LEVEL; older servers ignore it. */
export const CLIENT_LEVEL_HEADER = 'x-bargu-client';

/**
 * Query parameter carrying CLIENT_LEVEL on the event socket's handshake: its auth object is strict
 * on older servers, which would refuse a new field.
 */
export const CLIENT_LEVEL_QUERY = 'client';

/** The level a request says: a whole number from its header or query, 0 for none or nonsense. */
export function clientLevelOf(value: unknown): number {
  const text = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof text !== 'string' || !/^\d{1,4}$/.test(text)) return 0;
  return Number(text);
}
