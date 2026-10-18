import { applyPrecision } from '@bargu/crypto';
import type { MessageEnvelope, PublishReply } from '@bargu/schemas';

import { createLocationEngine, LIVE_MS, type SendCircle, toSendCircle, useMyFix } from './engine';
import { FIX_RULES } from './fix-filter';
import { type LocationProbe, probe } from './probe';
import { createReceiver, useLocations } from './receive';
import { locPayload, SEND_RULES } from './send';
import { DEFAULT_SHARING, type SharingSettings } from './sharing';
import { circleOf, exchangeKeys, GALATA, moved, nth, type Person, somebody } from './test-support';

const START = 1_800_000_000_000;

function setup(circleCount = 2) {
  const me: Person = somebody();
  const friend = somebody();
  const full = Array.from({ length: circleCount }, () => circleOf([me, friend]));
  const circles: SendCircle[] = full.map((circle) => toSendCircle(circle, me.userId));
  let settings: SharingSettings = DEFAULT_SHARING;
  let now = START;
  let offline = false;
  const published: MessageEnvelope[][] = [];
  const withdrawn: string[][] = [];
  const outdated: string[][] = [];
  let reply = (envelopes: MessageEnvelope[]): PublishReply => ({
    accepted: envelopes.length,
    refused: [],
  });
  const engine = createLocationEngine({
    keys: () => me.keys,
    device: () => me.device,
    circles: () => circles,
    sharing: () => settings,
    store: () => me.store,
    battery: () => Promise.resolve({ level: 80, charging: false }),
    publish: (envelopes) => {
      if (offline) return Promise.reject(new Error('offline'));
      published.push(envelopes);
      return Promise.resolve(reply(envelopes));
    },
    withdraw: (circleIds) => {
      if (offline) return Promise.reject(new Error('offline'));
      withdrawn.push(circleIds);
      return Promise.resolve();
    },
    outdated: (circleIds) => {
      outdated.push(circleIds);
    },
    now: () => now,
  });
  return {
    engine,
    me,
    friend,
    full,
    circles,
    published,
    withdrawn,
    outdated,
    at: (ms: number) => {
      now = START + ms;
      return now;
    },
    set: (next: SharingSettings) => {
      settings = next;
    },
    setOffline: (value: boolean) => {
      offline = value;
    },
    setReply: (next: typeof reply) => {
      reply = next;
    },
  };
}

const fixAt = (ms: number, metres = 0) => moved(GALATA, metres, START + ms);

