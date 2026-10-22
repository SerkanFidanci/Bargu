import {
  type Circle,
  HISTORY_KEEP_MS,
  HISTORY_SLOT_MS,
  type HistoryRecord,
  type MessageEnvelope,
} from '@bargu/schemas';

import { DEFAULT_SHARING, historyOn, type SharingSettings } from '../location/sharing';
import { circleOf, exchangeKeys, type Person, somebody } from '../location/test-support';
import { createHistory, type HistoryApi } from './history';

const MIN = 60_000;
const slot = 1_791_880_200_000;
const home = { lat: 41.0082, lng: 28.9784 };
/** A position `meters` north of home at `ts`. */
const north = (meters: number, ts: number) => ({
  lat: home.lat + meters / 111_320,
  lng: home.lng,
  acc: 8,
  spd: null,
  hdg: null,
  ts,
});

class Offline extends Error {}
class Refused extends Error {}

/** The server as phones see it: one piece per member, circle and quarter hour. */
function fakeServer() {
  const rows = new Map<string, HistoryRecord & { circleId: string }>();
  let online = true;
  const as = (person: Person): HistoryApi => ({
    put: (circleId, from, envelope: MessageEnvelope) => {
      if (!online) return Promise.reject(new Offline());
      if (from % HISTORY_SLOT_MS !== 0) return Promise.reject(new Refused());
      rows.set(`${circleId}:${person.userId}:${String(from)}`, {
        circleId,
        userId: person.userId,
        from,
        envelope,
      });
      return Promise.resolve();
    },
    list: (circleId, userId, from, to) =>
      Promise.resolve(
        [...rows.values()].filter(
          (row) =>
            row.circleId === circleId && row.userId === userId && row.from >= from && row.from < to,
        ),
      ),
    remove: (circleId) => {
      if (!online) return Promise.reject(new Offline());
      for (const [key, row] of rows) {
        if (row.circleId === circleId && row.userId === person.userId) rows.delete(key);
      }
      return Promise.resolve();
    },
  });
  return {
    as,
    rows,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
    },
  };
}

function historyOf(
  person: Person,
  circles: () => Circle[],
  api: HistoryApi,
  clock: { now: number },
  recording = () => circles().map((circle) => ({ id: circle.id, epoch: circle.epoch })),
) {
  return createHistory({
    api,
    keys: () => person.keys,
    device: () => person.device,
    userId: () => person.userId,
    recording,
    circles,
    store: () => person.store,
    refused: (error) => error instanceof Refused,
    now: () => clock.now,
  });
}

/** Ayşe walks north a minute at a time through a quarter hour from `start`, then one step more. */
async function walkQuarterFrom(
  history: ReturnType<typeof historyOf>,
  clock: { now: number },
  start: number,
) {
  const from = start - (start % HISTORY_SLOT_MS) + HISTORY_SLOT_MS;
  for (let minute = 0; minute <= 15; minute++) {
    clock.now = from + minute * MIN + 1_000;
    await history.fix(north(minute * 60, clock.now));
  }
}

/** Ayşe walks north a minute at a time through one quarter hour, then one more step. */
async function walkQuarter(history: ReturnType<typeof historyOf>, clock: { now: number }) {
  for (let minute = 0; minute <= 15; minute++) {
    clock.now = slot + minute * MIN + 1_000;
    await history.fix(north(minute * 60, clock.now));
  }
}

