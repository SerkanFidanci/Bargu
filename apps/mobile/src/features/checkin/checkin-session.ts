import { type DevicePublicKeys, openDirect, randomUuid, sealDirect } from '@bargu/crypto';
import {
  type ChatPayload,
  type CheckinBox,
  type CheckinRefusal,
  type CheckinReply,
  type Circle,
  type ServerEvent,
} from '@bargu/schemas';
import * as Battery from 'expo-battery';
import { AppState } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { memberName } from '../circles/names';
import { verifiedBundle } from '../keys/bundle-cache';
import { keys, onOnline, onServerEvents } from '../live/live-session';
import { useMyFix } from '../location/engine';
import { clockOf } from '../location/person-share';
import type { Fix } from '../location/send';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { checkinApi } from './checkin-api';
import { cancelAllDue, cancelDue, hideOpenNotice, scheduleDue } from './checkin-reminders';
import {
  alertOf,
  type CheckPlace,
  type CheckPlan,
  dayIdOf,
  EXTEND_MS,
  type Grace,
  hasArrived,
  nextDue,
  openAtOf,
  type OwnCheck,
  type ReceivedAlert,
  receivedOf,
  refreshDue,
  strayChecks,
} from './checkin-model';

/**
 * "Eve vardım kontrolü" on this phone (docs/ADR/0039). The owner's side: checks and repeated plans,
 * kept in the vault; each set as one sealed alert per recipient's device (sealDirect: signed by this
 * device, sealed to theirs), refreshed with the newest location on the way, cancelled on arrival
 * (or "İyiyim") and, if that cannot reach the server, queued and tried again; an alert that went
 * meanwhile is followed by "Vardı, haber geç ulaştı". The recipient's side: alerts handed over,
 * fetched and opened here only. Nothing of where the person is going leaves the phone but its name
 * inside the sealed alert.
 */

const OWN_KEY = 'checkin:own:v1';
const ALERTS_KEY = 'checkin:alerts:v1';

export interface OwnState {
  checks: OwnCheck[];
  plans: CheckPlan[];
  /** Cancellations the server has yet to take (offline), with whether to say "late". */
  pending: { checkinId: string; recipients: string[] }[];
  /**
   * One-time checks sent whose answer never came (QA-44 Orta 3), kept until their time: if the
   * server took one after all (or a late copy of the request lands), the next sync cancels it.
   */
  unsure: { id: string; openAt: number }[];
}
const EMPTY_OWN: OwnState = { checks: [], plans: [], pending: [], unsure: [] };

/** Ids being set right now: never taken for strays. */
const sending = new Set<string>();

export interface AlertsState {
  alerts: ReceivedAlert[];
  /** Alerts this phone could not open (keys it does not have): said so, and who to reach. */
  unreadable: { checkinId: string; ownerId: string; firedAt: number }[];
  /** Checks whose owner said "Vardı": an alert of theirs that still comes is not news. */
  arrived: string[];
}
const EMPTY_ALERTS: AlertsState = { alerts: [], unreadable: [], arrived: [] };

export const useOwnChecks = create<OwnState>(() => EMPTY_OWN);
export const useAlerts = create<AlertsState>(() => EMPTY_ALERTS);

// ---- keeping the vault in step ---------------------------------------------------------------

