import { STATE_WHY, type StateWhy } from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

/**
 * A location older than this is shown grey with its age. A still phone sends a heartbeat every
 * 5 minutes (send.ts), so two missed ones mean the phone is off, offline or out of reach.
 */
export const STALE_AFTER_MS = 10 * 60_000;

/** Why a phone's location is old, as the phone itself says it (docs/ADR/0028 "Neden eski?"). */
export type Why = Exclude<StateWhy, 'none'>;

export const receivedStateSchema = z
  .object({
    circleId: z.string(),
    userId: z.string(),
    why: z.enum(STATE_WHY),
    since: z.number(),
    ts: z.number(),
    receivedAt: z.number(),
  })
  .strict();

/** A member's latest `state` message as received in one circle. */
export type ReceivedState = z.infer<typeof receivedStateSchema>;

/** The latest `state` of each member per circle, keyed `${circleId}:${userId}` (screens read it). */
export const useStates = create<Record<string, ReceivedState>>(() => ({}));

/**
 * What this phone is telling its circles about its own location right now (state-report.ts), or
 * null when it tells them nothing: the user's own card shows it ("Arkadaşların seni şöyle
 * görüyor"). Memory only.
 */
export const useMyWhy = create<{ current: { why: Why; since: number } | null }>(() => ({
  current: null,
}));

/** What the screens say next to an old location. */
export interface WhyShown {
  kind: Why | 'offline';
  since: number;
}

/** A person's newest `state` over the circles they are in (every shared circle hears the same). */
export function newestState(
  states: Readonly<Record<string, ReceivedState>>,
  userId: string,
): ReceivedState | undefined {
  let newest: ReceivedState | undefined;
  for (const state of Object.values(states)) {
    if (state.userId === userId && (newest === undefined || state.ts > newest.ts)) newest = state;
  }
  return newest;
}

/**
 * What to say next to someone's location (docs/ADR/0028 "Neden eski?"), or nothing:
 * - a location under 10 minutes old is fresh: nothing to explain, and a reason that was sent for an
 *   earlier stretch goes with it;
 * - old, and their phone said why within the last 10 minutes (it repeats every 5 while it lasts):
 *   that reason, since when it began;
 * - old, and nothing heard from them for 10 minutes (two missed heartbeats): "offline" since the
 *   last message. Nobody sends that: a phone that cannot send says nothing, so it is inferred. A
 *   reason that was not renewed has lapsed the same way (a phone that died in battery saver is
 *   offline, not "in saver" for ever); a frozen ghost looks like this too, which is the point.
 * - old, but they said "none" a moment ago: they are back, a fresh location is on its way.
 */
export function whyShown(input: {
  loc: { ts: number };
  state: ReceivedState | undefined;
  now: number;
}): WhyShown | null {
  const { loc, state, now } = input;
  if (now - loc.ts < STALE_AFTER_MS) return null;
  if (state !== undefined && state.why !== 'none' && now - state.ts < STALE_AFTER_MS) {
    return { kind: state.why, since: state.since };
  }
  const heard = Math.max(loc.ts, state?.ts ?? 0);
  return now - heard >= STALE_AFTER_MS ? { kind: 'offline', since: heard } : null;
}

/** The ablative ending ("-den", "-dan", "-ten", "-tan") of a number as it is read aloud. */
function ablative(n: number): 'den' | 'dan' | 'ten' | 'tan' {
  // By the last word spoken: sıfır, bir, iki, üç, dört, beş, altı, yedi, sekiz, dokuz.
  const byOnes = ['dan', 'den', 'den', 'ten', 'ten', 'ten', 'dan', 'den', 'den', 'dan'] as const;
  // on, yirmi, otuz, kırk, elli.
  const byTens = ['dan', 'dan', 'den', 'dan', 'tan', 'den'] as const;
  const ones = byOnes[n % 10] ?? 'den';
  return n >= 10 && n % 10 === 0 ? (byTens[n / 10] ?? 'den') : ones;
}

/**
 * A time of day for "since": "14:20'den" in Turkish (the ending follows how the number is read
 * aloud: 14:30'dan, 14:40'tan, 15:03'ten), the phone's own way of writing a time elsewhere. In the
 * phone's time zone.
 */
export function sinceTime(ts: number, language: string): string {
  const date = new Date(ts);
  if (language !== 'tr') {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  }
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  // A full hour is read as the hour; otherwise the minutes are the last words said.
  return `${clock}'${ablative(minutes === 0 ? hours : minutes)}`;
}
