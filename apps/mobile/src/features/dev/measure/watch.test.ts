import { timed } from '../../location/probe';
import { recorder, useStalls } from './store';
import { WATCH_MS } from './stalls';
import { startStallWatch } from './watch';

jest.useFakeTimers();

/** The clock the meter reads, moved by hand: a jump with no timer run is the thread held. */
let clock = 0;
beforeEach(() => {
  clock = 1_000;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  useStalls.setState({ list: [], spans: [], watching: false });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.restoreAllMocks();
});

/** Lets the next beat run, `held` ms after it was due (the thread was busy until then). */
function beat(held = 0): void {
  clock += 16 + held;
  jest.advanceTimersToNextTimer();
}

describe('the stall meter, started from the panel', () => {
  it('watches for ten seconds, notes a held thread with the work that held it, then stops', () => {
    startStallWatch();
    expect(useStalls.getState().watching).toBe(true);
    beat();
    // 280 ms inside one named piece of work, and the beat comes that much late.
    clock += 280;
    recorder.span('receive.slice', 280);
    beat(280);
    const [stall] = useStalls.getState().list;
    expect(stall?.ms).toBeGreaterThanOrEqual(250);
    expect(stall?.name).toBe('receive.slice');
    while (useStalls.getState().watching && clock < 1_000 + WATCH_MS * 2) beat();
    expect(useStalls.getState().watching).toBe(false);
    // Over: further work is not kept.
    recorder.span('late', 5);
    expect(useStalls.getState().spans.some((span) => span.name === 'late')).toBe(false);
  });

  it('changes nothing when asked while it watches, and starts afresh when asked after', () => {
    startStallWatch();
    beat(120);
    expect(useStalls.getState().list).toHaveLength(1);
    startStallWatch();
    expect(useStalls.getState().list).toHaveLength(1);
    while (useStalls.getState().watching && clock < 1_000 + WATCH_MS * 2) beat();
    startStallWatch();
    expect(useStalls.getState().watching).toBe(true);
    expect(useStalls.getState().list).toEqual([]);
  });

  it('is not there in a build without the overlay: timed only runs the work', () => {
    // probe.current is null until the overlay's module is loaded; timed must not need it.
    expect(timed('anything', () => 7)).toBe(7);
  });
});
