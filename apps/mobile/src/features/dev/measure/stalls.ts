/**
 * The stall meter (preview builds only, docs/ADR/0028): how long the JavaScript thread was held,
 * in the first seconds after the app starts. A heartbeat asks to run every few milliseconds; when
 * it runs much later than asked, something else held the thread for that long. It knows nothing
 * of what that was, so work worth naming reports its own time (probe.ts `timed`) and a stall is
 * given the name of the longest piece of work that ended inside it. Only names (fixed words for
 * kinds of work) and milliseconds are kept: no position, no message, nothing of a person.
 */

/** A stall is the thread held at least this long (ms): about three frames at 60 fps. */
export const STALL_MS = 50;
/** How long after the start the meter watches (ms). */
export const WATCH_MS = 10_000;
/** How often the heartbeat asks to run (ms): about a frame. */
export const BEAT_MS = 16;
/** Spans and stalls kept, the newest. */
const KEEP = 40;

export interface Stall {
  /** When it began, in ms since the app's JavaScript started. */
  at: number;
  /** How long the thread was held (ms). */
  ms: number;
  /** The longest named work that ended inside it, if any. */
  name: string | null;
}

export interface Span {
  name: string;
  ms: number;
  /** When it ended (ms, as `at`). */
  end: number;
}

/** What held the thread: the longest named span that ended while the stall lasted. */
export function nameOf(stall: Pick<Stall, 'at' | 'ms'>, spans: readonly Span[]): string | null {
  const inside = spans.filter(
    (span) => span.end >= stall.at && span.end <= stall.at + stall.ms + BEAT_MS,
  );
  const longest = inside.reduce<Span | null>(
    (best, span) => (best === null || span.ms > best.ms ? span : best),
    null,
  );
  // A short piece of work inside a long stall did not cause it.
  return longest !== null && longest.ms >= stall.ms / 2 ? longest.name : null;
}

/** The spans recorded so far, the newest few (for naming stalls). */
export function remember(spans: readonly Span[], span: Span): Span[] {
  return [...spans, span].slice(-KEEP);
}

export interface StallDeps {
  /** Milliseconds since the app's JavaScript started (performance.now). */
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  /** Named work reported so far. */
  spans: () => readonly Span[];
  onStall: (stall: Stall) => void;
  /** The watch ended (its time was up, or it was stopped). */
  onEnd?: () => void;
}

/**
 * Starts the heartbeat; returns how to stop it. Each beat is asked for `BEAT_MS` after the last
 * one ran, so a stall is the beat's lateness. It ends by itself `WATCH_MS` after the start.
 */
export function watchStalls(deps: StallDeps): () => void {
  const { now, setTimer, clearTimer, spans, onStall, onEnd } = deps;
  const began = now();
  let expected = began + BEAT_MS;
  let timer: unknown = null;
  let over = false;

  const finish = () => {
    if (over) return;
    over = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    onEnd?.();
  };

  const beat = () => {
    const at = now();
    const late = at - expected;
    if (late >= STALL_MS) {
      const stall = { at: expected, ms: Math.round(late) };
      onStall({ ...stall, name: nameOf(stall, spans()) });
    }
    if (at - began >= WATCH_MS) {
      finish();
      return;
    }
    expected = at + BEAT_MS;
    timer = setTimer(beat, BEAT_MS);
  };

  timer = setTimer(beat, BEAT_MS);
  return finish;
}

/** The stalls kept, the newest `KEEP`. */
export function addStall(stalls: readonly Stall[], stall: Stall): Stall[] {
  return [...stalls, stall].slice(-KEEP);
}
