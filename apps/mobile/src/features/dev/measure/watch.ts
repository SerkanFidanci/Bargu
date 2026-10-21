import { addStall, watchStalls } from './stalls';
import { useStalls } from './store';

/**
 * Starts the stall meter for its ten seconds: with the app (measure/index.ts), and again whenever
 * the panel's button asks, to catch a lag later on (a friend moving, a sheet opening) and not
 * only the start. Starting it while it watches changes nothing; starting it again clears what it
 * found before.
 */
export function startStallWatch(): void {
  if (useStalls.getState().watching) return;
  useStalls.setState({ list: [], spans: [], watching: true });
  watchStalls({
    now: () => performance.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    },
    spans: () => useStalls.getState().spans,
    onStall: (stall) => {
      useStalls.setState((state) => ({ list: addStall(state.list, stall) }));
    },
    onEnd: () => {
      useStalls.setState({ watching: false });
    },
  });
}
