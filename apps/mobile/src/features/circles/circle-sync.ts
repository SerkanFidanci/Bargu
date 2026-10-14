import { rekeyReason } from '@bargu/crypto';
import type { Circle, ServerEvent } from '@bargu/schemas';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { isApiError } from '../errors';
import type { KeyStore } from '../keys/key-store';
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

export interface CircleSyncDeps {
  queryClient: QueryClient;
  api: typeof circlesApi;
  /** The signed-in user's key store (throws before sign-in: a programming error). */
  keys: () => KeyStore;
  /** Things other people did (invited, accepted, joined, changed keys) to show in the app. */
  notify?: (notices: Notice[]) => void;
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
  now = Date.now,
}: CircleSyncDeps) {
  const queues = new Map<string, Promise<void>>();
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

  function forget(circleId: string): void {
    removeCircle(queryClient, circleId);
    keys().prune(circleId, null);
    useCircleKeys.setState(
      (current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== circleId)),
      true,
    );
  }

  /** The circle as the server has it now; null (and forgotten here) when we are no longer in it. */
  async function fetchCircle(circleId: string): Promise<Circle | null> {
    try {
      const circle = await api.get(circleId);
      upsertCircle(queryClient, circle);
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
    const changed = store.observe(circle);
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
    store.prune(circle.id, circle.epoch);
    if (circle.myStatus !== 'active') {
      publish(circle);
      return;
    }
    const pending = store.pendingDistributions(circle);
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
      store.accept(circle, await api.keys(circle.id));
    }
    const askKey = `${circle.id}:${String(circle.epoch)}`;
    if (
      rekeyReason({ epochStartedAt: circle.epochStartedAt, now: now() }) !== null &&
      !rekeysAsked.has(askKey)
    ) {
      rekeysAsked.add(askKey);
      const next = await api.rekey(circle.id);
      upsertCircle(queryClient, next);
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

    /** Re-runs key exchange for a circle after the user acknowledged or verified someone. */
    resync(circleId: string): Promise<void> {
      return serial(circleId, async () => {
        const circle = cachedCircle(queryClient, circleId);
        if (circle !== undefined) await syncKeys(circle, true);
      });
    },

    /** Events in order; several about one circle collapse into one fetch. Throws if any failed. */
    async apply(events: ServerEvent[]): Promise<void> {
      const work = new Map<string, { fetch: boolean; keys: boolean; gone: boolean }>();
      for (const event of events) {
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
    },

    /** Reloads every circle and syncs all of them (first connection, or a gap in events). */
    async reload(): Promise<void> {
      const circles = await api.list();
      queryClient.setQueryData<Circle[]>(circlesKey, circles);
      const store = keys();
      for (const circleId of store.knownCircles()) {
        if (!circles.some((circle) => circle.id === circleId)) forget(circleId);
      }
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

export type CircleSync = ReturnType<typeof createCircleSync>;
