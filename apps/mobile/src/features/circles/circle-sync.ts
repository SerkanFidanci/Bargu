import { rekeyReason } from '@bargu/crypto';
import type { Circle, ServerEvent } from '@bargu/schemas';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { isApiError } from '../errors';
import type { KeyStore } from '../keys/key-store';
import { timed } from '../location/probe';
import { cachedCircle, circlesKey, removeCircle, upsertCircle } from './circle-cache';
import type { circlesApi } from './circles-api';
import { memberName } from './names';
import { type Notice, noticesFor, seenOf } from './notices';

export type Trust = 'verified' | 'unverified' | 'changed';

/** What the screens show about a circle's encryption, kept current by every sync. */
export interface CircleKeyStatus {
  /** Every active member's key for the current epoch arrived and ours went out. */
  ready: boolean;
  waitingFor: number;
  /** Per member (not including me): compared in person, first seen, or changed and on hold. */
  trust: Record<string, Trust>;
}

export const useCircleKeys = create<Record<string, CircleKeyStatus>>(() => ({}));

/** A person this phone shares no circle with any more, and the devices they were met with. */
export interface DepartedPerson {
  userId: string;
  deviceIds: readonly string[];
}

/**
 * Everyone this phone shares an active circle with (both active in it), with the devices they have
 * now. A person who is only invited, or in a circle this phone is only invited to, is not shared with:
 * nothing of theirs reaches this phone.
 */
function sharedWith(circles: readonly Circle[], store: KeyStore): Map<string, Set<string>> {
  const shared = new Map<string, Set<string>>();
  for (const circle of circles) {
    if (circle.myStatus !== 'active') continue;
    for (const member of circle.members) {
      if (member.status !== 'active' || store.isMe(member.userId)) continue;
      const devices = shared.get(member.userId) ?? new Set<string>();
      if (member.device !== null) devices.add(member.device.bundle.deviceId);
      shared.set(member.userId, devices);
    }
  }
  return shared;
}

export interface CircleSyncDeps {
  queryClient: QueryClient;
  api: typeof circlesApi;
  /** The signed-in user's key store (throws before sign-in: a programming error). */
  keys: () => KeyStore;
  /** Things other people did (invited, accepted, joined, changed keys) to show in the app. */
  notify?: (notices: Notice[]) => void;
  /**
   * The very first load on this phone found circles the account is already in (a reinstall or a
   * new phone): called before anything shows or sends them, so settings can be made safe first.
   */
  firstLoad?: (circles: Circle[]) => void;
  /**
   * Circles the account is no longer in (left, declined, removed, an event over), as the server
   * said it: one circle, or every circle missing from the full list. Never from the cache alone,
   * which may hold only some circles before the list arrives.
   */
  gone?: (isGone: (circleId: string) => boolean) => void;
  /**
   * People this phone shares no circle with any more: the last circle they shared with it went
   * (they left or were removed, this phone left, a circle ended, an event over). Called once for
   * them, and everything local about them is deleted there (features/location/forget-person.ts).
   * Never while some shared circle remains, and never before the full circle list has been loaded
   * once (a partial cache is not a departure). If it throws, the person is still remembered and
   * the next change of the circle list tries again.
   */
  departed?: (people: readonly DepartedPerson[]) => void;
  now?: () => number;
}

/**
 * Keeps circles and their sender keys current from events and from the user's own actions
 * (docs/ADR/0009). For each circle, one step at a time: record the epoch and the members'
 * identities, send our key to everyone trusted who lacks it, take in theirs, drop what the
 * protocol no longer accepts, and ask for a new epoch once the current one is a day old.
 */
