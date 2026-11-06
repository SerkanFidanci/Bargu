import {
  SCENARIO_COUNTERS,
  SCENARIO_MAXIMUMS,
  type ScenarioCounter,
  type ScenarioMaximum,
} from '../../location/probe';
import { memoryStore } from '../../location/test-support';
import {
  addScenarioCount,
  addScenarioMaximum,
  addScenarioSpan,
  emptyScenarioMetrics,
  recordScenarioCount,
  recordScenarioMaximum,
  recordScenarioSpan,
  resetScenarioMetrics,
  scenarioMetricsSnapshot,
  useScenarioMetrics,
} from './scenario';
import {
  backgroundLiveStore,
  emptyBackgroundLive,
  forgetBackgroundLive,
  loadBackgroundLive,
  recorder,
  useMeasures,
  useStalls,
} from './store';

beforeEach(() => {
  resetScenarioMetrics();
  backgroundLiveStore.current = null;
  forgetBackgroundLive();
  useStalls.setState({ list: [], spans: [], watching: false });
});

afterEach(() => {
  resetScenarioMetrics();
  backgroundLiveStore.current = null;
  forgetBackgroundLive();
  useStalls.setState({ list: [], spans: [], watching: false });
});

describe('the scenario metric allow-list', () => {
  it('keeps the feature contract exact and leaves PeopleLayer work to spans', () => {
    expect(SCENARIO_COUNTERS).toEqual([
      'engine.published.read',
      'engine.published.write',
      'snapshot.locations',
      'snapshot.statuses',
      'snapshot.profiles',
      'snapshot.looks',
      'snapshot.states',
      'checkin.inbox.decrypt',
      'messages.inbox.records',
      'own.pending.keys',
      'own.pending.get',
      'own.explore.days',
    ]);
    expect(SCENARIO_MAXIMUMS).toEqual(['snapshot.inflight']);
    expect(SCENARIO_COUNTERS).not.toContain('people.derive');
    expect(SCENARIO_COUNTERS).not.toContain('people.cluster');
    expect(SCENARIO_COUNTERS).not.toContain('people.uncertainty');
  });
});

describe('scenario metric reducers', () => {
  it('adds allow-listed counters and rejects dynamic names and invalid deltas', () => {
    const empty = emptyScenarioMetrics();
    const once = addScenarioCount(empty, 'engine.published.read');
    const twice = addScenarioCount(once, 'engine.published.read', 2);

    expect(empty.counters['engine.published.read']).toBe(0);
    expect(twice.counters['engine.published.read']).toBe(3);
    expect(() =>
      addScenarioCount(empty, 'user.secret-circle-message-token' as ScenarioCounter),
    ).toThrow('Unknown scenario counter');
    expect(() => addScenarioCount(empty, 'engine.published.read', Number.NaN)).toThrow(
      'Invalid scenario counter delta',
    );
    expect(() => addScenarioCount(empty, 'engine.published.read', -1)).toThrow(
      'Invalid scenario counter delta',
    );
  });

  it('keeps high-water values only for allow-listed maximums', () => {
    const empty = emptyScenarioMetrics();
    const three = addScenarioMaximum(empty, 'snapshot.inflight', 3);
    const stillThree = addScenarioMaximum(three, 'snapshot.inflight', 2);
    const five = addScenarioMaximum(stillThree, 'snapshot.inflight', 5);
    expect(three.maximums['snapshot.inflight']).toBe(3);
    expect(stillThree.maximums['snapshot.inflight']).toBe(3);
    expect(stillThree).toBe(three);
    expect(five.maximums['snapshot.inflight']).toBe(5);
    expect(() => addScenarioMaximum(empty, 'circle.secret' as ScenarioMaximum, 1)).toThrow(
      'Unknown scenario maximum',
    );
    expect(() => addScenarioMaximum(empty, 'snapshot.inflight', Number.POSITIVE_INFINITY)).toThrow(
      'Invalid scenario maximum value',
    );
  });

  it('aggregates every span by name with count, total and maximum', () => {
    const empty = emptyScenarioMetrics();
    const first = addScenarioSpan(empty, 'people.derive', 8);
    const second = addScenarioSpan(first, 'people.derive', 12);
    const third = addScenarioSpan(second, 'people.cluster', 4);

    expect(third.spans['people.derive']).toEqual({ count: 2, totalMs: 20, maxMs: 12 });
    expect(third.spans['people.cluster']).toEqual({ count: 1, totalMs: 4, maxMs: 4 });
    expect(empty.spans).toEqual({});
  });
});

