import type { BackgroundLiveRefusal } from './background-live/policy';
import type { FixOutcome } from './fix-filter';

/** Where a raw position came from: the location service, or the 1-second watch (tracker.ts). */
export type FixSource = 'service' | 'live';

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
 * `probe.current` is null (a production bundle) this only calls `work`.
 */
export function timed<T>(name: string, work: () => T): T {
  const listener = probe.current;
  if (listener === null) return work();
  const started = performance.now();
  try {
    return work();
  } finally {
    listener.span(name, performance.now() - started);
  }
}