export function createCircleSync({
  queryClient,
  api,
  keys,
  notify = () => undefined,
  firstLoad = () => undefined,
  gone = () => undefined,
  departed = () => undefined,
  now = Date.now,
}: CircleSyncDeps) {
  const queues = new Map<string, Promise<void>>();
  /**
   * The key store of the account whose full circle list this run has loaded (null before the first
   * `reload`, and a new store after a sign-out). Until then the cache may hold only some circles, so
   * nobody can be told to have left.
   */
  let listed: KeyStore | null = null;
  /** Rekey asked once per circle and epoch per run (the server decides; no loops). */
  const rekeysAsked = new Set<string>();

  /** Runs tasks for the same circle one after another; returns this task's outcome. */
  function serial(circleId: string, task: () => Promise<void>): Promise<void> {
    const previous = queues.get(circleId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    queues.set(circleId, settled);
    void settled.then(() => {
      if (queues.get(circleId) === settled) queues.delete(circleId);
    });
    return next;
  }

  /**
   * Remembers what the user now knows of a circle. With `announce`, what changed since last time
   * because of other people becomes a notice; the user's own actions are recorded silently.
   */
  function remember(circle: Circle, announce: boolean): void {
    const store = keys();
    const isMe = (userId: string) => store.isMe(userId);
    if (announce && store.noticesReady()) {
      const notices = noticesFor(store.seen(circle.id), circle, isMe);
      if (notices.length > 0) notify(notices);
    }
    store.setSeen(circle.id, seenOf(circle, isMe));
  }

  function publish(circle: Circle): void {
    const store = keys();
    const trust: Record<string, Trust> = {};
    for (const member of circle.members) {
      if (member.device !== null && !store.isMe(member.userId)) {
        trust[member.userId] = store.trust(member.userId);
      }
    }
    const { ready, waitingFor } = store.readiness(circle);
    useCircleKeys.setState({ [circle.id]: { ready, waitingFor, trust } });
  }

  /**
   * After the circle list changed: the people this phone shares no circle with any more are handed
   * to `departed`, once. `keys().knownPeople()` is who was shared with before (and the devices they
   * were met with, which the circle list no longer shows once they are gone).
   */
  function settlePeople(): void {
    const store = keys();
    if (listed !== store) return;
    const circles = queryClient.getQueryData<Circle[]>(circlesKey);
    if (circles === undefined) return;
    try {
      const before = store.knownPeople();
      const shared = sharedWith(circles, store);
      const left = Object.entries(before)
        .filter(([userId]) => !shared.has(userId))
        .map(([userId, deviceIds]) => ({ userId, deviceIds }));
      if (left.length > 0) departed(left);
      const next: Record<string, string[]> = {};
      for (const [userId, devices] of shared) {
        next[userId] = [...new Set([...(before[userId] ?? []), ...devices])];
      }
      store.rememberPeople(next);
    } catch {
      // Not remembered as forgotten: the next change of the circle list tries again.
    }
  }

  function forget(circleId: string): void {
    gone((id) => id === circleId);
    removeCircle(queryClient, circleId);
    keys().prune(circleId, null);
    useCircleKeys.setState(
      (current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== circleId)),
      true,
    );
    settlePeople();
  }

  /** The circle as the server has it now; null (and forgotten here) when we are no longer in it. */
  async function fetchCircle(circleId: string): Promise<Circle | null> {
    try {
      const circle = await api.get(circleId);
      upsertCircle(queryClient, circle);
      settlePeople();
      return circle;
    } catch (error) {
      if (isApiError(error, 'NOT_FOUND', 'FORBIDDEN')) {
        forget(circleId);
        return null;
      }
      throw error;
    }
  }

  async function syncKeys(circle: Circle, fetchKeys: boolean, attempt = 0): Promise<void> {
    const store = keys();
    const changed = timed('keys.observe', () => store.observe(circle));
    if (changed.length > 0) {
      notify([
        {
          kind: 'keyChanged',
          circleId: circle.id,
          names: circle.members
            .filter((member) => changed.includes(member.userId))
            .map((member) => memberName(member)),
        },
      ]);
    }
    timed('keys.prune', () => {
      store.prune(circle.id, circle.epoch);
    });
    if (circle.myStatus !== 'active') {
      publish(circle);
      return;
    }
    const pending = timed('keys.distribute', () => store.pendingDistributions(circle));
    if (pending.length > 0) {
      try {
        await api.uploadKeys(circle.id, circle.epoch, pending);
        store.markSent(circle, pending);
      } catch (error) {
        // A new epoch began meanwhile (someone joined or left): start over with it, once.
        if (!isApiError(error, 'EPOCH_STALE') || attempt > 0) throw error;
        const fresh = await fetchCircle(circle.id);
        if (fresh !== null) await syncKeys(fresh, true, attempt + 1);
        return;
      }
    }
    if (fetchKeys || !store.readiness(circle).ready) {
      const received = await api.keys(circle.id);
      timed('keys.accept', () => store.accept(circle, received));
    }
    const askKey = `${circle.id}:${String(circle.epoch)}`;
    if (
      rekeyReason({ epochStartedAt: circle.epochStartedAt, now: now() }) !== null &&
      !rekeysAsked.has(askKey)
    ) {
      rekeysAsked.add(askKey);
      const next = await api.rekey(circle.id);
      upsertCircle(queryClient, next);
      settlePeople();
      if (next.epoch !== circle.epoch) {
        await syncKeys(next, false, attempt);
        return;
      }
    }
    publish(circle);
  }

  return {
    /** After the user's own action returned the circle (create, accept, invite, remove…). */
    adopt(circle: Circle): Promise<void> {
      upsertCircle(queryClient, circle);
      settlePeople();
      remember(circle, false);
      return serial(circle.id, () => syncKeys(circle, circle.myStatus === 'active'));
    },

    /** After leaving or declining: gone from the list, its keys deleted. */
    drop(circleId: string): void {
      forget(circleId);
    },

    /** Fetches one circle (e.g. just joined by invite) and syncs it. */
    refresh(circleId: string): Promise<void> {
      return serial(circleId, async () => {
        const circle = await fetchCircle(circleId);
        if (circle === null) return;
        remember(circle, false);
        await syncKeys(circle, true);
      });
    },

    /**
     * After the user accepted or verified someone's key: every circle they share is fetched again
     * and its keys exchanged. Trust is per person, so one circle alone left the others showing
     * "Anahtar değişti" and never handing them the key (proje sahibi 2026-10-16: a new key accepted
     * in one circle, the pair and friends circles still on hold).
     */
    async resyncMember(userId: string): Promise<void> {
      const shared = (queryClient.getQueryData<Circle[]>(circlesKey) ?? []).filter(
        (circle) =>
          circle.myStatus === 'active' && circle.members.some((member) => member.userId === userId),
      );
      const results = await Promise.allSettled(
        shared.map((circle) =>
          serial(circle.id, async () => {
            const fresh = await fetchCircle(circle.id);
            if (fresh === null) return;
            remember(fresh, false);
            await syncKeys(fresh, true);
          }),
        ),
      );
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('some circles could not be synced');
      }
    },

    /** Events in order; several about one circle collapse into one fetch. Throws if any failed. */
    async apply(events: ServerEvent[]): Promise<void> {
      const work = new Map<string, { fetch: boolean; keys: boolean; gone: boolean }>();
      let reloadAll = false;
      for (const event of events) {
        // Places, event documents, guardian links and the plan have their own sync (features/places,
        // features/plan, features/guardians, features/billing); the circle itself did not change.
        if (
          event.type === 'places.changed' ||
          event.type === 'docs.changed' ||
          event.type === 'guardians.changed' ||
          event.type === 'plan.changed'
        ) {
          continue;
        }
        // An event circle ended early: the server names no ended circle, the list tells which.
        if (event.type === 'circles.reload') {
          reloadAll = true;
          continue;
        }
        const entry = work.get(event.circleId) ?? { fetch: false, keys: false, gone: false };
        if (event.type === 'circle.gone') {
          entry.gone = true;
          entry.fetch = false;
          entry.keys = false;
        } else {
          entry.gone = false;
          const known = cachedCircle(queryClient, event.circleId);
          if (event.type === 'circle.changed' || known === undefined || known.epoch < event.epoch) {
            entry.fetch = true;
          }
          if (event.type === 'keys.available') entry.keys = true;
        }
        work.set(event.circleId, entry);
      }
      const results = await Promise.allSettled(
        [...work].map(([circleId, entry]) =>
          serial(circleId, async () => {
            if (entry.gone) {
              forget(circleId);
              return;
            }
            const circle = entry.fetch
              ? await fetchCircle(circleId)
              : (cachedCircle(queryClient, circleId) ?? null);
            if (circle === null) return;
            if (entry.fetch) remember(circle, true);
            await syncKeys(circle, entry.keys);
          }),
        ),
      );
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('some events could not be applied');
      }
      if (reloadAll) await this.reload();
    },

    /** Reloads every circle and syncs all of them (first connection, or a gap in events). */
    async reload(): Promise<void> {
      const circles = await api.list();
      const store = keys();
      if (!store.noticesReady() && circles.some((circle) => circle.myStatus === 'active')) {
        firstLoad(circles);
      }
      queryClient.setQueryData<Circle[]>(circlesKey, circles);
      for (const circleId of store.knownCircles()) {
        if (!circles.some((circle) => circle.id === circleId)) forget(circleId);
      }
      // Also what this phone kept about circles it had no keys for any more.
      const listedIds = new Set(circles.map((circle) => circle.id));
      gone((circleId) => !listedIds.has(circleId));
      // The full list is known: from now on a person missing from it has really left, and so does
      // one who left while the app was closed (the people remembered from last time).
      listed = store;
      settlePeople();
      // What happened while the app was closed is announced once; the very first load only records.
      for (const circle of circles) remember(circle, true);
      store.markNoticesReady();
      const results = await Promise.allSettled(
        circles.map((circle) => serial(circle.id, () => syncKeys(circle, true))),
      );
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('some circles could not be synced');
      }
    },
  };
}
