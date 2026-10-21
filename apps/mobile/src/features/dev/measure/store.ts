import { create } from 'zustand';

import {
  BACKGROUND_LIVE_REFUSALS,
  type BackgroundLiveRefusal,
} from '../../location/background-live/policy';
import type { FixOutcome } from '../../location/fix-filter';
import type { FixSource, LocationProbe } from '../../location/probe';
import { remember, type Span, type Stall } from './stalls';

/** Intervals kept for each median: about the last ten locations. */
const KEEP = 10;

export interface Series {
  /** The latest value's time (ms), to measure the next interval from. */
  lastAt: number | null;
  /** The latest intervals (ms), newest last. */
  gaps: readonly number[];
}

export interface FriendMeasures {
  /** Between two of their locations, by when they were measured. */
  measured: Series;
  /** How old their latest location was when it got here (includes the two clocks' difference). */
  delayMs: number;
  acc: number;
  /** Older than the one shown, so not shown. */
  late: number;
}

/** Background live mode, counted since the app started (docs/ADR/0028 step 3). */
export interface BackgroundLiveCounts {
  /** `watch` notices that reached this phone. */
  notices: number;
  /** Windows opened or lengthened, and the live time (ms) they gave once positions flowed. */
  opened: number;
  openedMs: number;
  /** Notices that did not open one, by reason. */
  refused: Record<BackgroundLiveRefusal, number>;
}

/**
 * What the measurement overlay shows (docs/ADR/0028): in memory only, gone when the app closes,
 * never sent or logged. Times, accuracies and counts; no position is ever given to it.
 */
export interface Measures {
  /** Between two raw positions of each source, by when they were measured. */
  sources: Record<FixSource, Series>;
  /** How old the latest raw position was when it got here. */
  ageMs: number | null;
  /** The latest used position's accuracy. */
  acc: number | null;
  outcomes: Record<FixOutcome, number>;
  sends: Series;
  /** The latest send was in live mode (someone is watching). */
  live: boolean;
  friends: Readonly<Record<string, FriendMeasures>>;
  backgroundLive: BackgroundLiveCounts;
}

const series = (): Series => ({ lastAt: null, gaps: [] });

export function emptyBackgroundLive(): BackgroundLiveCounts {
  return {
    notices: 0,
    opened: 0,
    openedMs: 0,
    refused: Object.fromEntries(BACKGROUND_LIVE_REFUSALS.map((reason) => [reason, 0])) as Record<
      BackgroundLiveRefusal,
      number
    >,
  };
}

export function emptyMeasures(): Measures {
  return {
    sources: { service: series(), live: series() },
    ageMs: null,
    acc: null,
    outcomes: { taken: 0, fallback: 0, old: 0, stale: 0, inaccurate: 0, jump: 0 },
    sends: series(),
    live: false,
    friends: {},
    backgroundLive: emptyBackgroundLive(),
  };
}

/** The series with a new value at `at` (an earlier one is not an interval and is left out). */
export function extend(current: Series, at: number): Series {
  if (current.lastAt === null) return { lastAt: at, gaps: [] };
  if (at <= current.lastAt) return current;
  return { lastAt: at, gaps: [...current.gaps, at - current.lastAt].slice(-KEEP) };
}

/** The middle interval (ms), or null with none yet. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function sampled(
  measures: Measures,
  input: Parameters<LocationProbe['sampled']>[0],
): Measures {
  const used = input.outcome === 'taken' || input.outcome === 'fallback';
  return {
    ...measures,
    sources: {
      ...measures.sources,
      [input.source]: extend(measures.sources[input.source], input.ts),
    },
    ageMs: input.at - input.ts,
    acc: used ? input.acc : measures.acc,
    outcomes: { ...measures.outcomes, [input.outcome]: measures.outcomes[input.outcome] + 1 },
  };
}

export function sent(measures: Measures, input: Parameters<LocationProbe['sent']>[0]): Measures {
  return { ...measures, sends: extend(measures.sends, input.at), live: input.live };
}

export function received(
  measures: Measures,
  input: Parameters<LocationProbe['received']>[0],
): Measures {
  const before = measures.friends[input.userId];
  const friend: FriendMeasures = input.ignored
    ? {
        ...(before ?? { measured: series(), delayMs: 0, acc: input.acc }),
        late: (before?.late ?? 0) + 1,
      }
    : {
        measured: extend(before?.measured ?? series(), input.ts),
        delayMs: input.at - input.ts,
        acc: input.acc,
        late: before?.late ?? 0,
      };
  return { ...measures, friends: { ...measures.friends, [input.userId]: friend } };
}

export function backgroundLived(
  measures: Measures,
  input: Parameters<LocationProbe['backgroundLive']>[0],
): Measures {
  const counts = measures.backgroundLive;
  if (input.kind === 'notice') {
    return { ...measures, backgroundLive: { ...counts, notices: counts.notices + 1 } };
  }
  if (input.kind === 'opened') {
    return {
      ...measures,
      backgroundLive: {
        ...counts,
        opened: counts.opened + 1,
        openedMs: counts.openedMs + input.ms,
      },
    };
  }
  return {
    ...measures,
    backgroundLive: {
      ...counts,
      refused: { ...counts.refused, [input.reason]: counts.refused[input.reason] + 1 },
    },
  };
}

export const useMeasures = create<Measures & { open: boolean }>(() => ({
  ...emptyMeasures(),
  open: false,
}));

/**
 * The stall meter's findings (stalls.ts): the thread held for 50 ms or more in the first ten
 * seconds, and the named work reported meanwhile. Memory only, like the rest.
 */
export const useStalls = create<{
  list: readonly Stall[];
  spans: readonly Span[];
  /** The watch is still running. */
  watching: boolean;
}>(() => ({ list: [], spans: [], watching: false }));

/** The location pipeline's listener (probe.ts) while this build has the overlay. */
export const recorder: LocationProbe = {
  span: (name, ms) => {
    // Kept for naming stalls; only while the meter watches (after that nothing is stored).
    if (!useStalls.getState().watching) return;
    useStalls.setState((state) => ({
      spans: remember(state.spans, { name, ms, end: performance.now() }),
    }));
  },
  sampled: (input) => {
    useMeasures.setState((state) => sampled(state, input));
  },
  sent: (input) => {
    useMeasures.setState((state) => sent(state, input));
  },
  received: (input) => {
    useMeasures.setState((state) => received(state, input));
  },
  backgroundLive: (input) => {
    useMeasures.setState((state) => backgroundLived(state, input));
  },
};
