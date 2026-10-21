import {
  addStall,
  BEAT_MS,
  nameOf,
  remember,
  type Span,
  STALL_MS,
  type Stall,
  watchStalls,
  WATCH_MS,
} from './stalls';

/** A clock and timers the test moves by hand: the heartbeat runs late when the clock jumps. */
function harness() {
  let time = 0;
  let pending: { run: () => void; at: number } | null = null;
  const stalls: Stall[] = [];
  let spans: Span[] = [];
  let ended = false;
  const stop = watchStalls({
    now: () => time,
    setTimer: (run, ms) => {
      pending = { run, at: time + ms };
      return pending;
    },
    clearTimer: () => {
      pending = null;
    },
    spans: () => spans,
    onStall: (stall) => stalls.push(stall),
    onEnd: () => {
      ended = true;
    },
  });
  return {
    stalls,
    stop,
    get ended() {
      return ended;
    },
    addSpan: (span: Span) => {
      spans = remember(spans, span);
    },
    /** The thread is busy for `busy` ms before the next beat gets to run. */
    beat(busy = 0) {
      const next = pending;
      if (next === null) return false;
      time = Math.max(time, next.at) + busy;
      next.run();
      return true;
    },
    now: () => time,
  };
}

describe('the stall meter', () => {
  it('says nothing while the thread keeps up', () => {
    const watch = harness();
    for (let index = 0; index < 100; index += 1) watch.beat();
    expect(watch.stalls).toEqual([]);
  });

  it('notes a beat that ran late by STALL_MS or more, with when and how long', () => {
    const watch = harness();
    watch.beat();
    watch.beat(STALL_MS - 1);
    expect(watch.stalls).toEqual([]);
    const before = watch.now();
    watch.beat(380);
    expect(watch.stalls).toEqual([{ at: before + BEAT_MS, ms: 380, name: null }]);
  });

  it('names a stall after the longest named work that ended inside it', () => {
    const watch = harness();
    watch.beat();
    const began = watch.now() + BEAT_MS;
    watch.addSpan({ name: 'keys.observe', ms: 12, end: began + 100 });
    watch.addSpan({ name: 'receive.slice', ms: 260, end: began + 300 });
    watch.beat(310);
    expect(watch.stalls).toHaveLength(1);
    expect(watch.stalls[0]?.name).toBe('receive.slice');
  });

  it('does not blame a short piece of work for a long stall, nor work from another time', () => {
    const at = 1_000;
    expect(nameOf({ at, ms: 400 }, [{ name: 'small', ms: 30, end: at + 200 }])).toBeNull();
    expect(nameOf({ at, ms: 400 }, [{ name: 'earlier', ms: 400, end: at - 50 }])).toBeNull();
    expect(nameOf({ at, ms: 400 }, [{ name: 'later', ms: 400, end: at + 900 }])).toBeNull();
  });

  it('ends by itself WATCH_MS after the start, and can be stopped sooner', () => {
    const watch = harness();
    while (!watch.ended && watch.now() < WATCH_MS * 2) watch.beat();
    expect(watch.ended).toBe(true);
    expect(watch.now()).toBeLessThan(WATCH_MS + 2 * BEAT_MS);
    expect(watch.beat()).toBe(false);

    const early = harness();
    early.beat();
    early.stop();
    expect(early.ended).toBe(true);
    expect(early.beat()).toBe(false);
  });

  it('keeps the newest forty stalls and spans', () => {
    let stalls: Stall[] = [];
    let spans: Span[] = [];
    for (let index = 0; index < 60; index += 1) {
      stalls = addStall(stalls, { at: index, ms: 60, name: null });
      spans = remember(spans, { name: 'x', ms: 1, end: index });
    }
    expect(stalls).toHaveLength(40);
    expect(stalls[0]?.at).toBe(20);
    expect(spans).toHaveLength(40);
  });
});
