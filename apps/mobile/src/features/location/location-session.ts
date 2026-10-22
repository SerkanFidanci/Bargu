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
  safeEventSchema,
  stateEventSchema,
  stateGoneEventSchema,
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
import { circlesApi } from '../circles/circles-api';
import { memberName } from '../circles/names';
import { useCircleKeys } from '../circles/circle-sync';
import { isApiError } from '../errors';
import { receivedLook } from '../cosmetics/look-session';
import { createHistory } from '../history/history';
import { historyApi, removeAllHistory, useHistoryPings } from '../history/history-api';
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
  onCirclesGone,
  onFirstLoad,
  onLiveMessage,
  onOnline,
  onPeopleDeparted,
} from '../live/live-session';
import { loadMuteSettings } from '../notifications/mute-session';
import { isMuted } from '../notifications/mutes';
import { loadContacts } from '../notifications/push-contacts';
import { usePlaces } from '../places/places';
import { places } from '../places/places-session';
import { createPresence, placeEvent } from '../places/presence';
import { useDocs } from '../plan/docs';
import { docs } from '../plan/docs-session';
import { arrivedEvent, createMeetings, lateEvent, useArrived, useLates } from '../plan/meeting';
import { cancelAllReminders, cancelReminder, remindToLeave } from '../plan/reminders';
import {
  shareHistoryWithExtension,
  shareLiveWithExtension,
} from '../notifications/extension-share';
import { queryClient } from '../query-client';
import { publishProfile, receivedProfile, resetPhotos, restorePhotos } from '../profile/photo';
import { receivePoke } from '../social/poke';
import { receivedSafe, restoreSafe, safeCheckIns } from '../social/safe-session';
import {
  pruneStatuses,
  receivedStatus,
  resetStatuses,
  restoreStatuses,
  statusGone,
} from '../social/status';
import { isVaultOpen, vault } from '../storage/vault';
import { createLocationEngine, LIVE_MS, type SendCircle, toSendCircle, useMyFix } from './engine';
import { timed } from './probe';
import { forgetDeparted } from './forget-person';
import { createReceiver } from './receive';
import { createStateReporter } from './state-report';
import { useMyWhy } from './why';
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
  withAdultDefaults,
  withAllShared,
  withMinorSharing,
  withNothingShared,
  withoutGoneCircles,
  type SeenThere,
  seenThere,
  seersByCircle,
} from './sharing';
import {
  forgetMembers,
  knownMembers,
  newLiveViewers,
  rememberMembers,
  viewerNotices,
} from './seen-by';
import {
  anyoneSees,
  lastReview,
  reminderAt,
  reminderSummary,
  saveReview,
  useSharingReminder,
} from './sharing-reminder';
import { cancelSharingReminder, scheduleSharingReminder } from './sharing-reminder-notification';
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
    paused: z.boolean().optional(),
  }),
);

function cachedCircles(): Circle[] | undefined {
  return queryClient.getQueryData<Circle[]>(circlesKey);
}

