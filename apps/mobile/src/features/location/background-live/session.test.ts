import { randomUuid } from '@bargu/crypto';

import { LIVE_MS, type SendCircle } from '../engine';
import { type FixSource, type LocationProbe, probe } from '../probe';
import type { Fix } from '../send';
import { DEFAULT_SHARING, withAdultDefaults } from '../sharing';
import { GALATA, memoryStore } from '../test-support';
import { loadStretches, saveStretches, type Stretch } from './budget';
import type { BackgroundLiveRefusal, BatteryInput } from './policy';
import { createBackgroundLive, FIRST_FIX_MS } from './session';

const START = 1_800_000_000_000;
const MINUTE = 60_000;
const id = randomUuid();
const open: SendCircle = { id, epoch: 1, myStatus: 'active', withOthers: true };
const adult = withAdultDefaults(DEFAULT_SHARING);

type Heard = Parameters<LocationProbe['backgroundLive']>[0];

/** A phone with its settings, its battery and an OS that gives (or refuses) positions. */
function setup() {
  let clock = START;
  const state = {
    settings: adult,
    circles: [open] as SendCircle[],
    battery: { saver: false, level: 80, charging: false } as BatteryInput,
    active: false,
    service: true,
    watchFails: false,
  };
  const store = memoryStore();
  const heard: Heard[] = [];
  probe.current = {
    sampled: () => undefined,
    sent: () => undefined,
    received: () => undefined,
    span: () => undefined,
    backgroundLive: (input) => heard.push(input),
  };
  const stop = jest.fn();
  let deliver: (fix: Fix) => void = () => undefined;
  const watch = jest.fn((onFix: (fix: Fix) => void) => {
    if (state.watchFails) return Promise.reject(new Error('refused'));
    deliver = onFix;
    return Promise.resolve(stop);
  });
  const engine = {
    watched: jest.fn(() => Promise.resolve()),
    fix: jest.fn<Promise<void>, [Fix, FixSource]>(() => Promise.resolve()),
  };
  const foregroundWatch = jest.fn();
  const foreground: (() => void)[] = [];
  const session = createBackgroundLive({
    settings: () => state.settings,
    circles: () => state.circles,
    store: () => store,
    battery: () => Promise.resolve(state.battery),
    appActive: () => state.active,
    foregroundWatch,
    serviceRunning: () => Promise.resolve(state.service),
    watch,
    engine,
    onForeground: (listener) => {
      foreground.push(listener);
      return () => {
        foreground.splice(foreground.indexOf(listener), 1);
      };
    },
    now: () => clock,
  });
  return {
    state,
    store,
    heard,
    stop,
    watch,
    engine,
    foregroundWatch,
    session,
    /** The OS delivers a position now. */
    position: (ts = clock): void => {
      deliver({ ...GALATA, ts });
    },
    /** Time passes: timers run and the clock moves. */
    pass: async (ms: number): Promise<void> => {
      clock += ms;
      await jest.advanceTimersByTimeAsync(ms);
    },
    /** The clock moves but no timer runs (a phone asleep). */
    skip: (ms: number): void => {
      clock += ms;
    },
    comeToTheFront: () => {
      for (const listener of [...foreground]) listener();
    },
    now: () => clock,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  probe.current = null;
});

const refused = (heard: Heard[]) =>
  heard.flatMap((item) => (item.kind === 'refused' ? [item.reason] : []));

