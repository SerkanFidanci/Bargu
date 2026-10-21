import { useEffect } from 'react';
import { create } from 'zustand';

/** How often time-based views (ages on the map, timed sharing) catch up with the clock. */
export const CLOCK_TICK_MS = 30_000;

const clock = create<{ now: number }>(() => ({ now: Date.now() }));
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * The current time for rendering, renewed every half minute while some screen uses it: a local
 * clock (nothing is fetched), shared so all of them tick together.
 */
export function useNow(): number {
  useEffect(() => {
    users += 1;
    clock.setState({ now: Date.now() });
    timer ??= setInterval(() => {
      clock.setState({ now: Date.now() });
    }, CLOCK_TICK_MS);
    return () => {
      users -= 1;
      if (users === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return clock((state) => state.now);
}

/**
 * Brings every screen's clock to now at once, off the half-minute beat: a moment that matters just
 * passed (a timed share ended, QA 24 B-2), so what they show changes right then.
 */
export function catchUp(): void {
  clock.setState({ now: Date.now() });
}

/** The longest delay a JavaScript timer takes (about 24.8 days); a longer one fires at once. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Calls `fn` at `at` (Unix ms), however far ahead: a moment beyond the timer's limit is reached in
 * steps of at most MAX_TIMER_MS (QA 25: a share timed past 24.8 days fired at once, again and
 * again). Returns the cancel.
 */
export function timerAt(at: number, fn: () => void, now: () => number = Date.now): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    const left = at - now();
    if (left > MAX_TIMER_MS) {
      timer = setTimeout(arm, MAX_TIMER_MS);
      return;
    }
    timer = setTimeout(fn, Math.max(0, left));
  };
  arm();
  return () => {
    if (timer !== null) clearTimeout(timer);
  };
}
