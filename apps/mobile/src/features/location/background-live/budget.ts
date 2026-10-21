import { z } from 'zod';

import type { KeyValueStore } from '../../storage/vault';

/**
 * This phone's own allowance for background live mode (docs/ADR/0028 step 3): at most
 * {@link BACKGROUND_LIVE_CAP_MS} of live time in any rolling hour, whatever the server sends. A
 * constant on purpose: the server's limits are configurable, this one is the phone's promise.
 */
export const BACKGROUND_LIVE_CAP_MS = 15 * 60_000;
export const BACKGROUND_LIVE_WINDOW_MS = 60 * 60_000;

/** A stretch of background live time: from, to (Unix ms). */
export type Stretch = readonly [from: number, to: number];

const KEY = 'bglive:budget:v1';
const stretchesSchema = z.array(z.tuple([z.number(), z.number()]));

/** The stretches kept on this phone (times only; the vault is encrypted and never synced). */
export function loadStretches(store: KeyValueStore): Stretch[] {
  const raw = store.get(KEY);
  if (raw === undefined) return [];
  try {
    const parsed = stretchesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveStretches(store: KeyValueStore, stretches: readonly Stretch[]): void {
  store.set(KEY, JSON.stringify(stretches));
}

/** Only what can still count against the window ending at `now` (or later). */
export function pruned(stretches: readonly Stretch[], now: number): Stretch[] {
  return stretches.filter(([, to]) => to > now - BACKGROUND_LIVE_WINDOW_MS);
}

/** Live time inside [from, to]. */
export function usedBetween(stretches: readonly Stretch[], from: number, to: number): number {
  return stretches.reduce(
    (total, [start, end]) => total + Math.max(0, Math.min(end, to) - Math.max(start, from)),
    0,
  );
}

/**
 * Whether live time from `from` to `to` fits: in the hour ending at `to`, what was used plus this
 * stays within the cap. Checked where the new stretch ends, so no hour ever holds more.
 */
export function fits(
  stretches: readonly Stretch[],
  from: number,
  to: number,
  cap = BACKGROUND_LIVE_CAP_MS,
): boolean {
  if (to <= from) return true;
  return usedBetween(stretches, to - BACKGROUND_LIVE_WINDOW_MS, to) + (to - from) <= cap;
}
