import {
  bumpEventSchema,
  bumpReplySchema,
  type Circle,
  CIRCLE_KINDS,
  locationSnapshotSchema,
  locEventSchema,
  locGoneEventSchema,
  MAX_CIRCLES_PER_REQUEST,
  historyEventSchema,
  MEMBER_STATUSES,
  type MessageEnvelope,
  placeEventSchema,
  type PublishReply,
  publishReplySchema,
  statusEventSchema,
  statusGoneEventSchema,
  statusSnapshotSchema,
  watchEventSchema,
} from '@bargu/schemas';
import * as Battery from 'expo-battery';
import { z } from 'zod';
import { create } from 'zustand';

import i18n from '@/i18n';
import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { api, onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { memberName } from '../circles/names';
import { useCircleKeys } from '../circles/circle-sync';
import { isApiError } from '../errors';
import { createHistory } from '../history/history';
import { historyApi, useHistoryPings } from '../history/history-api';
import { tellNewViewer } from '../history/viewer-notice';
import {
  historyAudience,
  knownViewers,
  newViewers,
  rememberViewers,
  setKnownViewers,
} from '../history/viewers';
import {
  circleSync,
  keys,
  liveRequest,
  onFirstLoad,
  onLiveMessage,
  onOnline,
} from '../live/live-session';
import { loadMuteSettings } from '../notifications/mute-session';
import { isMuted } from '../notifications/mutes';
import { loadContacts } from '../notifications/push-contacts';
import { usePlaces } from '../places/places';
import { places } from '../places/places-session';
import { createPresence, placeEvent } from '../places/presence';
import { useDocs } from '../plan/docs';
import { docs } from '../plan/docs-session';
import { createMeetings, lateEvent, useLates } from '../plan/meeting';
import { cancelReminder, remindToLeave } from '../plan/reminders';
import { queryClient } from '../query-client';
import { publishProfile, receivedProfile, resetPhotos, restorePhotos } from '../profile/photo';
import { receivePoke } from '../social/poke';
import {
  pruneStatuses,
  receivedStatus,
  resetStatuses,
  restoreStatuses,
  statusGone,
} from '../social/status';
import { isVaultOpen, vault } from '../storage/vault';
import { createLocationEngine, LIVE_MS, type SendCircle, toSendCircle, useMyFix } from './engine';
import { createReceiver } from './receive';
import {
  circleSharing,
  DEFAULT_SHARING,
  historyOn,
  isSharingWith,
  loadSharing,
  saveSharing,
  SHARING_REVIEW_KEY,
  type SharingSettings,
  useSharing,
  useSharingReview,
  withAllShared,
  withNothingShared,
} from './sharing';
import { stopTracking } from './tracker';

/** Circles as sending needs them, kept for a background start (no circle list in memory then). */
const CIRCLES_KEY = 'loc:circles:v1';
const sendCirclesSchema = z.array(
  z.object({
    id: z.string(),
    epoch: z.number(),
    kind: z.enum(CIRCLE_KINDS).optional(),
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

/**
 * Tells a circle this phone arrived at or left one of its places: the encrypted message, and a
 * notification sealed for each trusted member's device (members online get the message at once).
 */
async function announce(
  circle: Pick<Circle, 'id' | 'epoch'>,
  place: Parameters<typeof placeEvent>[0]['place'],
  event: 'enter' | 'exit',
): Promise<void> {
  const device = useAuth.getState().device;
  if (device === null) return;
  const request = placeEvent({
    circle,
    place,
    event,
    keys: keys(),
    device,
    recipients: loadContacts(vault()).recipients[circle.id] ?? [],
    now: Date.now(),
  });
  const reply = bumpReplySchema.parse(
    await api.authed('/v1/place-events', { method: 'POST', body: request }),
  );
  if ('refused' in reply && (reply.refused === 'EPOCH' || reply.refused === 'NOT_MEMBER')) {
    void circleSync.refresh(circle.id).catch(() => undefined);
  }
}

/** Arrivals and departures, noticed on this phone from its own positions (docs/ADR/0015). */
const presence = createPresence({
  places: () => {
    places.restore();
    return Object.values(usePlaces.getState());
  },
  circles: sendCircles,
  sharing: loadSharingSettings,
  store: vault,
  announce,
});

/** "I will be late" to an event's meeting: the message, and sealed notifications for the others. */
async function sendLate(
  circle: Pick<Circle, 'id' | 'epoch'>,
  meetAt: number,
  minutes: number,
): Promise<void> {
  const device = useAuth.getState().device;
  if (device === null) throw new Error('signed out');
  const request = lateEvent({
    circle,
    meetAt,
    minutes,
    keys: keys(),
    device,
    recipients: loadContacts(vault()).recipients[circle.id] ?? [],
    now: Date.now(),
  });
  const reply = bumpReplySchema.parse(
    await api.authed('/v1/place-events', { method: 'POST', body: request }),
  );
  if ('refused' in reply) {
    if (reply.refused === 'EPOCH' || reply.refused === 'NOT_MEMBER') {
      void circleSync.refresh(circle.id).catch(() => undefined);
    }
    throw new Error(reply.refused);
  }
}

/** The meetings of events (docs/ADR/0018): estimates, "will be late", reminders to leave. */
export const meetings = createMeetings({
  circles: sendCircles,
  docs: () => {
    docs.restore();
    return useDocs.getState();
  },
  places: () => {
    places.restore();
    return usePlaces.getState();
  },
  sharing: loadSharingSettings,
  store: vault,
  sendLate,
  remind: remindToLeave,
  cancel: cancelReminder,
  words: (meeting, minutes) => ({
    title: `${meeting.place.emoji} ${meeting.place.name} · ${new Date(meeting.meetAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}`,
    body: i18n.t('plan.leaveIn', { minutes }),
  }),
});

/** Location history (docs/ADR/0019): written down here, a quarter hour per circle at a time. */
export const history = createHistory({
  api: historyApi,
  keys,
  device: () => useAuth.getState().device,
  userId: () => useAuth.getState().userId,
  recording: (now) => {
    const settings = loadSharingSettings();
    return sendCircles()
      .filter(
        (circle) =>
          circle.myStatus === 'active' && circle.withOthers && historyOn(settings, circle.id, now),
      )
      .map((circle) => ({ id: circle.id, epoch: circle.epoch }));
  },
  circles: () => cachedCircles() ?? [],
  store: vault,
  refused: (error) => isApiError(error, 'VALIDATION_FAILED', 'NOT_FOUND', 'EPOCH_STALE'),
});

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
  onFix: async (fix) => {
    // Meetings first: they note this position at once, before the location goes out with it.
    const meeting = meetings.fix(fix).catch(() => undefined);
    const trail = history.fix(fix).catch(() => undefined);
    await presence.fix(fix);
    await Promise.all([meeting, trail]);
  },
  eta: (circleId, fix, now) => meetings.eta(circleId, fix, now),
});

// A meeting was set or changed: the reminder to leave follows at once (from the last position).
let planTimer: ReturnType<typeof setTimeout> | null = null;
useDocs.subscribe(() => {
  if (planTimer !== null) return;
  planTimer = setTimeout(() => {
    planTimer = null;
    const { fix } = useMyFix.getState();
    if (fix !== null && isVaultOpen()) void meetings.fix(fix).catch(() => undefined);
  }, 1_000);
});

/** An arrival or departure older than this when it arrives (it waited for a key) is not shown. */
const PLACE_EVENT_FRESH_MS = 10 * 60_000;

// A reinstall or a new phone: earlier choices stayed on the old phone, so nothing is shared with
// the circles the account is already in until the user chooses (before anything is sent).
onFirstLoad((circles) => {
  const active = circles.filter((circle) => circle.myStatus === 'active').map((c) => c.id);
  updateSharing((current) => withNothingShared(current, active));
  vault().set(SHARING_REVIEW_KEY, '1');
  useSharingReview.setState({ pending: true });
});

/** The user chose after a reinstall: all circles get the location again, or they pick each. */
export function finishSharingReview(shareAll: boolean): void {
  if (shareAll) {
    const active = (cachedCircles() ?? [])
      .filter((circle) => circle.myStatus === 'active')
      .map((circle) => circle.id);
    updateSharing((current) => withAllShared(current, active));
  }
  if (isVaultOpen()) vault().delete(SHARING_REVIEW_KEY);
  useSharingReview.setState({ pending: false });
}

/**
 * Location history on or off for a circle (docs/ADR/0019). On: written down from now, while the
 * exact location goes there. Off, one tap: nothing more is written, and what the circle holds on the
 * server is deleted ('later' when offline: it goes once connected).
 */
export async function setHistory(circleId: string, on: boolean): Promise<'on' | 'off' | 'later'> {
  updateSharing((current) => ({
    ...current,
    circles: {
      ...current.circles,
      [circleId]: { ...circleSharing(current, circleId), history: on },
    },
  }));
  const me = useAuth.getState().userId;
  const audience =
    me === null ? [] : historyAudience(cachedCircles() ?? [], loadSharingSettings(), me);
  const viewers = audience.find((entry) => entry.circle.id === circleId)?.viewers ?? [];
  setKnownViewers(vault(), circleId, on ? viewers.map((viewer) => viewer.userId) : null);
  if (on) return 'on';
  return (await history.forget(circleId)) ? 'off' : 'later';
}

/** Someone new can see the history ("artık X de geçmişini görebilir"): told once, then known. */
function checkViewers(circles: readonly Circle[]): void {
  const me = useAuth.getState().userId;
  if (me === null) return;
  const audience = historyAudience(circles, loadSharingSettings(), me);
  for (const { circle, viewer } of newViewers(knownViewers(vault()), audience)) {
    tellNewViewer(
      i18n.t('history.newViewer', { name: memberName(viewer), circle: circle.name ?? '' }),
      circle.id,
    );
  }
  rememberViewers(vault(), audience);
}

/** Changes one circle's sharing (or the ghost mode); takes effect at once. */
export function updateSharing(change: (current: SharingSettings) => SharingSettings): void {
  // Before the change too: a timed share already over is not "still shared" because it is renewed.
  history.sharingChanged();
  const next = change(loadSharingSettings());
  useSharing.setState(next, true);
  saveSharing(vault(), next);
  history.sharingChanged();
  watchSharingEnd();
  void locationEngine.changed();
}

/**
 * When a timed share runs out, the history written for that circle goes at once (docs/ADR/0019:
 * nothing written while shared goes up once it is not), even with no position coming in.
 */
let sharingEndTimer: ReturnType<typeof setTimeout> | null = null;
function watchSharingEnd(): void {
  if (sharingEndTimer !== null) clearTimeout(sharingEndTimer);
  sharingEndTimer = null;
  const now = Date.now();
  const ends = Object.values(loadSharingSettings().circles)
    .map((sharing) => sharing.until)
    .filter((until): until is number => until !== null && until > now);
  if (ends.length === 0) return;
  sharingEndTimer = setTimeout(
    () => {
      sharingEndTimer = null;
      if (!isVaultOpen()) return;
      history.sharingChanged();
      watchSharingEnd();
    },
    Math.min(Math.min(...ends) - now + 500, 2 ** 31 - 1),
  );
}

const receiver = createReceiver({
  keys,
  circles: () => cachedCircles() ?? [],
  store: vault,
  // A poke: a buzz, their avatar bounces, and a line saying who it was.
  onStatus: receivedStatus,
  onProfile: (userId, profile, senderDeviceId) => {
    void receivedProfile(userId, profile, senderDeviceId).catch(() => undefined);
  },
  // Someone arrived at or left a place: a line saying who and where, unless muted.
  onPlace: (circleId, userId, event) => {
    if (Date.now() - event.ts > PLACE_EVENT_FRESH_MS) return;
    const place = usePlaces.getState()[event.placeId];
    const member = cachedCircles()
      ?.find((circle) => circle.id === circleId)
      ?.members.find((candidate) => candidate.userId === userId);
    if (place === undefined || member === undefined) return;
    if (isMuted(loadMuteSettings(), { kind: 'place', placeId: place.id }, userId)) return;
    const values = { name: memberName(member), place: `${place.emoji} ${place.name}` };
    toast.info(
      event.kind === 'place_enter'
        ? i18n.t('places.arrivedToast', values)
        : i18n.t('places.leftToast', values),
    );
  },
  // Someone will be late to an event's meeting: on the board, and a line unless muted.
  onLate: (circleId, userId, late) => {
    if (Date.now() - late.ts > PLACE_EVENT_FRESH_MS) return;
    useLates.setState({ [`${circleId}:${userId}`]: late });
    const member = cachedCircles()
      ?.find((circle) => circle.id === circleId)
      ?.members.find((candidate) => candidate.userId === userId);
    if (member === undefined || isMuted(loadMuteSettings(), { kind: 'late' }, userId)) return;
    toast.info(i18n.t('notifications.late', { name: memberName(member), minutes: late.minutes }));
  },
  onBump: (circleId, userId, ts) => {
    const name = receivePoke(circleId, userId, ts);
    if (name === null || isMuted(loadMuteSettings(), { kind: 'bump' }, userId)) return;
    feedback('bump');
    toast.info(i18n.t('map.poke.received', { name }));
  },
});

let restored = false;

/** The open app's start: settings and the last known locations from the vault, once per run. */
export function restoreLocations(): void {
  loadSharingSettings();
  // What sharing stopped for while the app was closed (a timed share over) goes before anything.
  if (isVaultOpen()) {
    history.sharingChanged();
    watchSharingEnd();
  }
  if (isVaultOpen() && vault().get(SHARING_REVIEW_KEY) === '1') {
    useSharingReview.setState({ pending: true });
  }
  if (restored) return;
  restored = true;
  receiver.restore();
  restoreStatuses();
  restorePhotos();
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
  } else if (name === 'profile') {
    const parsed = statusEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope);
  } else if (name === 'status') {
    const parsed = statusEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope);
  } else if (name === 'status.gone') {
    const parsed = statusGoneEventSchema.safeParse(payload);
    if (parsed.success) statusGone(parsed.data.circleId, parsed.data.userId);
  } else if (name === 'bump') {
    const parsed = bumpEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope);
  } else if (name === 'place') {
    const parsed = placeEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope);
  } else if (name === 'history') {
    // Someone's new quarter hour is up: an open history screen of theirs fetches again.
    const parsed = historyEventSchema.safeParse(payload);
    if (parsed.success) {
      const key = `${parsed.data.circleId}:${parsed.data.userId}`;
      useHistoryPings.setState((pings) => ({ [key]: (pings[key] ?? 0) + 1 }));
    }
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
      const statuses = statusSnapshotSchema.safeParse(await liveRequest('statuses'));
      if (statuses.success)
        for (const envelope of statuses.data.envelopes) receiver.receive(envelope);
      const profiles = statusSnapshotSchema.safeParse(await liveRequest('profiles'));
      if (profiles.success)
        for (const envelope of profiles.data.envelopes) receiver.receive(envelope);
    } catch {
      // The next connection asks again; live messages keep coming meanwhile.
    }
  })();
  void locationEngine.flush();
  void history.flush().catch(() => undefined);
});

// Keys arrived or trust changed: messages that waited for them get another try.
useCircleKeys.subscribe(() => {
  receiver.retryWaiting();
  // A member's new phone just became trusted: their photo key may be due back to them.
  if (isVaultOpen()) void publishProfile().catch(() => undefined);
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
  pruneStatuses(circles);
  checkViewers(circles);
  // New circles and new epochs get the photo key (members who joined could not read the old one).
  void publishProfile().catch(() => undefined);
  receiver.retryWaiting();
  if (joined || left) void locationEngine.changed();
});

onSignedOut(() => {
  if (sharingEndTimer !== null) clearTimeout(sharingEndTimer);
  sharingEndTimer = null;
  locationEngine.reset();
  meetings.reset();
  history.reset();
  useHistoryPings.setState({}, true);
  receiver.reset();
  resetStatuses();
  resetPhotos();
  knownCircles = new Set();
  sharingLoaded = false;
  restored = false;
  useSharing.setState(DEFAULT_SHARING, true);
  useSharingReview.setState({ pending: false });
  useLiveUntil.setState({ until: 0 });
  void stopTracking().catch(() => undefined);
});
