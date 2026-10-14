import type { MessageEnvelope, PublishReply } from '@bargu/schemas';

import { createLocationEngine, LIVE_MS, type SendCircle, toSendCircle } from './engine';
import { SEND_RULES } from './send';
import { DEFAULT_SHARING, type SharingSettings } from './sharing';
import { circleOf, GALATA, moved, nth, type Person, somebody } from './test-support';

const START = 1_800_000_000_000;

function setup(circleCount = 2) {
  const me: Person = somebody();
  const friend = somebody();
  const circles: SendCircle[] = Array.from({ length: circleCount }, () =>
    toSendCircle(circleOf([me, friend]), me.userId),
  );
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
    await t.engine.fix(fixAt(SEND_RULES.movingIntervalMs, 30));
    expect(t.published).toHaveLength(2);
    t.at(SEND_RULES.movingIntervalMs + SEND_RULES.heartbeatMs);
    await t.engine.fix(fixAt(SEND_RULES.movingIntervalMs + SEND_RULES.heartbeatMs, 30));
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
