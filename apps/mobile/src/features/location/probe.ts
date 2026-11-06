import type { BackgroundLiveRefusal } from './background-live/policy';
import type { FixOutcome } from './fix-filter';

/** Where a raw position came from: the location service, or the 1-second watch (tracker.ts). */
export type FixSource = 'service' | 'live';

/** The only additive counters a feature may report. Never derive a name from user data. */
export const SCENARIO_COUNTERS = [
  'engine.published.read',
  'engine.published.write',
  'snapshot.locations',
  'snapshot.statuses',
  'snapshot.profiles',
  'snapshot.looks',
  'snapshot.states',
  'checkin.inbox.decrypt',
  'messages.inbox.records',
  'own.pending.keys',
  'own.pending.get',
  'own.explore.days',
] as const;
export type ScenarioCounter = (typeof SCENARIO_COUNTERS)[number];

/** High-water marks are a separate contract: only these names may be reported with `max`. */
export const SCENARIO_MAXIMUMS = ['snapshot.inflight'] as const;
export type ScenarioMaximum = (typeof SCENARIO_MAXIMUMS)[number];

export function isScenarioCounter(name: string): name is ScenarioCounter {
  return (SCENARIO_COUNTERS as readonly string[]).includes(name);
}

export function isScenarioMaximum(name: string): name is ScenarioMaximum {
  return (SCENARIO_MAXIMUMS as readonly string[]).includes(name);
}

/**
 * What the measurement overlay hears from the location pipeline (docs/ADR/0028): times,
 * accuracies, sources and counts, never a position. Only development and preview builds have a
 * listener (features/dev/measure, loaded by index.ts); a production bundle does not contain it,
 * so there `probe.current` stays null and every call below is skipped.
 */
export interface LocationProbe {
  /** A raw position arrived (measured at `ts`, here at `at`) and what became of it. */
  sampled(input: {
    source: FixSource;
    ts: number;
    acc: number;
    at: number;
    outcome: FixOutcome;
  }): void;
  /** This phone's location went out to its circles (`live`: someone is watching). */
  sent(input: { at: number; live: boolean }): void;
  /** A friend's location arrived; `ignored` when it was older than the one shown. */
  received(input: { userId: string; ts: number; acc: number; at: number; ignored: boolean }): void;
  /** A piece of work on the JavaScript thread ran for `ms` (see `timed`): its name and time only. */
  span(name: string, ms: number): void;
  /** Add to a fixed scenario counter; optional so older lightweight listeners remain valid. */
  count?(name: ScenarioCounter, delta?: number): void;
  /** Raise a fixed scenario high-water mark; never derive a name from user data. */
  max?(name: ScenarioMaximum, value: number): void;
  /**
   * Background live mode (docs/ADR/0028 step 3): a `watch` notice reached this phone; a live
   * window of `ms` was opened (or lengthened) for it; or it was refused, and why.
   */
  backgroundLive(
    input:
      | { kind: 'notice' }
      | { kind: 'opened'; ms: number }
      | { kind: 'refused'; reason: BackgroundLiveRefusal },
  ): void;
}

export const probe: { current: LocationProbe | null } = { current: null };

/**
 * For React's Profiler around a screen's drawing: reports how long that screen's latest drawing
 * took, under the name "render.<id>". React reports nothing in a production build, and where
 * `probe.current` is null this does nothing either.
 */
export function reportRender(id: string, _phase: string, actualDuration: number): void {
  probe.current?.span(`render.${id}`, actualDuration);
}

/**
 * Runs `work` and, in a build with the measurement overlay, tells it the name and how long it took
 * (the stall meter, features/dev/measure/stalls.ts, then says which known work held the thread).
 * Names are fixed words for kinds of work, never anything from a message or a position. Where
 * `listener` is null (a production bundle) this only calls `work`. An async operation should pass
 * its captured account listener rather than reading `probe.current` again after an await.
 */
export function timed<T>(
  name: string,
  work: () => T,
  listener: LocationProbe | null = probe.current,
): T {
  if (listener === null) return work();
  const started = performance.now();
  try {
    return work();
  } finally {
    if (probe.current === listener) listener.span(name, performance.now() - started);
  }
}

/** The async counterpart of `timed`: the span ends only if its listener is still current. */
export async function timedAsync<T>(
  name: string,
  work: () => Promise<T>,
  listener: LocationProbe | null = probe.current,
): Promise<T> {
  if (listener === null) return work();
  const started = performance.now();
  try {
    const result = await work();
    return result;
  } finally {
    if (probe.current === listener) listener.span(name, performance.now() - started);
  }
}
