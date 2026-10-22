import { LIVE_MS, type SendCircle } from '../engine';
import { type FixSource, probe } from '../probe';
import type { Fix } from '../send';
import type { SharingSettings } from '../sharing';
import type { KeyValueStore } from '../../storage/vault';
import {
  BACKGROUND_LIVE_CAP_MS,
  fits,
  loadStretches,
  pruned,
  saveStretches,
  type Stretch,
} from './budget';
import {
  type BackgroundLiveRefusal,
  batteryRefusal,
  type BatteryInput,
  sharingRefusal,
} from './policy';

/** With no position from the OS this long after a window opened, it is closed (and counted). */
export const FIRST_FIX_MS = 15_000;

/** What became of a `watch` notice. */
export type BackgroundLiveOutcome = 'opened' | 'extended' | 'foreground' | BackgroundLiveRefusal;

export interface BackgroundLiveDeps {
  settings: () => SharingSettings;
  circles: () => readonly SendCircle[];
  store: () => KeyValueStore;
  battery: () => Promise<BatteryInput>;
  /** The app is on the screen: the open app's own live mode (use-location.ts) takes the signal. */
  appActive: () => boolean;
  /** The app's own handling of a watched circle, for a notice that reaches an open app. */
  foregroundWatch: (circleId: string) => void;
  /**
   * Whether the location service (Android's foreground service) is running: only a process that
   * has one keeps its location access in the background (Android 14 "while-in-use" rules).
   */
  serviceRunning: () => Promise<boolean>;
  /** One-second positions (tracker.ts watchLive); rejects when the OS refuses them. */
  watch: (onFix: (fix: Fix) => void) => Promise<() => void>;
  engine: {
    /** Someone is looking: the engine sends by its live rule for a while (engine.ts LIVE_MS). */
    watched: () => Promise<void>;
    fix: (fix: Fix, source: FixSource) => Promise<void>;
  };
  /** Calls the listener when the app comes to the screen; returns how to stop listening. */
  onForeground: (listener: () => void) => () => void;
  now?: () => number;
  /** Length of one window (default: LIVE_MS, two minutes). */
  liveMs?: number;
  /** The phone's allowance per rolling hour (default: 15 minutes). */
  capMs?: number;
  firstFixMs?: number;
}

interface Window {
  circleId: string;
  endsAt: number;
  /** A position has come from the OS in this window. */
  sawFix: boolean;
  /** Live time not yet reported to the measurement layer (it counts once positions flow). */
  unreported: number;
  stop: () => void;
  endTimer: ReturnType<typeof setTimeout>;
  firstTimer: ReturnType<typeof setTimeout>;
  leaveForeground: () => void;
}

/**
 * Background live mode (docs/ADR/0028 step 3): a `watch` notice reached a phone whose app is
 * closed. If every stop allows it, the phone sends about once a second for {@link LIVE_MS}, then
 * goes back to its normal rhythm. The location service itself is not retuned: Android lets the
 * app start or change a location foreground service from the background only with the app on
 * the screen (expo-location refuses with ForegroundServiceStartNotAllowedException; the FCM
 * exemption does not extend to location access), so the one-second positions come from a watcher
 * on top of the running service instead. When the OS gives none, the window is closed and
 * counted as `os`; the phone stays at its normal rhythm.
 */