let loaded = false;
function load(): void {
  if (loaded || !isVaultOpen()) return;
  loaded = true;
  const read = (key: string) => {
    try {
      const raw = vault().get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  };
  const own = read(OWN_KEY);
  if (typeof own === 'object' && own !== null) useOwnChecks.setState({ ...EMPTY_OWN, ...own });
  const alerts = read(ALERTS_KEY);
  if (typeof alerts === 'object' && alerts !== null) {
    useAlerts.setState({ ...EMPTY_ALERTS, ...alerts });
  }
}
useOwnChecks.subscribe((state) => {
  if (loaded && isVaultOpen()) vault().set(OWN_KEY, JSON.stringify(state));
});
useAlerts.subscribe((state) => {
  if (loaded && isVaultOpen()) vault().set(ALERTS_KEY, JSON.stringify(state));
});

/** The checks this phone owns, read from the vault first. */
export function ownChecks(): OwnState {
  load();
  return useOwnChecks.getState();
}

function update(check: OwnCheck): void {
  useOwnChecks.setState((state) => ({
    ...state,
    checks: state.checks.map((each) => (each.id === check.id ? check : each)),
  }));
}

// ---- keys -----------------------------------------------------------------------------------

const cachedCircles = () => queryClient.getQueryData<Circle[]>(circlesKey) ?? [];

/** A person's current device as this phone trusts it, from any circle shared with them. */
function deviceOf(userId: string): DevicePublicKeys | null {
  const store = keys();
  for (const circle of cachedCircles()) {
    const member = circle.members.find((candidate) => candidate.userId === userId);
    if (member?.device === undefined || member.device === null || !store.trusted(member)) continue;
    try {
      return verifiedBundle(member.device.bundle);
    } catch {
      return null;
    }
  }
  return null;
}

/** A person's name as this phone knows them. */
export function nameOf(userId: string): string {
  for (const circle of cachedCircles()) {
    const member = circle.members.find((candidate) => candidate.userId === userId);
    if (member !== undefined) return memberName(member);
  }
  return '?';
}

async function battery(): Promise<{ level: number; charging: boolean } | null> {
  try {
    const state = await Battery.getPowerStateAsync();
    // A level the phone cannot read is not sent as a number (the sealed alert would be refused).
    if (!Number.isFinite(state.batteryLevel)) return null;
    return {
      level: state.batteryLevel < 0 ? 100 : state.batteryLevel * 100,
      charging:
        state.batteryState === Battery.BatteryState.CHARGING ||
        state.batteryState === Battery.BatteryState.FULL,
    };
  } catch {
    return null;
  }
}

/** Each recipient's box of the check as it is now; null when a recipient's keys are missing. */
async function boxesOf(check: OwnCheck, now: number): Promise<CheckinBox[] | null> {
  const device = useAuth.getState().device;
  if (device === null) return null;
  const payload: ChatPayload = alertOf(check, useMyFix.getState().fix, await battery(), now);
  const boxes: CheckinBox[] = [];
  for (const recipientId of check.recipients) {
    const recipient = deviceOf(recipientId);
    if (recipient === null) return null;
    boxes.push({ recipientId, box: sealDirect({ sender: device, recipient, payload }) });
  }
  return boxes;
}

// ---- the owner's side -----------------------------------------------------------------------

export type CheckinResult = 'ok' | CheckinRefusal | 'failed';

/**
 * The lines to recipients go through the messages' outbox, loaded only when one is sent: the
 * location service loads this module, and the outbox brings the photo tools with it.
 */
type Line = Parameters<Awaited<typeof import('../messages/outbox')>['sendCheckinLine']>[1];
function tellLine(userId: string, line: Line): void {
  void import('../messages/outbox')
    .then((outbox) => outbox.sendCheckinLine(userId, line))
    .catch(() => undefined);
}

async function remind(check: OwnCheck): Promise<void> {
  const place =
    check.place === null ? i18n.t('checkin.title') : `${check.place.emoji} ${check.place.name}`;
  await scheduleDue(check.id, check.due, {
    title: i18n.t('checkin.dueTitle', { place }),
    body: i18n.t('checkin.dueBody', { minutes: check.grace }),
  }).catch(() => undefined);
}

export interface NewCheck {
  due: number;
  grace: Grace;
  place: CheckPlace | null;
  recipients: string[];
  note?: string;
  planId?: string;
  /** A plan's id for its day (made once, kept on the plan); a one-time check gets a new one. */
  id?: string;
}

/** Waits before asking again, with the same id, when an answer does not come (QA-44 Orta 3). */
const RETRY_MS = [1_000, 3_000] as const;

/** The server sets the check; asked again with the same id on a lost answer (it says 'ok' twice). */
async function created(id: string, openAt: number, boxes: CheckinBox[]): Promise<CheckinReply> {
  let lost: unknown;
  for (const wait of [0, ...RETRY_MS]) {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await checkinApi.create(id, openAt, boxes);
    } catch (error) {
      lost = error;
    }
  }
  throw lost;
}

