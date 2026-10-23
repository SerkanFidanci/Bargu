/** How long a second open of the same tag counts as the same tap. */
const SAME_TAP_MS = 600;
let last: { key: string; at: number } | null = null;

/**
 * Whether a tap on a tag on the map opens its screen. On Android the map takes the tap itself and
 * hands it to the marker (its `onPress`): a button inside the tag never hears it, which is why a
 * meeting's flag did nothing (the owner, 2026-10-23). Where the button hears it too, one tap
 * still opens one screen.
 */
export function firstTap(key: string, now = Date.now()): boolean {
  if (last?.key === key && now - last.at < SAME_TAP_MS) return false;
  last = { key, at: now };
  return true;
}