describe('the recorder scenario summary', () => {
  it('records count and max through the location probe', () => {
    recorder.count('messages.inbox.records', 500);
    recorder.count('messages.inbox.records');
    recorder.max('snapshot.inflight', 5);
    recorder.max('snapshot.inflight', 2);

    const snapshot = scenarioMetricsSnapshot();
    expect(snapshot.counters['messages.inbox.records']).toBe(501);
    expect(snapshot.maximums['snapshot.inflight']).toBe(5);
  });

  it('aggregates spans whether the stall watch runs or not, without changing stall behavior', () => {
    recorder.span('people.uncertainty', 6);
    expect(useStalls.getState().spans).toEqual([]);

    useStalls.setState({ list: [], spans: [], watching: true });
    recorder.span('people.uncertainty', 10);

    expect(scenarioMetricsSnapshot().spans['people.uncertainty']).toEqual({
      count: 2,
      totalMs: 16,
      maxMs: 10,
    });
    expect(useStalls.getState().spans).toHaveLength(1);
  });

  it('resets only scenario metrics, preserving background counters, an active watch and the vault', () => {
    const kept = memoryStore();
    backgroundLiveStore.current = () => kept;
    recorder.backgroundLive({ kind: 'notice' });
    const stalls = {
      list: [{ at: 1, ms: 60, name: 'receive.slice' }],
      spans: [{ name: 'receive.slice', ms: 60, end: 61 }],
      watching: true,
    };
    useStalls.setState(stalls);
    recordScenarioCount('engine.published.write', 2);
    recordScenarioMaximum('snapshot.inflight', 5);
    recordScenarioSpan('engine.fix', 7);
    const background = useMeasures.getState().backgroundLive;
    const stored = kept.get('measure:bglive:v1');

    resetScenarioMetrics();

    expect(scenarioMetricsSnapshot()).toEqual(emptyScenarioMetrics());
    expect(useMeasures.getState().backgroundLive).toEqual(background);
    expect(useStalls.getState()).toEqual(stalls);
    expect(kept.get('measure:bglive:v1')).toBe(stored);

    recorder.backgroundLive({ kind: 'notice' });
    expect(useMeasures.getState().backgroundLive.notices).toBe(2);
    expect(loadBackgroundLive(kept).notices).toBe(2);
    expect(emptyBackgroundLive().notices).toBe(0);
  });

  it('snapshots fixed counter keys and numbers only, with no dynamic sensitive values', () => {
    for (const [index, name] of SCENARIO_COUNTERS.entries()) recordScenarioCount(name, index + 1);
    for (const name of SCENARIO_MAXIMUMS) recordScenarioMaximum(name, 5);
    recordScenarioSpan('engine.fix', 3);

    const snapshot = scenarioMetricsSnapshot();
    expect(Object.keys(snapshot.counters)).toEqual([...SCENARIO_COUNTERS]);
    expect(Object.keys(snapshot.maximums)).toEqual([...SCENARIO_MAXIMUMS]);
    expect(Object.keys(snapshot.spans)).toEqual(['engine.fix']);
    for (const value of Object.values(snapshot.counters)) expect(typeof value).toBe('number');
    for (const value of Object.values(snapshot.maximums)) expect(typeof value).toBe('number');
    for (const span of Object.values(snapshot.spans)) {
      expect(span).toEqual({ count: 1, totalMs: 3, maxMs: 3 });
    }

    expect(() => {
      recorder.count('secret-user-circle-message-token-41.0256-28.9742' as ScenarioCounter);
    }).toThrow('Unknown scenario counter');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('41.0256');
    expect(JSON.stringify(snapshot)).not.toContain('28.9742');

    snapshot.counters['engine.published.read'] = 999;
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(1);
    expect(useScenarioMetrics.getState().counters['engine.published.read']).toBe(1);
  });
});