export function sendCircles(): readonly SendCircle[] {
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

/** One `state` message: over the live connection when it is up, else over HTTP. */
async function publishState(envelope: MessageEnvelope): Promise<PublishReply> {
  const body = { envelopes: [envelope] };
  const viaSocket = liveRequest('state', body);
  if (viaSocket !== null) {
    try {
      const reply = publishReplySchema.safeParse(await viaSocket);
      if (reply.success) return reply.data;
    } catch {
      // No answer in time: the HTTP path below decides.
    }
  }
  return publishReplySchema.parse(await api.authed('/v1/states', { method: 'POST', body }));
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
  if (
    'refused' in reply &&
    (reply.refused === 'EPOCH' || reply.refused === 'NOT_MEMBER' || reply.refused === 'PAUSED')
  ) {
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

/**
 * "Geldim" (docs/ADR/0026 §5): the circle's members who are online see it on the meeting's board;
 * nobody is notified. Throws when it did not get through.
 */
export async function sayArrived(
  circle: Pick<Circle, 'id' | 'epoch'>,
  meetAt: number,
): Promise<void> {
  const device = useAuth.getState().device;
  if (device === null) throw new Error('signed out');
  const request = arrivedEvent({ circle, meetAt, keys: keys(), device, now: Date.now() });
  const reply = bumpReplySchema.parse(
    await api.authed('/v1/place-events', { method: 'POST', body: request }),
  );
  if ('refused' in reply) {
    if (reply.refused === 'EPOCH' || reply.refused === 'NOT_MEMBER') {
      void circleSync.refresh(circle.id).catch(() => undefined);
    }
    throw new Error(reply.refused);
  }
  // This phone's own word shows on its own board and chip at once (the others get the message).
  const me = useAuth.getState().userId;
  if (me !== null) useArrived.setState({ [`${circle.id}:${me}`]: { meetAt, ts: Date.now() } });
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
          circle.myStatus === 'active' &&
          circle.withOthers &&
          circle.paused !== true &&
          historyOn(settings, circle.id, now),
      )
      .map((circle) => ({ id: circle.id, epoch: circle.epoch }));
  },
  circles: () => cachedCircles() ?? [],
  store: vault,
  // Paused (docs/ADR/0024): what waited for it is dropped, as for a ghost.
  refused: (error) =>
    isApiError(error, 'VALIDATION_FAILED', 'NOT_FOUND', 'EPOCH_STALE', 'CIRCLE_PAUSED'),
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
  // The reason for an old location (docs/ADR/0028 "Neden eski?") follows what the engine sees.
  sampled: (at) => {
    stateReporter.sampled(at);
  },
  settled: () => {
    void stateReporter.changed();
  },
});

/**
 * Why this phone's location may be old, told to the circles it shares with (`state` messages, no
 * position in them) over a route of its own (docs/ADR/0028): the live connection when it is up,
 * else HTTP. The relay keeps the newest per circle, so a friend who connects later still learns
 * it. What it listens to is in state-signals.ts.
 */
