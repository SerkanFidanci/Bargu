import { type Circle, docPutReplySchema, docsSchema } from '@bargu/schemas';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { api, onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { useCircleKeys } from '../circles/circle-sync';
import { isApiError } from '../errors';
import { circleSync, keys, onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { memberName } from '../circles/names';
import { usePlaces } from '../places/places';
import { isVaultOpen, vault } from '../storage/vault';
import { createDocs, type DocsApi } from './docs';
import type { Doc } from './plan-model';

/**
 * Someone started a meeting in a circle that is no event (docs/ADR/0026 §6), seen live: a line in
 * the app (their notification goes only to phones whose app is not connected).
 */
function meetingStarted(circle: Circle, doc: Doc): void {
  const plan = doc.payload;
  if (plan.kind !== 'plan' || plan.meetAt === undefined || plan.placeId === undefined) return;
  const by = circle.members.find((member) => member.userId === plan.by);
  const place = usePlaces.getState()[plan.placeId];
  if (by === undefined || place === undefined) return;
  const time = new Date(plan.meetAt).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  toast.info(
    i18n.t('notifications.meeting', {
      name: memberName(by),
      time,
      place: `${place.emoji} ${place.name}`,
    }),
  );
}

const docsApi: DocsApi = {
  list: async (circleId) => docsSchema.parse(await api.authed(`/v1/circles/${circleId}/docs`)).docs,
  put: async (circleId, docId, envelope, version, kind, pollId, extra = {}) =>
    docPutReplySchema.parse(
      await api.authed(`/v1/circles/${circleId}/docs/${docId}`, {
        method: 'PUT',
        body: {
          envelope,
          version,
          kind,
          pollId,
          ...(extra.endsAt === undefined ? {} : { endsAt: extra.endsAt }),
          ...(extra.pushes === undefined ? {} : { pushes: extra.pushes }),
        },
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
    if (isApiError(error, 'MEETING_EXISTS')) return 'MEETING_EXISTS';
    return null;
  },
  onMeetingStarted: meetingStarted,
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
  // Every circle can hold a meeting (docs/ADR/0026), events their polls too.
  const withDocs = cachedCircles().filter((circle) => circle.myStatus === 'active');
  const next = new Map(withDocs.map((circle) => [circle.id, circle.epoch]));
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
    if (cachedCircles().some((circle) => circle.myStatus === 'active')) void syncDocs();
  }, 2_000);
});

onSignedOut(() => {
  docs.reset();
  epochs = new Map();
});
