import {
  type Circle,
  type GuardianLink,
  placePutReplySchema,
  placesSchema,
  type MessageEnvelope,
} from '@bargu/schemas';

import { api, onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { guardiansKey } from '../guardians/guardians-api';
import { useCircleKeys } from '../circles/circle-sync';
import { isApiError } from '../errors';
import { circleSync, keys, onOnline, onServerEvents } from '../live/live-session';
import { contactsOf, saveContacts } from '../notifications/push-contacts';
import {
  clearExtensionShare,
  shareDeviceWithExtension,
  shareWithExtension,
} from '../notifications/extension-share';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { createPlaces, type PlacesApi } from './places';

const placesApi: PlacesApi = {
  list: async () => placesSchema.parse(await api.authed('/v1/places')).places,
  put: async (circleId: string, placeId: string, envelope: MessageEnvelope, version) =>
    placePutReplySchema.parse(
      await api.authed(`/v1/circles/${circleId}/places/${placeId}`, {
        method: 'PUT',
        body: { envelope, version },
      }),
    ).version,
  remove: async (circleId, placeId) => {
    await api.authed(`/v1/circles/${circleId}/places/${placeId}`, { method: 'DELETE' });
  },
};

function cachedCircles(): Circle[] {
  return queryClient.getQueryData<Circle[]>(circlesKey) ?? [];
}

/** The one places store of this run (docs/ADR/0015). */
export const places = createPlaces({
  api: placesApi,
  keys,
  device: () => useAuth.getState().device,
  circles: cachedCircles,
  store: vault,
  refusal: (error) => {
    if (isApiError(error, 'VERSION_CONFLICT')) return 'VERSION_CONFLICT';
    if (isApiError(error, 'EPOCH_STALE')) return 'EPOCH_STALE';
    if (isApiError(error, 'PLACES_FULL')) return 'PLACES_FULL';
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
 * Fetches the places again, then (after a pause that differs per phone, so the members of a
 * circle do not all do it at once) seals the ones of an older epoch again under this phone's key.
 */
function syncPlaces(): Promise<void> {
  if (syncing !== null) {
    again = true;
    return syncing;
  }
  syncing = (async () => {
    try {
      do {
        again = false;
        const stale = await places.sync();
        if (stale.length > 0) {
          const deviceId = useAuth.getState().device?.deviceId ?? '';
          const pause = (Number.parseInt(deviceId.slice(-4), 16) % 20) * 1_000;
          await new Promise((resolve) => setTimeout(resolve, pause));
          await places.reseal(await places.sync());
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

/** Keeps what notifications need while the app is closed in step with the circles. */
function refreshContacts(circles: readonly Circle[]): void {
  if (!isVaultOpen()) return;
  const contacts = contactsOf(
    circles,
    keys(),
    useAuth.getState().userId,
    queryClient.getQueryData<GuardianLink[]>(guardiansKey) ?? [],
  );
  saveContacts(vault(), contacts);
  void shareWithExtension(contacts).catch(() => undefined);
  const device = useAuth.getState().device;
  if (device !== null) void shareDeviceWithExtension(device).catch(() => undefined);
}

// After every (re)connection: the places as they are now.
onOnline(() => {
  void syncPlaces();
});

// A member saved or deleted a place of one of the circles.
onServerEvents((events) => {
  if (events.some((event) => event.type === 'places.changed')) void syncPlaces();
});

const CIRCLES_HASH = JSON.stringify(circlesKey);
let epochs = new Map<string, number>();

// Circles changed: who may notify, which places stay; a new epoch means places to seal again.
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== CIRCLES_HASH || event.type !== 'updated') return;
  const circles = cachedCircles();
  if (!isVaultOpen()) return;
  refreshContacts(circles);
  places.prune();
  const next = new Map(circles.map((circle) => [circle.id, circle.epoch]));
  const moved = [...next].some(([id, epoch]) => epochs.get(id) !== epoch);
  epochs = next;
  if (moved) void syncPlaces();
});

const GUARDIANS_HASH = JSON.stringify(guardiansKey);
// The guardian links changed: a parent's notifications name the child (docs/ADR/0023).
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== GUARDIANS_HASH || event.type !== 'updated') return;
  if (event.action.type !== 'success' || !isVaultOpen()) return;
  refreshContacts(cachedCircles());
});

let keysTimer: ReturnType<typeof setTimeout> | null = null;
// A sender key arrived or someone's identity was accepted: places that waited can open now; the
// contacts list follows the same trust.
useCircleKeys.subscribe(() => {
  if (keysTimer !== null) return;
  keysTimer = setTimeout(() => {
    keysTimer = null;
    refreshContacts(cachedCircles());
    void syncPlaces();
  }, 2_000);
});

onSignedOut(() => {
  places.reset();
  epochs = new Map();
  void clearExtensionShare().catch(() => undefined);
});
