import {
  type Circle,
  locationSnapshotSchema,
  locEventSchema,
  locGoneEventSchema,
  MAX_CIRCLES_PER_REQUEST,
  MEMBER_STATUSES,
  type MessageEnvelope,
  type PublishReply,
  publishReplySchema,
  watchEventSchema,
} from '@bargu/schemas';
import * as Battery from 'expo-battery';
import { z } from 'zod';
import { create } from 'zustand';

import { api, onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { useCircleKeys } from '../circles/circle-sync';
import { circleSync, keys, liveRequest, onLiveMessage, onOnline } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { createLocationEngine, LIVE_MS, type SendCircle, toSendCircle } from './engine';
import { createReceiver } from './receive';
import {
  DEFAULT_SHARING,
  isSharingWith,
  loadSharing,
  saveSharing,
  type SharingSettings,
  useSharing,
} from './sharing';
import { stopTracking } from './tracker';

/** Circles as sending needs them, kept for a background start (no circle list in memory then). */
const CIRCLES_KEY = 'loc:circles:v1';
const sendCirclesSchema = z.array(
  z.object({
    id: z.string(),
    epoch: z.number(),
    myStatus: z.enum(MEMBER_STATUSES),
    withOthers: z.boolean(),
  }),
);

function cachedCircles(): Circle[] | undefined {
  return queryClient.getQueryData<Circle[]>(circlesKey);
}

function sendCircles(): readonly SendCircle[] {
  const cached = cachedCircles();
  const me = useAuth.getState().userId;
  if (cached !== undefined) return cached.map((circle) => toSendCircle(circle, me));
  if (!isVaultOpen()) return [];
  const raw = vault().get(CIRCLES_KEY);
  const parsed = sendCirclesSchema.safeParse(raw === undefined ? [] : JSON.parse(raw));
  return parsed.success ? parsed.data : [];
}

let sharingLoaded = false;

/** The sharing settings from the vault, once per run (the screens then change them in memory). */
export function loadSharingSettings(): SharingSettings {
  if (!sharingLoaded && isVaultOpen()) {
    useSharing.setState(loadSharing(vault()), true);
    sharingLoaded = true;
  }
  return useSharing.getState();
}

/** Below this the platform reports nonsense (emulators say -1): send "full" rather than "empty". */
async function battery() {
  const state = await Battery.getPowerStateAsync();
  return {
    level: state.batteryLevel < 0 ? 100 : state.batteryLevel * 100,
    charging:
      state.batteryState === Battery.BatteryState.CHARGING ||
      state.batteryState === Battery.BatteryState.FULL,
  };
}

/** Over the live connection when it is up (fast), else over HTTP (background, reconnecting). */
async function publish(envelopes: MessageEnvelope[]): Promise<PublishReply> {
  const viaSocket = liveRequest('publish', { envelopes });
  if (viaSocket !== null) {
    try {
      const reply = publishReplySchema.safeParse(await viaSocket);
      if (reply.success) return reply.data;
    } catch {
      // No answer in time: the HTTP path below decides.
    }
  }
  return publishReplySchema.parse(
    await api.authed('/v1/locations', { method: 'POST', body: { envelopes } }),
  );
}

async function withdraw(circleIds: string[]): Promise<void> {
  for (let start = 0; start < circleIds.length; start += MAX_CIRCLES_PER_REQUEST) {
    const body = { circleIds: circleIds.slice(start, start + MAX_CIRCLES_PER_REQUEST) };
    const viaSocket = liveRequest('withdraw', body);
    const reply: unknown = viaSocket === null ? null : await viaSocket.catch(() => null);
    if (typeof reply === 'object' && reply !== null && 'ok' in reply) continue;
    await api.authed('/v1/locations/withdraw', { method: 'POST', body });
  }
}

/** The one engine of this run: fed by the location service, open app or locked screen alike. */
export const locationEngine = createLocationEngine({
  keys,
  device: () => useAuth.getState().device,
  circles: sendCircles,
  sharing: loadSharingSettings,
  store: vault,
  battery,
  publish,
  withdraw,
  // An old epoch or a membership change the phone missed: fetch those circles again.
  outdated: (circleIds) => {
    for (const circleId of circleIds) void circleSync.refresh(circleId).catch(() => undefined);
  },
});

/** Changes one circle's sharing (or the ghost mode); takes effect at once. */
export function updateSharing(change: (current: SharingSettings) => SharingSettings): void {
  const next = change(loadSharingSettings());
  useSharing.setState(next, true);
  saveSharing(vault(), next);
  void locationEngine.changed();
}

const receiver = createReceiver({
  keys,
  circles: () => cachedCircles() ?? [],
  store: vault,
});

let restored = false;

/** The open app's start: settings and the last known locations from the vault, once per run. */
export function restoreLocations(): void {
  loadSharingSettings();
  if (restored) return;
  restored = true;
  receiver.restore();
  // Circles left while the app was closed: their members go from the map at once.
  if (cachedCircles() !== undefined) receiver.prune();
}

/** Live mode on this phone: until when someone watches (the open app adds 1-second GPS). */
export const useLiveUntil = create<{ until: number }>(() => ({ until: 0 }));

onLiveMessage((name, payload) => {
  if (name === 'loc') {
    const parsed = locEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope);
  } else if (name === 'loc.gone') {
    const parsed = locGoneEventSchema.safeParse(payload);
    if (parsed.success) receiver.gone(parsed.data.circleId, parsed.data.userId);
  } else if (name === 'watch') {
    const parsed = watchEventSchema.safeParse(payload);
    // Only a circle this phone shares with may switch it to live updates.
    if (parsed.success && isSharingWith(loadSharingSettings(), parsed.data.circleId, Date.now())) {
      void locationEngine.watched();
      useLiveUntil.setState({ until: Date.now() + LIVE_MS });
    }
  }
});