describe('location engine', () => {
  it('sends one encrypted envelope per shared circle, then only by the frequency table', async () => {
    const t = setup();
    await t.engine.fix(fixAt(0));
    expect(t.published).toHaveLength(1);
    expect(t.published[0]?.map((envelope) => envelope.circleId).sort()).toEqual(
      t.circles.map((circle) => circle.id).sort(),
    );
    t.at(SEND_RULES.movingIntervalMs);
    await t.engine.fix(fixAt(SEND_RULES.movingIntervalMs, 3));
    expect(t.published).toHaveLength(1);
    // A position is used once: the next one is measured a second later (fix-filter.ts).
    t.at(SEND_RULES.movingIntervalMs + 1_000);
    await t.engine.fix(fixAt(SEND_RULES.movingIntervalMs + 1_000, 30));
    expect(t.published).toHaveLength(2);
    t.at(SEND_RULES.movingIntervalMs + 1_000 + SEND_RULES.heartbeatMs);
    await t.engine.fix(fixAt(SEND_RULES.movingIntervalMs + 1_000 + SEND_RULES.heartbeatMs, 30));
    expect(t.published).toHaveLength(3);
  });

  it('keeps only the newest fix while offline and sends it when back', async () => {
    const t = setup(1);
    t.setOffline(true);
    await t.engine.fix(fixAt(0));
    t.at(SEND_RULES.movingIntervalMs);
    await t.engine.fix(fixAt(SEND_RULES.movingIntervalMs, 50));
    expect(t.published).toHaveLength(0);
    t.setOffline(false);
    await t.engine.flush();
    expect(t.published).toHaveLength(1);
    await t.engine.flush();
    expect(t.published).toHaveLength(1);
  });

  it('takes the location back from a circle that stops getting it', async () => {
    const t = setup();
    await t.engine.fix(fixAt(0));
    const [kept, dropped] = [nth(t.circles, 0), nth(t.circles, 1)];
    t.set({
      ghost: 'off',
      circles: { [dropped.id]: { sharing: false, precision: 'exact', until: null } },
    });
    // No new fix is due, yet the withdrawal goes out at once.
    t.at(1_000);
    await t.engine.fix(fixAt(1_000));
    expect(t.withdrawn).toEqual([[dropped.id]]);
    t.at(SEND_RULES.heartbeatMs);
    await t.engine.fix(fixAt(SEND_RULES.heartbeatMs));
    expect(t.published.at(-1)?.map((envelope) => envelope.circleId)).toEqual([kept.id]);
  });

  it('ends a timed share on time', async () => {
    const t = setup(1);
    const circle = nth(t.circles);
    t.set({
      ghost: 'off',
      circles: { [circle.id]: { sharing: true, precision: 'exact', until: START + 60_000 } },
    });
    await t.engine.fix(fixAt(0));
    expect(t.engine.active()).toBe(true);
    t.at(60_000);
    await t.engine.fix(fixAt(60_000));
    expect(t.withdrawn).toEqual([[circle.id]]);
    expect(t.engine.active()).toBe(false);
  });

  it('as a frozen ghost sends nothing and leaves the last location in place', async () => {
    const t = setup();
    await t.engine.fix(fixAt(0));
    t.set({ ...DEFAULT_SHARING, ghost: 'freeze' });
    await t.engine.changed();
    t.at(SEND_RULES.heartbeatMs);
    await t.engine.fix(fixAt(SEND_RULES.heartbeatMs, 100));
    expect(t.published).toHaveLength(1);
    expect(t.withdrawn).toEqual([]);
    expect(t.engine.active()).toBe(false);
  });

  it('as a hidden ghost takes the location back everywhere', async () => {
    const t = setup();
    await t.engine.fix(fixAt(0));
    t.set({ ...DEFAULT_SHARING, ghost: 'hide' });
    await t.engine.changed();
    expect(t.withdrawn.flat().sort()).toEqual(t.circles.map((circle) => circle.id).sort());
  });

  it('resends at once when settings change (a coarser precision replaces the finer one)', async () => {
    const t = setup(1);
    await t.engine.fix(fixAt(0));
    const circle = nth(t.circles);
    t.set({
      ghost: 'off',
      circles: { [circle.id]: { sharing: true, precision: 'city', until: null } },
    });
    t.at(1_000);
    await t.engine.changed();
    expect(t.published).toHaveLength(2);
  });

  it('sends every second for a while once someone watches', async () => {
    const t = setup(1);
    await t.engine.fix(fixAt(0));
    t.at(SEND_RULES.liveIntervalMs);
    await t.engine.fix(fixAt(SEND_RULES.liveIntervalMs));
    expect(t.published).toHaveLength(1);
    await t.engine.watched();
    expect(t.published).toHaveLength(2);
    t.at(2 * SEND_RULES.liveIntervalMs);
    await t.engine.fix(fixAt(2 * SEND_RULES.liveIntervalMs));
    expect(t.published).toHaveLength(3);
    t.at(SEND_RULES.liveIntervalMs + LIVE_MS + 1);
    expect(t.engine.live()).toBe(false);
  });

  it('splits many circles into publishes the relay accepts', async () => {
    const t = setup(12);
    await t.engine.fix(fixAt(0));
    expect(t.published.map((batch) => batch.length)).toEqual([10, 2]);
  });

  it('refreshes circles refused for an old epoch, not those merely rate limited', async () => {
    const t = setup(2);
    const [old, busy] = [nth(t.circles, 0), nth(t.circles, 1)];
    t.setReply((envelopes) => ({
      accepted: 0,
      refused: [
        { circleId: old.id, code: 'EPOCH' as const },
        { circleId: busy.id, code: 'RATE_LIMITED' as const },
      ].filter((refusal) => envelopes.some((envelope) => envelope.circleId === refusal.circleId)),
    }));
    await t.engine.fix(fixAt(0));
    expect(t.outdated).toEqual([[old.id]]);
  });

  it('sends nothing to a circle with nobody else in it (a request not accepted yet)', async () => {
    const t = setup(2);
    const lone = nth(t.circles, 1);
    t.circles[1] = { ...lone, withOthers: false };
    await t.engine.fix(fixAt(0));
    expect(t.published.flat().map((envelope) => envelope.circleId)).toEqual([nth(t.circles).id]);
    expect(t.engine.gps()).toBe(true);
    t.set({
      ghost: 'off',
      circles: { [nth(t.circles).id]: { sharing: true, precision: 'city', until: null } },
    });
    expect(t.engine.gps()).toBe(false);
  });
});