export const stateReporter = createStateReporter({
  keys,
  device: () => useAuth.getState().device,
  audience: () => locationEngine.audience(),
  holding: () => isVaultOpen() && locationEngine.holding(),
  send: (envelope) => publishState(envelope),
  outdated: (circleIds) => {
    for (const circleId of circleIds) void circleSync.refresh(circleId).catch(() => undefined);
  },
  // The user's own card says what the circles are told (nothing about it is a secret from them).
  sending: (current) => {
    useMyWhy.setState({ current });
  },
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
onCirclesGone(forgetGoneCircles);

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

/**
 * Circles this phone is no longer in (left, removed, an event over): their sharing choices go, so
 * coming back starts afresh, history off (joining again is not consent, BARGU_PLAN), and what was
 * written for them goes too; their meeting reminders are taken back (QA Faz 8 W4, O5).
 */
function forgetGoneCircles(isGone: (circleId: string) => boolean): void {
  if (!isVaultOpen()) return;
  const gone = Object.keys(loadSharingSettings().circles).filter(isGone);
  if (gone.length > 0) {
    updateSharing((current) => withoutGoneCircles(current, isGone));
    for (const circleId of gone) setKnownViewers(vault(), circleId, null);
  }
  forgetMembers(vault(), isGone);
  void meetings.forget(isGone).catch(() => undefined);
}

/**
 * Someone new can see this phone's location, its history, or both ("X artık konumunu görebilir",
 * BARGU_PLAN Faz 9, docs/ADR/0019): told once, in one sentence, then known.
 */
function checkViewers(circles: readonly Circle[]): void {
  const me = useAuth.getState().userId;
  if (me === null) return;
  const settings = loadSharingSettings();
  // A ghost is seen by nobody: who comes in meanwhile is told about once it is over, not as an
  // unseen viewer now and not never (QA Faz 9 3a-B5). What was known waits until then.
  if (settings.ghost !== 'off') return;
  const audience = historyAudience(circles, settings, me);
  const live = newLiveViewers(knownMembers(vault()), circles, settings, me, Date.now());
  const history = newViewers(knownViewers(vault()), audience);
  // One notice per circle and kind, however many came in at once (QA Faz 8 G9).
  const texts = {
    live: ['location.newViewer', 'location.newViewers'],
    both: ['location.newViewerBoth', 'location.newViewersBoth'],
    history: ['history.newViewer', 'history.newViewers'],
  } as const;
  for (const { kind, circle, viewers } of viewerNotices(live, history)) {
    const [first] = viewers;
    if (first === undefined) continue;
    const [one, many] = texts[kind];
    const words = { name: memberName(first), circle: circle.name ?? '', count: viewers.length - 1 };
    tellNewViewer(i18n.t(viewers.length === 1 ? one : many, words), circle.id);
  }
  rememberViewers(vault(), audience);
  rememberMembers(vault(), circles, me);
}

/**
 * What the iOS extension words "someone new can see your location / history" from (QA G2): the
 * circles that see the live location now and those with history on. Kept current on every change,
 * when a timed share ends and when the app starts (QA B3).
 */
function shareSeenWithExtension(settings: SharingSettings): void {
  const now = Date.now();
  const ids = (pick: (seen: SeenThere) => boolean) =>
    Object.keys(settings.circles).filter((circleId) => pick(seenThere(settings, circleId, now)));
  void shareHistoryWithExtension(ids((seen) => seen.history)).catch(() => undefined);
  void shareLiveWithExtension(ids((seen) => seen.location)).catch(() => undefined);
}

/**
 * The weekly "who sees you" reminder (BARGU_PLAN Faz 9): counted from the first start, the
 * notification set for a week after the last look while anyone sees the location or its history,
 * taken back while nobody does. Set again on every change of who sees what.
 */
let reminderPlanned: number | null | undefined;
/** The ghost mode before "Tümünü durdur", to carry on as it was. */
const BEFORE_STOP_KEY = 'sharing:before-stop:v1';
function planSharingReminder(): void {
  const me = useAuth.getState().userId;
  if (me === null || !isVaultOpen()) return;
  let reviewedAt = lastReview(vault());
  if (reviewedAt === null) {
    reviewedAt = Date.now();
    saveReview(vault(), reviewedAt);
  } else if (useSharingReminder.getState().reviewedAt !== reviewedAt) {
    useSharingReminder.setState({ reviewedAt }, true);
  }
  const circles = cachedCircles();
  if (circles === undefined) return;
  const settings = loadSharingSettings();
  const now = Date.now();
  const summary = reminderSummary(
    seersByCircle(circles, settings, me, now),
    historyAudience(circles, settings, me),
    (circle) => circle.name ?? '',
  );
  const at = anyoneSees(summary) && reminderAt(reviewedAt) > now ? reminderAt(reviewedAt) : null;
  if (at === reminderPlanned) return;
  reminderPlanned = at;
  if (at === null) {
    void cancelSharingReminder().catch(() => undefined);
    return;
  }
  void scheduleSharingReminder(at, {
    title: i18n.t('location.reminder.title'),
    body: i18n.t('location.reminder.notification'),
  }).catch(() => undefined);
}

/** The user looked ("Tamam", "Düzenle"): a new week counts from now. */
export function reviewSharing(): void {
  if (!isVaultOpen()) return;
  saveReview(vault(), Date.now());
  planSharingReminder();
}

/**
 * "Tümünü durdur" (BARGU_PLAN Faz 9): one tap, the location leaves every map and nothing more is
 * sent or written (ghost "hide"; the history waiting to go is dropped, ADR 0019).
 */
export function stopSharing(): void {
  const before = loadSharingSettings().ghost;
  if (before !== 'hide') vault().set(BEFORE_STOP_KEY, before);
  updateSharing((current) => ({ ...current, ghost: 'hide' }));
}

/**
 * "Paylaşmaya devam et": back to how it was before the stop (a frozen location stays frozen, QA
 * 3a-B4); with nothing stopped by it, sharing again.
 */
export function resumeSharing(): void {
  const before = vault().get(BEFORE_STOP_KEY);
  vault().delete(BEFORE_STOP_KEY);
  const ghost = before === 'freeze' ? 'freeze' : 'off';
  updateSharing((current) => ({ ...current, ghost }));
}

/**
 * "Geçmişimi de sil": history off in every circle, the server's copies deleted ("later" when some
 * wait for a connection).
 */
export async function forgetAllHistory(): Promise<'off' | 'later'> {
  const circleIds = Object.entries(loadSharingSettings().circles)
    .filter(([, sharing]) => sharing.history === true)
    .map(([circleId]) => circleId);
  let later = false;
  for (const circleId of circleIds) {
    if ((await setHistory(circleId, false)) === 'later') later = true;
  }
  // The phone's own trail goes too, even where no circle had history on (consent withdrawn).
  history.forgetMine();
  // What an earlier install wrote, which this one does not know of (QA Faz 8 G5).
  try {
    await removeAllHistory();
  } catch {
    later = true;
  }
  return later ? 'later' : 'off';
}

/**
 * The rules of 15-17 on this phone (docs/ADR/0023): no location history (the server already
 * deleted its copy and takes none), circles joined from now on start unshared, and the speed is
 * hidden unless the user already chose ("Hızımı gösterme", ADR 0011).
 */
export async function applyMinorRules(): Promise<void> {
  // The circles already in must be known, or they would count as new and stop being shared.
  const circles =
    cachedCircles() ??
    (await queryClient.query({ queryKey: circlesKey, queryFn: () => circlesApi.list() })) ??
    [];
  const active = circles
    .filter((circle) => circle.myStatus === 'active')
    .map((circle) => circle.id);
  updateSharing((current) => withMinorSharing(current, active));
  const historyLeft = Object.values(loadSharingSettings().circles).some(
    (sharing) => sharing.history === true,
  );
  if (historyLeft) await forgetAllHistory();
}

/**
 * What an adult starts with on this phone: background live mode on (docs/ADR/0028 step 3). Done
 * once, when the age band is known; a teen's phone has its own default (applyMinorRules).
 */
export function applyAdultDefaults(): void {
  if (loadSharingSettings().backgroundLiveDefault !== undefined) return;
  updateSharing(withAdultDefaults);
}

/** Changes one circle's sharing (or the ghost mode); takes effect at once. */
export function updateSharing(change: (current: SharingSettings) => SharingSettings): void {
  // Before the change too: a timed share already over is not "still shared" because it is renewed.
  history.sharingChanged();
  const before = loadSharingSettings();
  const next = change(before);
  useSharing.setState(next, true);
  saveSharing(vault(), next);
  history.sharingChanged();
  watchSharingEnd();
  shareSeenWithExtension(next);
  planSharingReminder();
  // Back from a ghost: whoever came in meanwhile can see this phone now and is told about.
  if (before.ghost !== 'off' && next.ghost === 'off') checkViewers(cachedCircles() ?? []);
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
      shareSeenWithExtension(loadSharingSettings());
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
  // What a member wears on their pin: checked against the server's pass (docs/ADR/0025).
  onLook: (userId, look) => {
    receivedLook(userId, look);
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
  // Someone says they are at the meeting: on the board (no line, no notification).
  onArrived: (circleId, userId, arrived) => {
    if (Date.now() - arrived.ts > PLACE_EVENT_FRESH_MS) return;
    useArrived.setState({ [`${circleId}:${userId}`]: arrived });
  },
  // Someone says they are safe: a line with who and the battery, once (docs/ADR/0029).
  onSafe: receivedSafe,
  onBump: (circleId, userId, ts) => {
    const name = receivePoke(circleId, userId, ts);
    if (name === null || isMuted(loadMuteSettings(), { kind: 'bump' }, userId)) return;
    feedback('bump');
    toast.info(i18n.t('map.poke.received', { name }));
  },
});

// The last circle shared with a person went (circle-sync): everything local about them is deleted
// in one place, except the record that notices a changed key (forget-person.ts).
onPeopleDeparted(forgetDeparted({ receiver, keys, store: vault }));

let restored = false;

/** The open app's start: settings and the last known locations from the vault, once per run. */
export function restoreLocations(): void {
  timed('start.restore', restoreNow);
}

function restoreNow(): void {
  loadSharingSettings();
  // What sharing stopped for while the app was closed (a timed share over) goes before anything.
  if (isVaultOpen()) {
    history.sharingChanged();
    planSharingReminder();
    shareSeenWithExtension(loadSharingSettings());
    watchSharingEnd();
    restoreSafe();
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
  timed('live.message', () => {
    handleLive(name, payload);
  });
});

/**
 * What each live event may carry. The relay forwards any message through the poke, "Güvendeyim" and
 * place routes (it cannot read them), and those skip the paused-circle check and the limits of the
 * location route: so a message counts only as the kind its route is for (receive.ts Route).
 */
function handleLive(name: string, payload: unknown): void {
  if (name === 'loc') {
    const parsed = locEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'loc');
  } else if (name === 'loc.gone') {
    const parsed = locGoneEventSchema.safeParse(payload);
    if (parsed.success) receiver.gone(parsed.data.circleId, parsed.data.userId);
  } else if (name === 'profile') {
    const parsed = statusEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'profile');
  } else if (name === 'look') {
    const parsed = statusEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'look');
  } else if (name === 'state') {
    // Why a member's location is old: only as a `state`, and a `state` only by this route.
    const parsed = stateEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'state');
  } else if (name === 'state.gone') {
    const parsed = stateGoneEventSchema.safeParse(payload);
    if (parsed.success) receiver.stateGone(parsed.data.circleId, parsed.data.userId);
  } else if (name === 'status') {
    const parsed = statusEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'status');
  } else if (name === 'status.gone') {
    const parsed = statusGoneEventSchema.safeParse(payload);
    if (parsed.success) statusGone(parsed.data.circleId, parsed.data.userId);
  } else if (name === 'bump') {
    const parsed = bumpEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'bump');
  } else if (name === 'safe') {
    const parsed = safeEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'safe');
  } else if (name === 'place') {
    const parsed = placeEventSchema.safeParse(payload);
    if (parsed.success) receiver.receive(parsed.data.envelope, 'place');
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
}

