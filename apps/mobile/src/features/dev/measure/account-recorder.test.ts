import { probe, timedAsync } from '../../location/probe';
import { memoryStore } from '../../location/test-support';
import { startAccountRecorder, stopAccountRecorder } from './account-recorder';
import { resetScenarioMetrics, scenarioMetricsSnapshot } from './scenario';
import {
  backgroundLiveStore,
  forgetBackgroundLive,
  loadBackgroundLive,
  recorder,
  useMeasures,
  useStalls,
} from './store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  stopAccountRecorder();
  resetScenarioMetrics();
  backgroundLiveStore.current = null;
  forgetBackgroundLive();
  useStalls.setState({ list: [], spans: [], watching: false });
});

afterEach(() => {
  stopAccountRecorder();
  resetScenarioMetrics();
  backgroundLiveStore.current = null;
  forgetBackgroundLive();
  useStalls.setState({ list: [], spans: [], watching: false });
  probe.current = null;
});

describe('account-bound scenario recorders', () => {
  it('starts B empty after sign-out without touching background counters, stalls or vault', () => {
    const kept = memoryStore();
    backgroundLiveStore.current = () => kept;
    recorder.backgroundLive({ kind: 'notice' });
    const stalls = {
      list: [{ at: 1, ms: 60, name: 'receive.slice' }],
      spans: [{ name: 'receive.slice', ms: 60, end: 61 }],
      watching: true,
    };
    useStalls.setState(stalls);
    const a = startAccountRecorder('account-a');
    a.listener.count?.('engine.published.read', 2);
    a.listener.max?.('snapshot.inflight', 5);
    a.listener.span('engine.fix', 7);
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(2);
    const background = useMeasures.getState().backgroundLive;
    const stored = kept.get('measure:bglive:v1');
    const stallsBeforeStop = useStalls.getState();

    stopAccountRecorder();

    expect(probe.current).toBeNull();
    expect(scenarioMetricsSnapshot()).toEqual(resetSnapshot());
    expect(useMeasures.getState().backgroundLive).toEqual(background);
    expect(useStalls.getState()).toEqual(stallsBeforeStop);
    expect(kept.get('measure:bglive:v1')).toBe(stored);

    const b = startAccountRecorder('account-b');
    expect(b.generation).toBeGreaterThan(a.generation);
    expect(b.listener).not.toBe(a.listener);
    expect(scenarioMetricsSnapshot()).toEqual(resetSnapshot());

    b.listener.count?.('messages.inbox.records', 500);
    b.listener.max?.('snapshot.inflight', 1);
    b.listener.span('messages.inbox.total', 9);
    expect(scenarioMetricsSnapshot().counters['messages.inbox.records']).toBe(500);
    expect(scenarioMetricsSnapshot().maximums['snapshot.inflight']).toBe(1);
    expect(scenarioMetricsSnapshot().spans['messages.inbox.total']).toEqual({
      count: 1,
      totalMs: 9,
      maxMs: 9,
    });
    expect(loadBackgroundLive(kept).notices).toBe(1);
  });

  it('drops A deferred timedAsync, direct span, count and max after B starts, then records B', async () => {
    const a = startAccountRecorder('account-a');
    const spanWork = deferred<string>();
    const directWork = deferred<undefined>();
    const pendingSpan = timedAsync('location.snapshot.fetch', () => spanWork.promise);
    const listenerA = a.listener;
    const pendingDirect = (async () => {
      await directWork.promise;
      // Required feature contract: capture the account listener before the first await.
      listenerA.span('location.snapshot.apply', 4);
      listenerA.count?.('snapshot.locations');
      listenerA.max?.('snapshot.inflight', 5);
    })();

    stopAccountRecorder();
    const b = startAccountRecorder('account-b');
    spanWork.resolve('done');
    directWork.resolve(undefined);
    await Promise.all([pendingSpan, pendingDirect]);

    expect(scenarioMetricsSnapshot()).toEqual(resetSnapshot());

    b.listener.count?.('snapshot.statuses');
    b.listener.max?.('snapshot.inflight', 1);
    b.listener.span('location.snapshot.apply', 2);
    expect(scenarioMetricsSnapshot().counters['snapshot.statuses']).toBe(1);
    expect(scenarioMetricsSnapshot().maximums['snapshot.inflight']).toBe(1);
    expect(scenarioMetricsSnapshot().spans['location.snapshot.apply']).toEqual({
      count: 1,
      totalMs: 2,
      maxMs: 2,
    });
  });

  it('keeps the same generation on duplicate auth notifications for one account', () => {
    const a = startAccountRecorder('account-a');
    a.listener.count?.('engine.published.read');
    const again = startAccountRecorder('account-a');

    expect(again).toBe(a);
    expect(probe.current).toBe(a.listener);
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(1);
  });
});

function resetSnapshot() {
  return {
    counters: {
      'engine.published.read': 0,
      'engine.published.write': 0,
      'snapshot.locations': 0,
      'snapshot.statuses': 0,
      'snapshot.profiles': 0,
      'snapshot.looks': 0,
      'snapshot.states': 0,
      'checkin.inbox.decrypt': 0,
      'messages.inbox.records': 0,
      'own.pending.keys': 0,
      'own.pending.get': 0,
      'own.explore.days': 0,
    },
    maximums: { 'snapshot.inflight': 0 },
    spans: {},
  };
}