function dropUnsure(id: string): void {
  useOwnChecks.setState((state) => ({
    ...state,
    unsure: state.unsure.filter((each) => each.id !== id),
  }));
}

/** Sets a check: its sealed alerts go to the server, "İyi misin?" is set for its time. */
export async function startCheck(input: NewCheck, tell = true): Promise<CheckinResult> {
  load();
  const now = Date.now();
  const check: OwnCheck = {
    id: input.id ?? randomUuid(),
    due: input.due,
    grace: input.grace,
    place: input.place,
    recipients: input.recipients,
    ...(input.note === undefined ? {} : { note: input.note }),
    seq: 0,
    createdAt: now,
    extends: 0,
    sentAt: now,
    state: 'armed',
    ...(input.planId === undefined ? {} : { planId: input.planId }),
  };
  const openAt = openAtOf(check.due, check.grace);
  // Kept before it is sent (a plan keeps its day's id itself): an answer that never comes leaves
  // nothing on the server this phone does not know of (QA-44 Orta 3).
  const oneTime = input.planId === undefined;
  if (oneTime) {
    useOwnChecks.setState((state) => ({
      ...state,
      unsure: [...state.unsure, { id: check.id, openAt }],
    }));
  }
  sending.add(check.id);
  try {
    const boxes = await boxesOf(check, now);
    if (boxes === null) {
      dropUnsure(check.id);
      return 'RECIPIENT';
    }
    const reply = await created(check.id, openAt, boxes);
    if ('refused' in reply) {
      dropUnsure(check.id);
      return reply.refused;
    }
  } catch {
    // Still unsure: the next sync cancels it if the server took it after all.
    syncLater();
    return 'failed';
  } finally {
    sending.delete(check.id);
  }
  useOwnChecks.setState((state) => ({
    ...state,
    checks: state.checks.some((each) => each.id === check.id)
      ? state.checks
      : [...state.checks, check],
    unsure: state.unsure.filter((each) => each.id !== check.id),
  }));
  await remind(check);
  // A one-time check is told as it is set; a repeated one only when its plan is (the PM, 3).
  if (tell) {
    for (const userId of check.recipients) {
      tellLine(userId, { kind: 'checkinSet', checkinId: check.id, due: check.due });
    }
  }
  return 'ok';
}

/** A repeated check: the plan stays here; its first day's check is set at once if it can be. */
export async function startPlan(
  plan: Omit<CheckPlan, 'id' | 'lastDue' | 'skip'>,
): Promise<CheckinResult> {
  load();
  const saved: CheckPlan = { ...plan, id: randomUuid(), lastDue: null, skip: [] };
  useOwnChecks.setState((state) => ({ ...state, plans: [...state.plans, saved] }));
  for (const userId of plan.recipients) {
    tellLine(userId, {
      kind: 'checkinSet',
      checkinId: null,
      due: null,
      plan: { days: plan.days, at: plan.at },
    });
  }
  await planTick();
  return 'ok';
}

export function stopPlan(planId: string): void {
  useOwnChecks.setState((state) => ({
    ...state,
    plans: state.plans.filter((plan) => plan.id !== planId),
  }));
}

/** "Bugün atla": the plan's next check is not set (or is cancelled if it was). */
export async function skipNext(planId: string): Promise<void> {
  const plan = useOwnChecks.getState().plans.find((each) => each.id === planId);
  if (plan === undefined) return;
  const set = useOwnChecks
    .getState()
    .checks.find((check) => check.planId === planId && check.state === 'armed');
  const due = set?.due ?? nextDue(plan, Date.now());
  if (due === null) return;
  useOwnChecks.setState((state) => ({
    ...state,
    plans: state.plans.map((each) =>
      each.id === planId ? { ...each, skip: [...each.skip, due] } : each,
    ),
  }));
  if (set !== undefined) await settle(set, 'skipped');
}

function setPlan(planId: string, change: Partial<CheckPlan>): void {
  useOwnChecks.setState((state) => ({
    ...state,
    plans: state.plans.map((each) => (each.id === planId ? { ...each, ...change } : each)),
  }));
}

let ticking: Promise<void> | null = null;