/** After every (re)connection: everyone's latest location, and what waited to be sent. */
onOnline(() => {
  void (async () => {
    try {
      // Opened a few at a time with a moment between (receive.ts SLICE), and not at all when this
      // phone has opened them before: the app opening or the connection returning is no moment
      // to hold the screen for dozens of signature checks.
      const snapshot = locationSnapshotSchema.safeParse(await liveRequest('locations'));
      if (snapshot.success) await receiver.receiveSnapshot(snapshot.data.envelopes);
      const statuses = statusSnapshotSchema.safeParse(await liveRequest('statuses'));
      if (statuses.success) await receiver.receiveAll(statuses.data.envelopes, 'status');
      const profiles = statusSnapshotSchema.safeParse(await liveRequest('profiles'));
      if (profiles.success) await receiver.receiveAll(profiles.data.envelopes, 'profile');
      const looks = statusSnapshotSchema.safeParse(await liveRequest('looks'));
      if (looks.success) await receiver.receiveAll(looks.data.envelopes, 'look');
      const states = statusSnapshotSchema.safeParse(await liveRequest('states'));
      if (states.success) await receiver.receiveAll(states.data.envelopes, 'state');
    } catch {
      // The next connection asks again; live messages keep coming meanwhile.
    }
  })();
  void locationEngine.flush();
  void stateReporter.flush();
  void history.flush().catch(() => undefined);
  // A "Güvendeyim" that waited for the connection goes now, once (docs/ADR/0029).
  void safeCheckIns.flush().catch(() => undefined);
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
  planSharingReminder();
  // New circles and new epochs get the photo key (members who joined could not read the old one).
  void publishProfile().catch(() => undefined);
  receiver.retryWaiting();
  if (joined || left) void locationEngine.changed();
});

onSignedOut(() => {
  if (sharingEndTimer !== null) clearTimeout(sharingEndTimer);
  sharingEndTimer = null;
  void cancelAllReminders().catch(() => undefined);
  void cancelSharingReminder().catch(() => undefined);
  reminderPlanned = undefined;
  useSharingReminder.setState({ reviewedAt: null }, true);
  locationEngine.reset();
  stateReporter.reset();
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