describe('background live mode (docs/ADR/0028 step 3)', () => {
  it('goes live for a watched circle: one-second positions go to the engine', async () => {
    const t = setup();
    expect(await t.session.notice(id)).toBe('opened');
    expect(t.watch).toHaveBeenCalledTimes(1);
    expect(t.engine.watched).toHaveBeenCalledTimes(1);
    expect(t.session.active()).toBe(true);
    t.position();
    expect(t.engine.fix).toHaveBeenCalledWith(expect.objectContaining({ lat: GALATA.lat }), 'live');
    // Counted: the notice, and the time opened once positions flow.
    expect(t.heard).toEqual([{ kind: 'notice' }, { kind: 'opened', ms: LIVE_MS }]);
  });

  it('goes back to the normal rhythm after two minutes: the watcher stops, nothing more is sent', async () => {
    const t = setup();
    await t.session.notice(id);
    t.position();
    await t.pass(LIVE_MS - 1_000);
    expect(t.stop).not.toHaveBeenCalled();
    t.position();
    expect(t.engine.fix).toHaveBeenCalledTimes(2);
    await t.pass(1_000);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.session.active()).toBe(false);
    t.position();
    expect(t.engine.fix).toHaveBeenCalledTimes(2);
    // The same two minutes are what the allowance remembers.
    expect(loadStretches(t.store)).toEqual([[START, START + LIVE_MS]]);
  });

  it('closes the window by the time of the next position when the timer is late (sleeping phone)', async () => {
    const t = setup();
    await t.session.notice(id);
    t.position();
    // The clock moved on, the timer did not run.
    t.skip(LIVE_MS + 5_000);
    t.position();
    expect(t.engine.fix).toHaveBeenCalledTimes(1);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.session.active()).toBe(false);
  });

  describe('never goes live (and counts why)', () => {
    const cases: [string, BackgroundLiveRefusal, (t: ReturnType<typeof setup>) => void][] = [
      [
        'the setting is off',
        'setting',
        (t) => (t.state.settings = { ...adult, backgroundLive: 'off' }),
      ],
      [
        'a ghost freezes the location',
        'ghost',
        (t) => (t.state.settings = { ...adult, ghost: 'freeze' }),
      ],
      ['a ghost hides it', 'ghost', (t) => (t.state.settings = { ...adult, ghost: 'hide' })],
      [
        'the circle gets only a neighbourhood',
        'coarse',
        (t) =>
          (t.state.settings = {
            ...adult,
            circles: { [id]: { sharing: true, precision: 'neighborhood', until: null } },
          }),
      ],
      [
        'the timed share is over',
        'expired',
        (t) =>
          (t.state.settings = {
            ...adult,
            circles: { [id]: { sharing: true, precision: 'exact', until: START - 1 } },
          }),
      ],
      [
        'the circle is not shared with',
        'notShared',
        (t) =>
          (t.state.settings = {
            ...adult,
            circles: { [id]: { sharing: false, precision: 'exact', until: null } },
          }),
      ],
      ['the circle is paused', 'paused', (t) => (t.state.circles = [{ ...open, paused: true }])],
      [
        'battery saver is on',
        'batterySaver',
        (t) => (t.state.battery = { saver: true, level: 90, charging: false }),
      ],
      [
        'battery saver is on, even on the charger',
        'batterySaver',
        (t) => (t.state.battery = { saver: true, level: 8, charging: true }),
      ],
      [
        'the battery is under 20 % and the phone is not charging',
        'batteryLow',
        (t) => (t.state.battery = { saver: false, level: 19, charging: false }),
      ],
      [
        'the allowance is used up',
        'cap',
        (t) => {
          saveStretches(t.store, [[START - 20 * MINUTE, START - 5 * MINUTE]]);
        },
      ],
      ['the location service is not running', 'os', (t) => (t.state.service = false)],
      ['the OS refuses the watcher', 'os', (t) => (t.state.watchFails = true)],
    ];
    it.each(cases)('when %s', async (_name, reason, arrange) => {
      const t = setup();
      arrange(t);
      expect(await t.session.notice(id)).toBe(reason);
      expect(t.session.active()).toBe(false);
      expect(t.engine.watched).not.toHaveBeenCalled();
      expect(refused(t.heard)).toEqual([reason]);
      expect(t.heard[0]).toEqual({ kind: 'notice' });
    });
  });

  it('goes live on a low battery while it is charging (the PM, 2026-10-21)', async () => {
    const t = setup();
    t.state.battery = { saver: false, level: 6, charging: true };
    expect(await t.session.notice(id)).toBe('opened');
    expect(t.watch).toHaveBeenCalledTimes(1);
    expect(refused(t.heard)).toEqual([]);
    // Taken off the charger, the next notice is refused again.
    t.session.end();
    t.state.battery = { saver: false, level: 6, charging: false };
    expect(await t.session.notice(id)).toBe('batteryLow');
  });

  it('counts a notice for a circle this phone is not in', async () => {
    const t = setup();
    expect(await t.session.notice(randomUuid())).toBe('notShared');
    expect(t.watch).not.toHaveBeenCalled();
  });

  it('closes a window the OS gave no positions to, and stays at the normal rhythm', async () => {
    const t = setup();
    expect(await t.session.notice(id)).toBe('opened');
    await t.pass(FIRST_FIX_MS);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.session.active()).toBe(false);
    expect(refused(t.heard)).toEqual(['os']);
    // No time was counted as opened, and the unused time went back to the allowance.
    expect(t.heard.some((item) => item.kind === 'opened')).toBe(false);
    expect(loadStretches(t.store)).toEqual([[START, START + FIRST_FIX_MS]]);
  });

  it('keeps to 15 minutes in the hour: seven windows, then the eighth waits', async () => {
    const t = setup();
    for (let index = 0; index < 7; index += 1) {
      expect(await t.session.notice(id)).toBe('opened');
      t.position();
      await t.pass(LIVE_MS);
      expect(t.session.active()).toBe(false);
      await t.pass(2 * MINUTE);
    }
    // 14 minutes used in the last hour.
    expect(await t.session.notice(id)).toBe('cap');
    expect(t.watch).toHaveBeenCalledTimes(7);
    // The oldest window leaves the hour: room again.
    await t.pass(35 * MINUTE);
    expect(await t.session.notice(id)).toBe('opened');
  });

  it('lengthens a window when the watching goes on, within the same allowance', async () => {
    const t = setup();
    await t.session.notice(id);
    t.position();
    await t.pass(90_000);
    expect(await t.session.notice(id)).toBe('extended');
    expect(t.watch).toHaveBeenCalledTimes(1);
    expect(t.engine.watched).toHaveBeenCalledTimes(2);
    // Past the first two minutes the window is still open; it ends two minutes after the notice.
    await t.pass(60_000);
    expect(t.session.active()).toBe(true);
    await t.pass(60_000);
    expect(t.session.active()).toBe(false);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(loadStretches(t.store)).toEqual([[START, START + 90_000 + LIVE_MS]]);
    expect(t.heard.filter((item) => item.kind === 'opened')).toEqual([
      { kind: 'opened', ms: LIVE_MS },
      { kind: 'opened', ms: 90_000 },
    ]);
  });

  it('does not lengthen a window past the allowance; the window it has runs out', async () => {
    const t = setup();
    // 13 minutes already used earlier in the hour.
    const earlier: Stretch[] = [[START - 30 * MINUTE, START - 17 * MINUTE]];
    saveStretches(t.store, earlier);
    expect(await t.session.notice(id)).toBe('opened');
    t.position();
    await t.pass(90_000);
    expect(await t.session.notice(id)).toBe('cap');
    expect(t.session.active()).toBe(true);
    await t.pass(30_000);
    expect(t.session.active()).toBe(false);
  });

  it('hands a notice to the open app’s own live mode, with no window of its own', async () => {
    const t = setup();
    t.state.active = true;
    expect(await t.session.notice(id)).toBe('foreground');
    expect(t.foregroundWatch).toHaveBeenCalledWith(id);
    expect(t.watch).not.toHaveBeenCalled();
    expect(t.heard).toEqual([{ kind: 'notice' }]);
  });

  it('ends the window at once when a ghost is turned on, a share ends or the circle pauses', async () => {
    for (const change of [
      (t: ReturnType<typeof setup>) => (t.state.settings = { ...adult, ghost: 'hide' }),
      (t: ReturnType<typeof setup>) =>
        (t.state.settings = {
          ...adult,
          circles: { [id]: { sharing: true, precision: 'exact', until: START + 1_000 } },
        }),
      (t: ReturnType<typeof setup>) => (t.state.circles = [{ ...open, paused: true }]),
      (t: ReturnType<typeof setup>) => (t.state.settings = { ...adult, backgroundLive: 'off' }),
    ]) {
      const t = setup();
      await t.session.notice(id);
      t.position();
      expect(t.engine.fix).toHaveBeenCalledTimes(1);
      await t.pass(5_000);
      change(t);
      t.position();
      expect(t.engine.fix).toHaveBeenCalledTimes(1);
      expect(t.stop).toHaveBeenCalledTimes(1);
      expect(t.session.active()).toBe(false);
    }
  });

  it('ends the window when the app comes to the screen (its own live mode takes over)', async () => {
    const t = setup();
    await t.session.notice(id);
    t.position();
    t.comeToTheFront();
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.session.active()).toBe(false);
  });

  it('opens one window for two notices that arrive together', async () => {
    const t = setup();
    const both = await Promise.all([t.session.notice(id), t.session.notice(id)]);
    expect(both).toEqual(['opened', 'extended']);
    expect(t.watch).toHaveBeenCalledTimes(1);
  });

  it('ends on sign-out', async () => {
    const t = setup();
    await t.session.notice(id);
    t.session.end();
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.session.active()).toBe(false);
  });
});