/**
 * Each plan's next check, set ahead when its time is within reach (docs/ADR/0039 §2). The day's
 * id is made once and kept on the plan before it is sent, so every try that day asks with it
 * (QA-44 Orta 3). One round at a time.
 */
export function planTick(now = Date.now()): Promise<void> {
  // Cleared once the round is over, never before it is taken (a round with no plan ends at once).
  ticking ??= tickPlans(now).finally(() => {
    ticking = null;
  });
  return ticking;
}

async function tickPlans(now: number): Promise<void> {
  load();
  for (const plan of useOwnChecks.getState().plans) {
    const due = nextDue(plan, now);
    if (due === null) continue;
    const id = dayIdOf(plan, due, randomUuid);
    if (plan.day?.id !== id) setPlan(plan.id, { day: { due, id } });
    const result = await startCheck(
      {
        due,
        grace: plan.grace,
        place: plan.place,
        recipients: plan.recipients,
        ...(plan.note === undefined ? {} : { note: plan.note }),
        planId: plan.id,
        id,
      },
      false,
    );
    if (result === 'ok') setPlan(plan.id, { lastDue: due });
  }
}

/**
 * Ends a check well: arrived, "İyiyim", or a repeated day skipped. If it has not fired it is gone
 * from the server for good; if it had, its recipients are told "Vardı, haber geç ulaştı". Offline,
 * the cancellation waits and is tried again (the PM's second condition).
 */
async function settle(check: OwnCheck, how: 'arrived' | 'ok' | 'skipped'): Promise<CheckinResult> {
  update({ ...check, state: 'done' });
  void cancelDue(check.id).catch(() => undefined);
  if (!wantsLocation()) void hideOpenNotice().catch(() => undefined);
  let late = check.state === 'fired';
  try {
    const reply = await checkinApi.cancel(check.id);
    if ('refused' in reply && reply.refused === 'FIRED') late = true;
  } catch {
    useOwnChecks.setState((state) => ({
      ...state,
      pending: [...state.pending, { checkinId: check.id, recipients: check.recipients }],
    }));
    return 'failed';
  }
  if (how !== 'skipped' || late) {
    for (const userId of check.recipients) {
      tellLine(userId, { kind: 'checkinOk', checkinId: check.id, late });
    }
  }
  return 'ok';
}

/** "Vardım" / "İyiyim" by hand, before or after the alert went. */
export function imOk(checkinId: string): Promise<CheckinResult> {
  const check = ownChecks().checks.find((each) => each.id === checkinId && each.state !== 'done');
  return check === undefined ? Promise.resolve('ok') : settle(check, 'ok');
}

/** "15 dk uzat": the due time moves, the alerts are sealed again for it. Only the owner can. */
export async function extendCheck(checkinId: string): Promise<CheckinResult> {
  const check = ownChecks().checks.find((each) => each.id === checkinId && each.state === 'armed');
  if (check === undefined) return 'NOT_FOUND';
  const now = Date.now();
  const next: OwnCheck = {
    ...check,
    due: Math.max(check.due, now) + EXTEND_MS,
    seq: check.seq + 1,
    extends: check.extends + 1,
    sentAt: now,
  };
  try {
    const boxes = await boxesOf(next, now);
    if (boxes === null) return 'RECIPIENT';
    const reply = await checkinApi.extend(next.id, openAtOf(next.due, next.grace), boxes);
    if ('refused' in reply) return reply.refused;
  } catch {
    return 'failed';
  }
  update(next);
  await remind(next);
  return 'ok';
}

/** On the way: the alerts sealed again with the newest location (never a new time). */
async function refresh(check: OwnCheck, now: number): Promise<void> {
  const next = { ...check, seq: check.seq + 1, sentAt: now };
  const boxes = await boxesOf(next, now);
  if (boxes === null) return;
  const reply = await checkinApi.refresh(next.id, boxes);
  if ('ok' in reply) update(next);
  else if (reply.refused === 'FIRED') update({ ...check, state: 'fired' });
}

/** Every armed check, for the location service: it runs while one is open (docs/ADR/0039 §4). */
export function wantsLocation(): boolean {
  return ownChecks().checks.some((check) => check.state === 'armed');
}

