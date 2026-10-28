import { historySlot, trailPointSchema } from '@bargu/schemas';
import { z } from 'zod';

import type { Fix } from '../../location/send';
import type { KeyValueStore } from '../../storage/vault';
import type { TracePoint } from '../trail-model';
import {
  compactDay,
  dayKey,
  dayPointsSchema,
  dayStartOf,
  expiredDays,
  fromDayPoint,
  type KeepDays,
  monthOf,
  type OwnSettings,
  OWN_DEFAULT,
  ownSettingsSchema,
  PENDING_PREFIX,
  pendingKey,
  pendingPoints,
  type Recording,
  mayRecord,
  withOwnFix,
} from './own-model';

/**
 * The month files of one's own history (docs/ADR/0030 §3): one encrypted store per month, opened
 * when a day of it is read or written and closed after. The real ones are in own-files.ts.
 */
export interface MonthFiles {
  /** The months that have a file. */
  months: () => string[];
  /** Opens the month's store (creating it); `close` when done with it. */
  open: (month: string) => { store: KeyValueStore; close: () => void };
  /** Throws it all away: every month file and the key. */
  destroy: () => void;
}

export interface OwnTrailDeps {
  /** The always-open vault: settings and the points of days not yet compacted. */
  vault: () => KeyValueStore;
  files: MonthFiles;
  /** Whether the phone is unlocked: month files and their key can be read only then. */
  unlocked: () => boolean;
  now?: () => number;
}

const SETTINGS_KEY = 'own:settings:v1';
const DAY_PREFIX = 'd:';
/** Waiting days older than this many are all compacted at the first chance (docs/ADR/0030 §3). */
const PENDING_DAYS_MAX = 3;

