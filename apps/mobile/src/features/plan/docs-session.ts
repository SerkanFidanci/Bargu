import { type Circle, docPutReplySchema, docsSchema } from '@bargu/schemas';

import { api, onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { useCircleKeys } from '../circles/circle-sync';
import { isApiError } from '../errors';
import { circleSync, keys, onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { createDocs, type DocsApi } from './docs';

const docsApi: DocsApi = {
  list: async (circleId) => docsSchema.parse(await api.authed(`/v1/circles/${circleId}/docs`)).docs,
  put: async (circleId, docId, envelope, version, kind, pollId) =>
    docPutReplySchema.parse(
      await api.authed(`/v1/circles/${circleId}/docs/${docId}`, {
        method: 'PUT',
        body: { envelope, version, kind, pollId },
      }),
    ).version,
  remove: async (circleId, docId) => {
    await api.authed(`/v1/circles/${circleId}/docs/${docId}`, { method: 'DELETE' });
  },
};

function cachedCircles(): Circle[] {
  return queryClient.getQueryData<Circle[]>(circlesKey) ?? [];
}

/** The one store of event documents of this run (docs/ADR/0018). */
export const docs = createDocs({
  api: docsApi,
  keys,
  device: () => useAuth.getState().device,
  userId: () => useAuth.getState().userId,
  circles: cachedCircles,
  store: vault,
  refusal: (error) => {
    if (isApiError(error, 'VERSION_CONFLICT')) return 'VERSION_CONFLICT';
    if (isApiError(error, 'EPOCH_STALE')) return 'EPOCH_STALE';
    if (isApiError(error, 'DOCS_FULL')) return 'DOCS_FULL';
    if (isApiError(error, 'FORBIDDEN')) return 'FORBIDDEN';
    return null;
  },
  refreshCircle: async (circleId) => {
    await circleSync.refresh(circleId);
    return cachedCircles().find((circle) => circle.id === circleId) ?? null;
  },
});

let syncing: Promise<void> | null = null;
let again = false;
/** Whether a change was announced while a sync ran (it may change during an await). */
const requested = () => again;

/**
 * Fetches the events' documents again, then (after a pause that differs per phone, so the members
 * of an event do not all do it at once) seals the ones of an older epoch again under this phone's
 * key, as places do (places-session.ts).
 */
export function syncDocs(): Promise<void> {
  if (syncing !== null) {
    again = true;
    return syncing;
  }
  syncing = (async () => {
    try {
      do {
        again = false;
        const stale = await docs.sync();
        if (stale.length > 0) {
          const deviceId = useAuth.getState().device?.deviceId ?? '';
          const pause = (Number.parseInt(deviceId.slice(-4), 16) % 20) * 1_000;
          await new Promise((resolve) => setTimeout(resolve, pause));
          await docs.reseal(await docs.sync());
        }
      } while (requested());
    } catch {
      // Offline or refused: the next connection or event tries again.
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// After every (re)connection: the documents as they are now.
onOnline(() => {
  void syncDocs();
});

// A member saved or deleted a document of one of the events.
onServerEvents((events) => {
  if (events.some((event) => event.type === 'docs.changed')) void syncDocs();
});

const CIRCLES_HASH = JSON.stringify(circlesKey);
let epochs = new Map<string, number>();

// Events changed: ended or left ones go; a new event or a new epoch means documents to fetch or
// to seal again.
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== CIRCLES_HASH || event.type !== 'updated') return;
  if (!isVaultOpen()) return;
  docs.prune();
  const events = cachedCircles().filter((circle) => circle.kind === 'event');
  const next = new Map(events.map((circle) => [circle.id, circle.epoch]));
  const moved = [...next].some(([id, epoch]) => epochs.get(id) !== epoch);
  epochs = next;
  if (moved) void syncDocs();
});

let keysTimer: ReturnType<typeof setTimeout> | null = null;
// A sender key arrived or someone's identity was accepted: documents that waited can open now.
useCircleKeys.subscribe(() => {
  if (keysTimer !== null) return;
  keysTimer = setTimeout(() => {
    keysTimer = null;
    if (cachedCircles().some((circle) => circle.kind === 'event')) void syncDocs();
  }, 2_000);
});

onSignedOut(() => {
  docs.reset();
  epochs = new Map();
});
