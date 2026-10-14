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