function readJson<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>): T | null {
  const raw = store.get(key);
  if (raw === undefined) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const pendingSchema = z.array(trailPointSchema);

/**
 * One's own location history: written down on this phone alone, from positions the engine already
 * takes. Quarter hours wait in the vault; once their day is over (and the phone is unlocked) the
 * day is compacted into its month's file. Nothing here reaches the network or a log.
 */
export function createOwnTrail(deps: OwnTrailDeps) {
  const now = deps.now ?? Date.now;

  function settings(): OwnSettings {
    return readJson(deps.vault(), SETTINGS_KEY, ownSettingsSchema) ?? OWN_DEFAULT;
  }

  function setSettings(next: OwnSettings): void {
    deps.vault().set(SETTINGS_KEY, JSON.stringify(next));
  }

  /** Slots waiting, as `[slot, points]` in time order. */
  function pending(): { slot: number; points: z.infer<typeof pendingSchema> }[] {
    const vault = deps.vault();
    return vault
      .keys()
      .filter((key) => key.startsWith(PENDING_PREFIX))
      .flatMap((key) => {
        const slot = Number(key.slice(PENDING_PREFIX.length));
        const points = readJson(vault, key, pendingSchema);
        if (!Number.isFinite(slot) || points === null) {
          vault.delete(key);
          return [];
        }
        return [{ slot, points }];
      })
      .sort((a, b) => a.slot - b.slot);
  }

  /** A new position, written down when the user's choice and the rules (`state`) say so. */
  function record(fix: Pick<Fix, 'lat' | 'lng' | 'acc' | 'ts'>, state: Recording): void {
    if (!mayRecord(settings(), state)) return;
    const slot = historySlot(fix.ts);
    const vault = deps.vault();
    const held = readJson(vault, pendingKey(slot), pendingSchema) ?? [];
    const next = withOwnFix(held, fix);
    vault.set(pendingKey(next.slot), JSON.stringify(next.points));
  }

  /** The points of a day still waiting in the vault. */
  function waitingOf(day: string): TracePoint[] {
    const start = dayStartOf(day);
    const end = start + 24 * 3_600_000;
    return pending()
      .filter((piece) => piece.slot >= start && piece.slot < end)
      .flatMap((piece) => pendingPoints(piece.slot, piece.points))
      .filter((point) => dayKey(point.at) === day);
  }

  /** The days with something waiting in the vault. */
  function waitingDays(): string[] {
    return [
      ...new Set(
        pending().flatMap((piece) =>
          pendingPoints(piece.slot, piece.points).map((point) => dayKey(point.at)),
        ),
      ),
    ].sort();
  }

  /**
   * Days that are over go into their month's file: only with the phone unlocked (the file's key is
   * readable then). A day already in the file gets what waits added. Returns the days compacted.
   */
  function compact(): string[] {
    if (!deps.unlocked()) return [];
    const today = dayKey(now());
    const due = waitingDays().filter((day) => day < today);
    const done: string[] = [];
    for (const day of due) {
      const points = waitingOf(day);
      const month = deps.files.open(monthOf(day));
      try {
        const kept = readJson(month.store, `${DAY_PREFIX}${day}`, dayPointsSchema) ?? [];
        const merged = compactDay([...kept.map(fromDayPoint), ...points]);
        month.store.set(`${DAY_PREFIX}${day}`, JSON.stringify(merged));
      } finally {
        month.close();
      }
      done.push(day);
    }
    if (done.length > 0) dropWaiting(done);
    return done;
  }

  /** Removes the waiting quarter hours of these days (they are in their file now). */
  function dropWaiting(days: readonly string[]): void {
    const vault = deps.vault();
    const set = new Set(days);
    for (const piece of pending()) {
      const all = pendingPoints(piece.slot, piece.points);
      if (all.length > 0 && all.every((point) => set.has(dayKey(point.at)))) {
        vault.delete(pendingKey(piece.slot));
      }
    }
  }

  /** Whether too many days wait (the phone was not unlocked in the app for a while). */
  function backlog(): boolean {
    return waitingDays().filter((day) => day < dayKey(now())).length > PENDING_DAYS_MAX;
  }

  /** Forgets the days older than the user's keep, from the files and from the vault. */
  function prune(): void {
    const keep: KeepDays = settings().keep;
    const vault = deps.vault();
    for (const day of expiredDays(waitingDays(), now(), keep)) {
      for (const piece of pending()) {
        if (pendingPoints(piece.slot, piece.points).every((point) => dayKey(point.at) === day)) {
          vault.delete(pendingKey(piece.slot));
        }
      }
    }
    if (!deps.unlocked()) return;
    for (const month of deps.files.months()) {
      const file = deps.files.open(month);
      try {
        const days = file.store
          .keys()
          .filter((key) => key.startsWith(DAY_PREFIX))
          .map((key) => key.slice(DAY_PREFIX.length));
        for (const day of expiredDays(days, now(), keep)) file.store.delete(`${DAY_PREFIX}${day}`);
      } finally {
        file.close();
      }
    }
  }

  /** The days that have a record, newest first (what the screen's strip colours in). */
  function days(): string[] {
    const found = new Set(waitingDays());
    if (deps.unlocked()) {
      for (const month of deps.files.months()) {
        const file = deps.files.open(month);
        try {
          for (const key of file.store.keys()) {
            if (key.startsWith(DAY_PREFIX)) found.add(key.slice(DAY_PREFIX.length));
          }
        } finally {
          file.close();
        }
      }
    }
    return [...found].sort().reverse();
  }

  /** One day's points: from its month's file (phone unlocked) and what waits in the vault. */
  function read(day: string): TracePoint[] {
    const waiting = waitingOf(day);
    if (!deps.unlocked()) return waiting;
    const file = deps.files.open(monthOf(day));
    try {
      const kept = readJson(file.store, `${DAY_PREFIX}${day}`, dayPointsSchema) ?? [];
      return [...kept.map(fromDayPoint), ...waiting].sort((a, b) => a.at - b.at);
    } finally {
      file.close();
    }
  }

  /** "Geçmişimi sil": every file, its key, and what waits. Cannot be taken back. */
  function clear(): void {
    const vault = deps.vault();
    for (const key of vault.keys()) {
      if (key.startsWith(PENDING_PREFIX)) vault.delete(key);
    }
    deps.files.destroy();
  }

  /** Everything for "Dışa aktar": each day with its points (plain, readable). */
  function exported(): { day: string; points: TracePoint[] }[] {
    return days()
      .sort()
      .map((day) => ({ day, points: read(day) }));
  }

  return {
    settings,
    setSettings,
    record,
    compact,
    backlog,
    prune,
    days,
    read,
    clear,
    exported,
  };
}

export type OwnTrail = ReturnType<typeof createOwnTrail>;