describe('location history on the phone', () => {
  it("is written down, sent each quarter hour, and opened on the others' phones", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    const ayses = historyOf(ayse, () => [circle], server.as(ayse), clock);
    await walkQuarter(ayses, clock);

    expect(server.rows.size).toBe(1);
    expect(JSON.stringify([...server.rows.values()])).not.toContain('4100');
    const boras = historyOf(bora, () => [circle], server.as(bora), clock);
    const seen = await boras.load(circle.id, ayse.userId, slot, slot + HISTORY_SLOT_MS);
    expect(seen.length).toBeGreaterThanOrEqual(10);
    expect(seen[0]).toMatchObject({ at: slot + 1_000, lat: home.lat });
    // Her own view comes from her phone, the open quarter hour too.
    expect(ayses.mine(slot, slot + 2 * HISTORY_SLOT_MS).length).toBeGreaterThan(seen.length);
  });

  it('is sealed for the members of the epoch it began in: someone joining later cannot open it', async () => {
    const [ayse, bora, cem] = [somebody(), somebody(), somebody()];
    let circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    const ayses = historyOf(ayse, () => [circle], server.as(ayse), clock);
    clock.now = slot + MIN;
    await ayses.fix(north(0, clock.now));
    // Cem joins mid-quarter: a new epoch, its keys for him; the piece still began in epoch 1.
    circle = { ...circleOf([ayse, bora, cem]), id: circle.id, epoch: 2 };
    exchangeKeys(circle, [ayse, bora, cem]);
    clock.now = slot + HISTORY_SLOT_MS + MIN;
    await ayses.fix(north(500, clock.now));

    const range = [slot, slot + HISTORY_SLOT_MS] as const;
    expect(
      await historyOf(bora, () => [circle], server.as(bora), clock).load(
        circle.id,
        ayse.userId,
        ...range,
      ),
    ).toHaveLength(1);
    expect(
      await historyOf(cem, () => [circle], server.as(cem), clock).load(
        circle.id,
        ayse.userId,
        ...range,
      ),
    ).toEqual([]);
  });

  it('waits while offline and goes once back online; refused pieces are not tried again', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    const ayses = historyOf(ayse, () => [circle], server.as(ayse), clock);
    server.goOffline();
    await walkQuarter(ayses, clock);
    expect(server.rows.size).toBe(0);
    server.goOnline();
    // The quarter hour after ends with no new position: the flush finishes it too.
    clock.now = slot + 2 * HISTORY_SLOT_MS + MIN;
    await ayses.flush();
    expect([...server.rows.values()].map((row) => row.from)).toEqual([
      slot,
      slot + HISTORY_SLOT_MS,
    ]);
  });

  it('sends nothing of a circle that no longer gets it, and is deleted on request', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot + MIN };
    let shared = true;
    const ayses = historyOf(
      ayse,
      () => [circle],
      server.as(ayse),
      clock,
      () => (shared ? [{ id: circle.id, epoch: circle.epoch }] : []),
    );
    await ayses.fix(north(0, clock.now));
    // Sharing stops (a ghost, a pause): what was written is dropped, nothing goes up, then or later.
    shared = false;
    clock.now += MIN;
    await ayses.fix(north(400, clock.now));
    clock.now += HISTORY_SLOT_MS;
    await ayses.fix(north(800, clock.now));
    await ayses.flush();
    expect(server.rows.size).toBe(0);
    // A quarter hour finished while shared, still waiting when sharing stopped: it stays too.
    shared = true;
    clock.now += HISTORY_SLOT_MS;
    await ayses.fix(north(0, clock.now));
    server.goOffline();
    clock.now += HISTORY_SLOT_MS;
    await ayses.fix(north(100, clock.now));
    shared = false;
    server.goOnline();
    await ayses.flush();
    expect(server.rows.size).toBe(0);
    shared = true;
    await walkQuarterFrom(ayses, clock, clock.now);
    expect(server.rows.size).toBeGreaterThan(0);

    expect(await ayses.forget(circle.id)).toBe(true);
    expect(server.rows.size).toBe(0);
  });

  it("leaves out pieces that are not what they claim, or of someone's earlier phone", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    await walkQuarter(
      historyOf(ayse, () => [circle], server.as(ayse), clock),
      clock,
    );
    // The server files the piece under another quarter hour.
    const [row] = [...server.rows.values()];
    if (row === undefined) throw new Error('missing');
    server.rows.set('moved', { ...row, from: slot + HISTORY_SLOT_MS });
    const boras = historyOf(bora, () => [circle], server.as(bora), clock);
    expect(
      await boras.load(circle.id, ayse.userId, slot + HISTORY_SLOT_MS, slot + 2 * HISTORY_SLOT_MS),
    ).toEqual([]);
    // Ayşe has a new phone since: her old pieces cannot be checked.
    const renewed = {
      ...circle,
      members: circleOf([somebody(), bora]).members.map((member, index) =>
        index === 0 ? { ...member, userId: ayse.userId } : member,
      ),
    };
    expect(
      await historyOf(bora, () => [renewed], server.as(bora), clock).load(
        circle.id,
        ayse.userId,
        slot,
        slot + HISTORY_SLOT_MS,
      ),
    ).toEqual([]);
  });

  it('sends nothing until the user turns it on for the circle (BARGU_PLAN DoD)', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    let settings: SharingSettings = DEFAULT_SHARING;
    const ayses = historyOf(
      ayse,
      () => [circle],
      server.as(ayse),
      clock,
      () =>
        historyOn(settings, circle.id, clock.now) ? [{ id: circle.id, epoch: circle.epoch }] : [],
    );
    await walkQuarter(ayses, clock);
    expect(server.rows.size).toBe(0);
    expect(ayses.mine(slot, slot + HISTORY_SLOT_MS)).toEqual([]);

    settings = {
      ghost: 'off',
      circles: { [circle.id]: { sharing: true, precision: 'exact', until: null, history: true } },
    };
    clock.now = slot + 2 * HISTORY_SLOT_MS + MIN;
    await ayses.fix(north(0, clock.now));
    clock.now += HISTORY_SLOT_MS;
    await ayses.fix(north(100, clock.now));
    expect(server.rows.size).toBe(1);
  });

  it('cannot be opened by someone removed, from then on', async () => {
    const [ayse, bora, cem] = [somebody(), somebody(), somebody()];
    let circle = circleOf([ayse, bora, cem]);
    exchangeKeys(circle, [ayse, bora, cem]);
    const server = fakeServer();
    const clock = { now: slot };
    const stale = circle;
    // Cem is removed: a new epoch whose keys only Ayşe and Bora share.
    circle = { ...circleOf([ayse, bora]), id: circle.id, epoch: 2 };
    exchangeKeys(circle, [ayse, bora]);
    await walkQuarter(
      historyOf(ayse, () => [circle], server.as(ayse), clock),
      clock,
    );
    const range = [slot, slot + HISTORY_SLOT_MS] as const;
    expect(
      await historyOf(bora, () => [circle], server.as(bora), clock).load(
        circle.id,
        ayse.userId,
        ...range,
      ),
    ).not.toEqual([]);
    // Even with the old member list still on his phone, Cem holds no key for it.
    expect(
      await historyOf(cem, () => [stale], server.as(cem), clock).load(
        circle.id,
        ayse.userId,
        ...range,
      ),
    ).toEqual([]);
  });

  it('deletes the server copy when turned off, and again after reconnecting if it had to wait', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    const ayses = historyOf(ayse, () => [circle], server.as(ayse), clock);
    await walkQuarter(ayses, clock);
    expect(server.rows.size).toBe(1);
    server.goOffline();
    const waiting = historyOf(
      ayse,
      () => [circle],
      server.as(ayse),
      clock,
      () => [],
    );
    expect(await waiting.forget(circle.id)).toBe(false);
    expect(server.rows.size).toBe(1);
    // Back online, the next flush deletes it.
    server.goOnline();
    await historyOf(
      ayse,
      () => [circle],
      server.as(ayse),
      clock,
      () => [],
    ).flush();
    expect(server.rows.size).toBe(0);
  });

  it('leaves nothing on the server when turned off while what waited is going up (QA G1)', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const rows = new Map<string, MessageEnvelope>();
    let offline = true;
    let startedAfterOff = 0;
    let off = false;
    /** Answers the network has not given yet, in order. */
    const answers: (() => void)[] = [];
    const api: HistoryApi = {
      put: (circleId, from, envelope) => {
        if (offline) return Promise.reject(new Offline());
        if (off) startedAfterOff += 1;
        return new Promise<void>((resolve) => {
          answers.push(() => {
            rows.set(`${circleId}:${String(from)}`, envelope);
            resolve();
          });
        });
      },
      list: () => Promise.resolve([]),
      remove: (circleId) => {
        for (const key of [...rows.keys()]) if (key.startsWith(circleId)) rows.delete(key);
        return Promise.resolve();
      },
    };
    const clock = { now: slot };
    const ayses = historyOf(ayse, () => [circle], api, clock);
    // Three quarter hours written while offline: three pieces wait.
    for (let quarter = 0; quarter < 3; quarter++) {
      for (let minute = 0; minute <= 15; minute++) {
        clock.now = slot + quarter * HISTORY_SLOT_MS + minute * MIN + 1_000;
        await ayses.fix(north(minute * 60 + quarter * 1_000, clock.now));
      }
    }
    // Back online, the first piece on its way, and history is turned off right then.
    offline = false;
    clock.now = slot + 4 * HISTORY_SLOT_MS;
    const sending = ayses.flush();
    await Promise.resolve();
    off = true;
    const turnedOff = ayses.forget(circle.id);
    for (let round = 0; round < 20 && answers.length > 0; round++) {
      answers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await sending;
    expect(await turnedOff).toBe(true);
    expect(startedAfterOff).toBe(0);
    expect(rows.size).toBe(0);
  });
});

