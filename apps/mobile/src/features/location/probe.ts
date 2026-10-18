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
}

export const probe: { current: LocationProbe | null } = { current: null };
