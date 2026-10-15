import {
  type Circle,
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