describe('a ghost, a pause or a coarser precision (QA G6): what was written never goes', () => {
  const HOUR = 60 * MIN;
  const exact = { sharing: true, precision: 'exact', until: null } as const;
  const cases: [string, (circleId: string, now: number) => SharingSettings][] = [
    ['ghost (hide)', (id) => ({ ghost: 'hide', circles: { [id]: { ...exact, history: true } } })],
    [
      'ghost (freeze)',
      (id) => ({ ghost: 'freeze', circles: { [id]: { ...exact, history: true } } }),
    ],
    [
      'sharing paused',
      (id) => ({ ghost: 'off', circles: { [id]: { ...exact, sharing: false, history: true } } }),
    ],
    [
      'neighbourhood precision',
      (id) => ({
        ghost: 'off',
        circles: { [id]: { ...exact, precision: 'neighborhood', history: true } },
      }),
    ],
    [
      'a timed share over',
      (id, now) => ({
        ghost: 'off',
        circles: { [id]: { ...exact, until: now - 1, history: true } },
      }),
    ],
  ];

  function phone() {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer();
    const clock = { now: slot };
    const shared: SharingSettings = {
      ghost: 'off',
      circles: { [circle.id]: { ...exact, history: true } },
    };
    let settings = shared;
    const history = historyOf(
      ayse,
      () => [circle],
      server.as(ayse),
      clock,
      () =>
        historyOn(settings, circle.id, clock.now) ? [{ id: circle.id, epoch: circle.epoch }] : [],
    );
    /** As updateSharing does (location-session.ts): told before and after the change. */
    const change = (next: SharingSettings) => {
      history.sharingChanged();
      settings = next;
      history.sharingChanged();
    };
    return { circle, server, clock, history, shared, change };
  }

  for (const [name, hidden] of cases) {
    it(`drops the open quarter hour when ${name}, with no position while it lasts`, async () => {
      const { circle, server, clock, history, shared, change } = phone();
      clock.now = slot + MIN;
      await history.fix(north(0, clock.now));
      clock.now = slot + 2 * MIN;
      await history.fix(north(100, clock.now));
      clock.now = slot + 3 * MIN;
      change(hidden(circle.id, clock.now));
      // Hours later sharing is back; the location service starts again.
      clock.now = slot + 3 * HOUR;
      change(shared);
      clock.now = slot + 3 * HOUR + MIN;
      await history.fix(north(5_000, clock.now));
      clock.now = slot + 3 * HOUR + HISTORY_SLOT_MS + MIN;
      await history.fix(north(5_100, clock.now));
      await history.flush();
      expect([...server.rows.values()].map((row) => row.from)).not.toContain(slot);
    });

    it(`drops finished quarter hours still waiting when ${name}`, async () => {
      const { circle, server, clock, history, shared, change } = phone();
      server.goOffline();
      await walkQuarter(history, clock);
      server.goOnline();
      clock.now = slot + 2 * HISTORY_SLOT_MS;
      change(hidden(circle.id, clock.now));
      clock.now = slot + 3 * HOUR;
      change(shared);
      await walkQuarterFrom(history, clock, clock.now);
      await history.flush();
      const sent = [...server.rows.values()].map((row) => row.from);
      expect(sent).not.toContain(slot);
      expect(sent.length).toBeGreaterThan(0);
    });
  }
});

