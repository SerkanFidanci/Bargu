import type { KeyValueStore } from '../../storage/vault';
import { segments } from '../trail-model';
import {
  compactDay,
  dayKey,
  dayStartOf,
  expiredDays,
  mayRecord,
  monthOf,
  OWN_DEFAULT,
  type Recording,
} from './own-model';
import { createOwnTrail, type MonthFiles } from './own-trail';

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
    clear: () => {
      map.clear();
    },
  };
}

/** Month files in memory, counting how often one is opened and not closed. */
function memoryFiles() {
  const months = new Map<string, KeyValueStore>();
  const state = { open: 0, destroyed: false };
  const files: MonthFiles = {
    months: () => [...months.keys()],
    open: (month) => {
      let store = months.get(month);
      if (store === undefined) {
        store = memory();
        months.set(month, store);
      }
      state.open += 1;
      return {
        store,
        close: () => {
          state.open -= 1;
        },
      };
    },
    destroy: () => {
      months.clear();
      state.destroyed = true;
    },
  };
  return { files, months, state };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Noon, so the day is the same whatever the zone of the machine running the tests.
const TODAY = new Date(2026, 9, 29, 12, 0).getTime();
const YESTERDAY = TODAY - DAY;
const ON: Recording = { entitled: true, ghost: 'off', sharing: true };

function setup(options: { unlocked?: boolean; at?: number } = {}) {
  const vault = memory();
  const month = memoryFiles();
  const clock = { now: options.at ?? TODAY };
  const lock = { unlocked: options.unlocked ?? true };
  const trail = createOwnTrail({
    vault: () => vault,
    files: month.files,
    unlocked: () => lock.unlocked,
    now: () => clock.now,
  });
  return { trail, vault, ...month, clock, lock };
}

/** A walk: a place for an hour, then moving. */
function stayAt(start: number, minutes: number, lat = 41.0256, lng = 28.9742) {
  return Array.from({ length: Math.floor(minutes / 5) + 1 }, (_, index) => ({
    lat,
    lng,
    acc: 10,
    ts: start + index * 5 * MIN,
  }));
}

describe('what is written (docs/ADR/0030 §1)', () => {
  it('needs the user to turn it on, Bargu+, no ghost and someone to share with', () => {
    const on = { ...OWN_DEFAULT, on: true };
    expect(mayRecord(OWN_DEFAULT, ON)).toBe(false);
    expect(mayRecord(on, ON)).toBe(true);
    expect(mayRecord(on, { ...ON, entitled: false })).toBe(false);
    expect(mayRecord(on, { ...ON, ghost: 'hide' })).toBe(false);
    expect(mayRecord(on, { ...ON, ghost: 'freeze' })).toBe(false);
    expect(mayRecord(on, { ...ON, sharing: false })).toBe(false);
  });

  it('writes nothing while off, and keeps points of one position once on', () => {
    const { trail, vault } = setup();
    for (const fix of stayAt(YESTERDAY, 30)) trail.record(fix, ON);
    expect(vault.keys()).toHaveLength(0);

    trail.setSettings({ on: true, keep: 30 });
    for (const fix of stayAt(YESTERDAY, 30)) trail.record(fix, ON);
    expect(vault.keys().filter((key) => key.startsWith('own:q:')).length).toBeGreaterThan(0);
    expect(trail.days()).toEqual([dayKey(YESTERDAY)]);
    trail.record({ lat: 41, lng: 29, acc: 10, ts: TODAY }, { ...ON, ghost: 'hide' });
    expect(trail.days()).toEqual([dayKey(YESTERDAY)]);
  });
});

describe('a day goes into its month (docs/ADR/0030 §3)', () => {
  it('stays in the vault while its day goes on, and moves to the month file after midnight', () => {
    const { trail, vault, months } = setup();
    trail.setSettings({ on: true, keep: 30 });
    for (const fix of stayAt(TODAY - 2 * HOUR, 60)) trail.record(fix, ON);
    // Today's own day is never compacted.
    expect(trail.compact()).toEqual([]);
    expect(months.size).toBe(0);

    const tomorrow = TODAY + DAY;
    const later = setup({ at: tomorrow });
    later.trail.setSettings({ on: true, keep: 30 });
    for (const fix of stayAt(TODAY - 2 * HOUR, 60)) later.trail.record(fix, ON);
    expect(later.trail.compact()).toEqual([dayKey(TODAY)]);
    expect([...later.months.keys()]).toEqual([monthOf(dayKey(TODAY))]);
    // The waiting points are gone from the vault, the day reads back from its file.
    expect(later.vault.keys().filter((key) => key.startsWith('own:q:'))).toEqual([]);
    expect(later.trail.read(dayKey(TODAY)).length).toBeGreaterThan(0);
    expect(vault.keys()).not.toEqual(later.vault.keys());
  });

  it('is left alone with the phone locked: nothing is written to the files or read from them', () => {
    const { trail, months, state, lock, clock } = setup({ unlocked: false });
    trail.setSettings({ on: true, keep: 30 });
    for (const fix of stayAt(YESTERDAY, 30)) trail.record(fix, ON);
    expect(trail.compact()).toEqual([]);
    expect(months.size).toBe(0);
    // What waits can still be read, and shows as a day.
    expect(trail.days()).toEqual([dayKey(YESTERDAY)]);
    expect(trail.read(dayKey(YESTERDAY)).length).toBeGreaterThan(0);

    lock.unlocked = true;
    clock.now = TODAY;
    expect(trail.compact()).toEqual([dayKey(YESTERDAY)]);
    expect(state.open).toBe(0);
  });

  it('closes every month file it opened, also when a read fails', () => {
    const { trail, state } = setup();
    trail.setSettings({ on: true, keep: 30 });
    for (const fix of stayAt(YESTERDAY, 30)) trail.record(fix, ON);
    trail.compact();
    trail.read(dayKey(YESTERDAY));
    trail.days();
    trail.prune();
    expect(state.open).toBe(0);
  });

  it('compacts a stay to its entry and exit, and the day still reads as the same stay and trip', () => {
    const hour = 8;
    const start = new Date(2026, 9, 28, hour, 0).getTime();
    const stay = stayAt(start, 120);
    const walk = Array.from({ length: 12 }, (_, index) => ({
      at: start + 120 * MIN + (index + 1) * MIN,
      lat: 41.0256 + (index + 1) * 0.0004,
      lng: 28.9742,
      acc: 10,
    }));
    const points = [
      ...stay.map((fix) => ({ at: fix.ts, lat: fix.lat, lng: fix.lng, acc: fix.acc })),
      ...walk,
    ];
    const before = segments(points);
    const compact = compactDay(points);
    // 25 points of the stay became five (entry, exit and one every half hour), the walk half.
    expect(compact.length).toBeLessThan(points.length * 0.6);
    const after = segments(
      compact.map((point) => ({
        at: point[0],
        lat: point[1] / 1e5,
        lng: point[2] / 1e5,
        acc: point[3],
      })),
    );
    expect(after.filter((part) => part.kind === 'stay')).toHaveLength(
      before.filter((part) => part.kind === 'stay').length,
    );
    expect(after.some((part) => part.kind === 'move')).toBe(true);
  });
});

describe('keeping, deleting, exporting', () => {
  it('forgets days older than the keep, from the files and the vault', () => {
    const { trail, months, clock } = setup();
    trail.setSettings({ on: true, keep: 30 });
    const old = TODAY - 40 * DAY;
    const recent = TODAY - 5 * DAY;
    for (const at of [old, recent]) {
      clock.now = at + DAY;
      for (const fix of stayAt(at, 30)) trail.record(fix, ON);
      trail.compact();
    }
    clock.now = TODAY;
    expect(trail.days().sort()).toEqual([dayKey(old), dayKey(recent)].sort());
    trail.prune();
    expect(trail.days()).toEqual([dayKey(recent)]);
    // A year keeps both.
    trail.setSettings({ on: true, keep: 365 });
    expect(expiredDays([dayKey(old)], TODAY, 365)).toEqual([]);
    expect(months.size).toBeGreaterThan(0);
  });

  it('is deleted at once and for good: every file, its key and what waits', () => {
    const { trail, vault, months, state } = setup();
    trail.setSettings({ on: true, keep: 30 });
    for (const fix of stayAt(YESTERDAY, 30)) trail.record(fix, ON);
    trail.compact();
    for (const fix of stayAt(TODAY - HOUR, 30)) trail.record(fix, ON);
    trail.clear();
    expect(state.destroyed).toBe(true);
    expect(months.size).toBe(0);
    expect(vault.keys().filter((key) => key.startsWith('own:q:'))).toEqual([]);
    expect(trail.days()).toEqual([]);
    // The user's choice is not history: it stays.
    expect(trail.settings().on).toBe(true);
  });

  it('exports every day with its points, oldest first', () => {
    const { trail, clock } = setup();
    trail.setSettings({ on: true, keep: 30 });
    for (const at of [YESTERDAY, TODAY]) {
      clock.now = at + DAY;
      for (const fix of stayAt(at, 30)) trail.record(fix, ON);
      trail.compact();
    }
    const out = trail.exported();
    expect(out.map((entry) => entry.day)).toEqual([dayKey(YESTERDAY), dayKey(TODAY)]);
    expect(out.every((entry) => entry.points.length > 0)).toBe(true);
  });

  it('counts a long wait as a backlog, to be compacted at the first chance', () => {
    const { trail, clock } = setup({ unlocked: false });
    trail.setSettings({ on: true, keep: 30 });
    for (let back = 1; back <= 5; back++) {
      for (const fix of stayAt(TODAY - back * DAY, 20)) trail.record(fix, ON);
    }
    clock.now = TODAY;
    expect(trail.backlog()).toBe(true);
  });
});

describe('day keys', () => {
  it("names a day by this phone's clock and finds its start again", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(monthOf('2026-01-05')).toBe('2026-01');
    expect(dayStartOf('2026-01-05')).toBe(new Date(2026, 0, 5).getTime());
  });
});