describe('the positions the engine uses (docs/ADR/0028)', () => {
  const BATTERY = { level: 80, charging: false };

  afterEach(() => {
    probe.current = null;
  });

  it('never steps back to a position older than the one used (two location sources)', async () => {
    const t = setup(1);
    t.at(2_000);
    await t.engine.fix(fixAt(2_000, 20), 'live');
    // The location service's position from a second earlier arrives after the watch's.
    await t.engine.fix(fixAt(1_000, 10), 'service');
    expect(useMyFix.getState().fix?.ts).toBe(START + 2_000);
    expect(t.published).toHaveLength(1);
  });

  it('indoors with GPS, holds the guesses back, then sends the best one with its accuracy', async () => {
    const t = setup(1);
    await t.engine.fix(fixAt(0));
    const guess = (ms: number, acc: number) => ({ ...fixAt(ms, 40), acc });
    for (const [ms, acc] of [
      [10_000, 400],
      [20_000, 150],
      [30_000, 300],
    ] as const) {
      t.at(ms);
      await t.engine.fix(guess(ms, acc));
    }
    expect(t.published).toHaveLength(1);
    expect(useMyFix.getState().fix?.acc).toBe(8);
    t.at(FIX_RULES.fallbackMs);
    await t.engine.fix(guess(FIX_RULES.fallbackMs, 250));
    expect(t.published).toHaveLength(2);
    expect(useMyFix.getState().fix?.acc).toBe(150);
  });

  it('gives a coarse circle the cell of the very same raw position', async () => {
    const t = setup(2);
    const [exact, coarse] = [nth(t.full, 0), nth(t.full, 1)];
    for (const circle of t.full) exchangeKeys(circle, [t.me, t.friend]);
    t.set({
      ghost: 'off',
      circles: { [coarse.id]: { sharing: true, precision: 'neighborhood', until: null } },
    });
    useLocations.setState({}, true);
    const receiver = createReceiver({
      keys: () => t.friend.keys,
      circles: () => t.full,
      store: () => t.friend.store,
      now: () => START,
    });
    const raw = { ...fixAt(0, 123), acc: 30 };
    await t.engine.fix(raw);
    for (const envelope of t.published.flat()) receiver.receive(envelope);
    const shown = useLocations.getState();
    expect(shown[`${exact.id}:${t.me.userId}`]?.loc).toMatchObject({ lat: raw.lat, lng: raw.lng });
    // Exactly what the coarse circle got before the filter: the raw position's cell.
    expect(shown[`${coarse.id}:${t.me.userId}`]?.loc).toEqual(
      applyPrecision(locPayload(raw, BATTERY), 'neighborhood'),
    );
  });

  it('without GPS (coarse circles only), uses a Wi-Fi guess like any position', async () => {
    const t = setup(1);
    t.set({
      ghost: 'off',
      circles: { [nth(t.circles).id]: { sharing: true, precision: 'city', until: null } },
    });
    await t.engine.fix({ ...fixAt(0), acc: 900 });
    expect(t.published).toHaveLength(1);
  });

  it('tells the measurement overlay times, accuracies and counts, never a position', async () => {
    const heard: unknown[] = [];
    const listener: LocationProbe = {
      sampled: (input) => heard.push(input),
      sent: (input) => heard.push(input),
      received: (input) => heard.push(input),
    };
    probe.current = listener;
    const t = setup(1);
    const first = fixAt(0, 77);
    await t.engine.fix(first, 'live');
    await t.engine.fix(fixAt(0, 78), 'service');
    expect(heard).toEqual([
      { source: 'live', ts: START, acc: 8, at: START, outcome: 'taken' },
      { at: START, live: false },
      { source: 'service', ts: START, acc: 8, at: START, outcome: 'old' },
    ]);
    expect(JSON.stringify(heard)).not.toContain(String(first.lat).slice(0, 6));
  });
});