describe("the phone's own trail leaves with its reason (docs/ADR/0019)", () => {
  const ownKeys = (person: Person) =>
    person.store.keys().filter((key) => key.startsWith('history:mine:'));

  /** Ayşe records for the circles in `recording`, which a test changes as the settings would. */
  function phone(circleCount = 2) {
    const ayse = somebody();
    const circles = Array.from({ length: circleCount }, () => circleOf([ayse, somebody()]));
    for (const circle of circles) exchangeKeys(circle, [ayse]);
    const server = fakeServer();
    const clock = { now: slot };
    let recording = circles.map((circle) => ({ id: circle.id, epoch: circle.epoch }));
    const history = historyOf(
      ayse,
      () => circles,
      server.as(ayse),
      clock,
      () => recording,
    );
    return {
      ayse,
      circles,
      clock,
      history,
      server,
      /** History turned off for a circle, as the settings say it before the history is told. */
      turnOff: (circleId: string) => {
        recording = recording.filter((circle) => circle.id !== circleId);
        return history.forget(circleId);
      },
    };
  }

  it('is wiped when consent is withdrawn, whether or not anything records', async () => {
    const { ayse, clock, history } = phone();
    clock.now = slot + MIN;
    await history.fix(north(0, clock.now));
    expect(ownKeys(ayse)).toHaveLength(1);
    history.forgetMine();
    expect(ownKeys(ayse)).toEqual([]);
    expect(history.mine(slot, slot + HISTORY_SLOT_MS)).toEqual([]);
    // Nothing recording and nothing left: still fine.
    history.forgetMine();
  });

  it('stays while another circle still records, and goes with the last one turned off', async () => {
    const { ayse, circles, clock, history, turnOff } = phone();
    const [first, second] = circles;
    if (first === undefined || second === undefined) throw new Error('missing');
    clock.now = slot + MIN;
    await history.fix(north(0, clock.now));
    expect(ownKeys(ayse)).toHaveLength(1);

    await turnOff(first.id);
    expect(ownKeys(ayse)).toHaveLength(1);
    expect(history.mine(slot, slot + HISTORY_SLOT_MS)).toHaveLength(1);

    await turnOff(second.id);
    expect(ownKeys(ayse)).toEqual([]);
  });

  it('goes when the last circle is turned off while offline, too', async () => {
    const { ayse, circles, clock, history, server, turnOff } = phone(1);
    clock.now = slot + MIN;
    await history.fix(north(0, clock.now));
    expect(ownKeys(ayse)).toHaveLength(1);
    const [only] = circles;
    if (only === undefined) throw new Error('missing');
    // The server cannot be reached: the deletion there waits, the trail on the phone does not.
    server.goOffline();
    expect(await turnOff(only.id)).toBe(false);
    expect(ownKeys(ayse)).toEqual([]);
  });

  it('does not keep a slot past two weeks while nothing records and no position comes', () => {
    const { ayse, clock, history } = phone(1);
    // A trail written while a circle recorded: one old quarter hour, one recent.
    const old = slot - HISTORY_KEEP_MS;
    const recent = slot - HISTORY_SLOT_MS;
    ayse.store.set(`history:mine:${String(old)}`, '[]');
    ayse.store.set(`history:mine:${String(recent)}`, '[]');
    clock.now = slot;
    // The vault opens (or sharing changes): the old one goes with no new position.
    history.sharingChanged();
    expect(ownKeys(ayse)).toEqual([`history:mine:${String(recent)}`]);
    // Later still, with nothing recording, the recent one ages out the same way.
    clock.now = recent + HISTORY_KEEP_MS;
    history.sharingChanged();
    expect(ownKeys(ayse)).toEqual([]);
  });
});