/**
 * The service's line while a check is open: "Eve vardım kontrolü açık · 23:30 · Ayşe, Can". Who
 * gets the alert is on it, where anyone holding the phone sees it (QA-44 Orta 1, coercion).
 */
export function serviceLine(language: string): string | null {
  const armed = ownChecks().checks.filter((check) => check.state === 'armed');
  if (armed.length === 0) return null;
  const soonest = Math.min(...armed.map((check) => check.due));
  const names = [...new Set(armed.flatMap((check) => check.recipients))].map(nameOf).join(', ');
  return i18n.t('checkin.service', { time: clockOf(soonest, language), names });
}

/** A new position: arrived somewhere, or time for a refresh with it. */
export async function checkinFix(fix: Fix): Promise<void> {
  const now = Date.now();
  for (const check of ownChecks().checks) {
    if (check.state !== 'armed') continue;
    if (hasArrived(check, fix, now)) {
      await settle(check, 'arrived');
      continue;
    }
    const moving = (fix.spd ?? 0) > 0.5;
    if (refreshDue(check, moving, now)) await refresh(check, now).catch(() => undefined);
  }
}

/** The battery is nearly gone (N1): every open check is refreshed now with the last location. */
export async function checkinLowBattery(): Promise<void> {
  const now = Date.now();
  for (const check of ownChecks().checks) {
    if (check.state === 'armed') await refresh(check, now).catch(() => undefined);
  }
}

// ---- the recipient's side ---------------------------------------------------------------------

/** Alerts handed over to this person: fetched, opened here, kept until "Gördüm". */
export async function fetchAlerts(): Promise<void> {
  load();
  const device = useAuth.getState().device;
  if (device === null) return;
  const { alerts } = await checkinApi.inbox();
  const now = Date.now();
  const opened: ReceivedAlert[] = [];
  const unreadable: AlertsState['unreadable'] = [];
  for (const alert of alerts) {
    const sender = deviceOf(alert.ownerId);
    try {
      if (sender?.deviceId !== alert.box.senderDeviceId) throw new Error('keys');
      const payload = openDirect({ envelope: alert.box, recipient: device, sender, now });
      if (payload.kind !== 'checkin' || payload.id !== alert.checkinId) throw new Error('kind');
      opened.push(receivedOf(payload, alert, now));
    } catch {
      unreadable.push({
        checkinId: alert.checkinId,
        ownerId: alert.ownerId,
        firedAt: alert.firedAt,
      });
    }
  }
  useAlerts.setState((state) => ({ ...state, alerts: opened, unreadable }));
}

/** "Gördüm": this person's box goes from the server, and the alert from this phone. */
export async function ackAlert(checkinId: string): Promise<void> {
  await checkinApi.ack(checkinId);
  useAlerts.setState((state) => ({
    ...state,
    alerts: state.alerts.filter((alert) => alert.checkinId !== checkinId),
    unreadable: state.unreadable.filter((alert) => alert.checkinId !== checkinId),
  }));
}

// ---- wiring ---------------------------------------------------------------------------------

const firedSchema = z.object({
  type: z.literal('checkin.fired'),
  checkinId: z.uuid(),
  ownerId: z.uuid(),
});

function onFired(event: ServerEvent): void {
  const parsed = firedSchema.safeParse(event);
  if (!parsed.success) return;
  const me = useAuth.getState().userId;
  if (parsed.data.ownerId === me) {
    const check = ownChecks().checks.find((each) => each.id === parsed.data.checkinId);
    if (check?.state === 'armed') update({ ...check, state: 'fired' });
    return;
  }
  void fetchAlerts()
    .then(() => {
      toast.notice(i18n.t('checkin.alert.pushBody'), 'error', () => {
        void import('expo-router').then(({ router }) => {
          router.push('/checkin/alerts');
        });
      });
    })
    .catch(() => undefined);
}

onServerEvents((events) => {
  for (const event of events) {
    if (event.type === 'checkin.fired') onFired(event);
  }
});

/** How often the app's return may sync, and how soon a failed set is looked at again. */
const SYNC_GAP_MS = 30_000;
let lastSync = 0;

