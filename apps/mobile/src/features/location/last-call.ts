import type { KeyValueStore } from '../storage/vault';
import type { Battery } from './send';

/**
 * N1, the last location before the battery dies (docs/ADR/0039 §9): at 5% or less, not charging,
 * the newest position goes once to every circle that gets it; it carries its battery level inside
 * the sealed message (no new field), so friends' phones can say "Pili bitmek üzereydi". Once more
 * only after it charged above 15%. Remembered in the vault, so the service's restarts do not send
 * it again.
 */
export const LAST_CALL = { atMost: 5, rearmAbove: 15 } as const;
const KEY = 'n1:lastCall:v1';

export function lastCallDue(store: KeyValueStore, battery: Battery): boolean {
  const told = store.get(KEY) === '1';
  // Only a charge above 15% makes it go again; plugged in for a moment does not.
  if (battery.level > LAST_CALL.rearmAbove) {
    if (told) store.delete(KEY);
    return false;
  }
  if (told || battery.charging || battery.level > LAST_CALL.atMost) return false;
  store.set(KEY, '1');
  return true;
}