/** After every (re)connection: everyone's latest location, and what waited to be sent. */
onOnline(() => {
  void (async () => {
    try {
      const snapshot = locationSnapshotSchema.safeParse(await liveRequest('locations'));
      if (snapshot.success) receiver.receiveSnapshot(snapshot.data.envelopes);
    } catch {
      // The next connection asks again; live messages keep coming meanwhile.
    }
  })();
  void locationEngine.flush();
});

// Keys arrived or trust changed: messages that waited for them get another try.
useCircleKeys.subscribe(() => {
  receiver.retryWaiting();
});

let knownCircles = new Set<string>();
/** How the query cache names the circle list (TanStack hashes keys as JSON). */
const CIRCLES_HASH = JSON.stringify(circlesKey);

// The circle list changed (joined, left, rekeyed): keep the background copy current, drop what
// is gone from the map, and let the engine send to new circles and take back from old ones.
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== CIRCLES_HASH || event.type !== 'updated') return;
  const circles = cachedCircles();
  if (circles === undefined || !isVaultOpen()) return;
  const me = useAuth.getState().userId;
  const minimal: SendCircle[] = circles.map((circle) => toSendCircle(circle, me));
  vault().set(CIRCLES_KEY, JSON.stringify(minimal));
  const current = new Set(
    circles.filter((circle) => circle.myStatus === 'active').map((circle) => circle.id),
  );
  const joined = [...current].some((id) => !knownCircles.has(id));
  const left = [...knownCircles].some((id) => !current.has(id));
  knownCircles = current;
  receiver.prune();
  receiver.retryWaiting();
  if (joined || left) void locationEngine.changed();
});

onSignedOut(() => {
  locationEngine.reset();
  receiver.reset();
  knownCircles = new Set();
  sharingLoaded = false;
  restored = false;
  useSharing.setState(DEFAULT_SHARING, true);
  useLiveUntil.setState({ until: 0 });
  void stopTracking().catch(() => undefined);
});