/**
 * The phone and the server in step: what waited to be cancelled goes, what fired meanwhile is
 * learnt, the plans set their next day, checks the server holds that this phone does not know are
 * cancelled (QA-44 Orta 3), and alerts handed over are fetched. Throws when the server cannot be
 * reached (nothing after that point is done).
 */
export async function syncChecks(): Promise<void> {
  load();
  lastSync = Date.now();
  for (const waiting of useOwnChecks.getState().pending) {
    const reply = await checkinApi.cancel(waiting.checkinId);
    const late = 'refused' in reply && reply.refused === 'FIRED';
    for (const userId of waiting.recipients) {
      tellLine(userId, { kind: 'checkinOk', checkinId: waiting.checkinId, late });
    }
    useOwnChecks.setState((state) => ({
      ...state,
      pending: state.pending.filter((each) => each.checkinId !== waiting.checkinId),
    }));
  }
  const { checkins } = await checkinApi.list();
  for (const check of useOwnChecks.getState().checks) {
    const there = checkins.find((each) => each.id === check.id);
    if (check.state === 'armed' && there?.firedAt !== null && there !== undefined) {
      update({ ...check, state: 'fired' });
    }
  }
  // Done and fired checks are kept a day for the screen, then forgotten.
  const dayAgo = Date.now() - 24 * 3_600_000;
  useOwnChecks.setState((state) => ({
    ...state,
    checks: state.checks.filter((check) => check.state === 'armed' || check.due > dayAgo),
  }));
  await planTick();
  const state = useOwnChecks.getState();
  const known = new Set([
    ...state.checks.map((check) => check.id),
    ...state.plans.flatMap((plan) => (plan.day === undefined ? [] : [plan.day.id])),
    ...sending,
  ]);
  for (const id of strayChecks(checkins, known)) await checkinApi.cancel(id);
  // The unsure ones are settled now; each is kept till its time, for a late copy to be caught.
  const now = Date.now();
  useOwnChecks.setState((current) => ({
    ...current,
    unsure: current.unsure.filter((each) => each.openAt > now),
  }));
  await fetchAlerts();
}

let later: ReturnType<typeof setTimeout> | null = null;
/** A set that got no answer: the server is asked again soon, and again while it cannot be reached. */
function syncLater(): void {
  if (later !== null) return;
  later = setTimeout(() => {
    later = null;
    syncChecks().catch(() => {
      syncLater();
    });
  }, SYNC_GAP_MS);
}

/**
 * Before signing out (QA-44 Düşük 3): every check not yet fired ends on the server first, with
 * what waited to be cancelled and what was unsure. False when the server could not be reached for
 * one of them: the caller asks whether to sign out anyway (its alert could still go).
 */
export async function closeChecksBeforeSignOut(): Promise<boolean> {
  load();
  const state = useOwnChecks.getState();
  const ids = new Set([
    ...state.checks.filter((check) => check.state === 'armed').map((check) => check.id),
    ...state.pending.map((each) => each.checkinId),
    ...state.unsure.map((each) => each.id),
    ...state.plans.flatMap((plan) => (plan.day === undefined ? [] : [plan.day.id])),
  ]);
  let reached = true;
  for (const id of ids) {
    try {
      await checkinApi.cancel(id);
    } catch {
      reached = false;
    }
  }
  return reached;
}

// Back online, and back in the app (QA-44 Düşük 3): the same sync.
onOnline(() => {
  void syncChecks().catch(() => undefined);
});
AppState.addEventListener('change', (next) => {
  if (next !== 'active' || !isVaultOpen() || useAuth.getState().userId === null) return;
  if (Date.now() - lastSync < SYNC_GAP_MS) return;
  void syncChecks().catch(() => undefined);
});

// Nothing of one account may stay for the next: checks, plans, alerts and reminders go.
onSignedOut(() => {
  useOwnChecks.setState(EMPTY_OWN);
  useAlerts.setState(EMPTY_ALERTS);
  loaded = false;
  if (later !== null) clearTimeout(later);
  later = null;
  void hideOpenNotice().catch(() => undefined);
  void cancelAllDue().catch(() => undefined);
});