export function createBackgroundLive(deps: BackgroundLiveDeps) {
  const clock = deps.now ?? Date.now;
  const liveMs = deps.liveMs ?? LIVE_MS;
  const cap = deps.capMs ?? BACKGROUND_LIVE_CAP_MS;
  const firstFixMs = deps.firstFixMs ?? FIRST_FIX_MS;
  let open: Window | null = null;
  /** Notices are handled one at a time: two at once must not open two windows. */
  let queue: Promise<unknown> = Promise.resolve();

  const circleOf = (circleId: string) => deps.circles().find((circle) => circle.id === circleId);

  function refuse(reason: BackgroundLiveRefusal): BackgroundLiveOutcome {
    probe.current?.backgroundLive({ kind: 'refused', reason });
    return reason;
  }

  function opened(window: Window, ms: number): void {
    if (window.sawFix) probe.current?.backgroundLive({ kind: 'opened', ms });
    else window.unreported += ms;
  }

  /** Closes the window: positions stop, and the time not used goes back to the allowance. */
  function end(): void {
    const window = open;
    if (window === null) return;
    open = null;
    clearTimeout(window.endTimer);
    clearTimeout(window.firstTimer);
    window.leaveForeground();
    window.stop();
    const now = clock();
    const store = deps.store();
    saveStretches(
      store,
      loadStretches(store).map(([from, to]): Stretch =>
        to === window.endsAt ? [from, Math.min(to, Math.max(from, now))] : [from, to],
      ),
    );
  }

  function onFix(fix: Fix): void {
    const window = open;
    if (window === null) return;
    const now = clock();
    // The timer can be late on a sleeping phone: every position checks the time too.
    if (now >= window.endsAt) {
      end();
      return;
    }
    // A ghost turned on, a share that ended, a circle paused: the window ends at once.
    const stop = sharingRefusal({
      settings: deps.settings(),
      circle: circleOf(window.circleId),
      now,
    });
    if (stop !== null) {
      end();
      return;
    }
    if (!window.sawFix) {
      window.sawFix = true;
      clearTimeout(window.firstTimer);
      probe.current?.backgroundLive({ kind: 'opened', ms: window.unreported });
      window.unreported = 0;
    }
    void deps.engine.fix(fix, 'live').catch(() => undefined);
  }

  async function run(circleId: string): Promise<BackgroundLiveOutcome> {
    probe.current?.backgroundLive({ kind: 'notice' });
    if (deps.appActive()) {
      deps.foregroundWatch(circleId);
      return 'foreground';
    }
    const now = clock();
    const stop = sharingRefusal({ settings: deps.settings(), circle: circleOf(circleId), now });
    if (stop !== null) return refuse(stop);
    let power: BatteryInput;
    try {
      power = await deps.battery();
    } catch {
      // Not knowing the battery is not a reason to spend it.
      return refuse('os');
    }
    const low = batteryRefusal(power);
    if (low !== null) return refuse(low);

    // A window already open is lengthened (someone keeps looking), within the same allowance.
    const from = open?.endsAt ?? now;
    const to = now + liveMs;
    if (open !== null && to <= from) return 'extended';
    const store = deps.store();
    const kept = pruned(loadStretches(store), now);
    if (!fits(kept, from, to, cap)) return refuse('cap');
    if (!(await deps.serviceRunning().catch(() => false))) return refuse('os');

    const running = open;
    if (running !== null) {
      clearTimeout(running.endTimer);
      saveStretches(
        store,
        kept.map(([start, finish]): Stretch =>
          finish === running.endsAt ? [start, to] : [start, finish],
        ),
      );
      running.endsAt = to;
      running.endTimer = setTimeout(end, to - now);
      opened(running, to - from);
      await deps.engine.watched();
      return 'extended';
    }

    let stopWatching: () => void;
    try {
      stopWatching = await deps.watch(onFix);
    } catch {
      return refuse('os');
    }
    saveStretches(store, [...kept, [now, to]]);
    open = {
      circleId,
      endsAt: to,
      sawFix: false,
      unreported: to - now,
      stop: stopWatching,
      endTimer: setTimeout(end, to - now),
      firstTimer: setTimeout(() => {
        // No position came from the OS: the background gets none. Stay at the normal rhythm.
        if (open === null || open.sawFix) return;
        refuse('os');
        end();
      }, firstFixMs),
      leaveForeground: deps.onForeground(end),
    };
    await deps.engine.watched();
    return 'opened';
  }

  return {
    /** A `watch` notice for this circle arrived (already opened, signed by no one: server news). */
    notice(circleId: string): Promise<BackgroundLiveOutcome> {
      const result = queue.then(
        () => run(circleId),
        () => run(circleId),
      );
      queue = result;
      return result;
    },
    /** A window is open now. */
    active(): boolean {
      return open !== null;
    },
    /** Ends any open window (sign-out). */
    end,
  };
}
