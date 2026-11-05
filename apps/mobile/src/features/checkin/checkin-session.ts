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
import { onCheckinOk } from './checkin-events';
import { loadCheckinOutbox } from './checkin-outbox';
import { cancelAllDue, cancelDue, hideOpenNotice, scheduleDue } from './checkin-reminders';
import {
  alertOf,
  type AlertRevision,
  alertRevisionOf,
  type ArrivedCheck,
  arrivedBefore,
  type CheckPlace,
  type CheckPlan,
  dayIdOf,
  EXTEND_MS,
  type Grace,
  hasArrived,
  nextDue,
  openAtOf,
  type OwnCheck,
  pruneAlertRevisions,
  pruneArrived,
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

type SettleHow = 'arrived' | 'ok' | 'skipped';
export interface OwnState {
  checks: OwnCheck[];
  plans: CheckPlan[];
  /** Cancellations the server has yet to take; old vault entries have no line metadata. */
  pending: { checkinId: string; recipients: string[]; how?: SettleHow; late?: boolean }[];
  /**
   * One-time checks sent whose answer never came (QA-44 Orta 3), kept until their time: if the
   * server took one after all (or a late copy of the request lands), the next sync cancels it.
   * Recipients were added later; old vault entries safely have none.
   */
  unsure: { id: string; openAt: number; recipients?: string[] }[];
}
const EMPTY_OWN: OwnState = { checks: [], plans: [], pending: [], unsure: [] };

/** Ids being set right now, scoped to their account generation: never taken for strays. */
const sending = new Set<{ generation: number; id: string }>();

export interface AlertsState {
  alerts: ReceivedAlert[];
  /** Alerts this phone could not open (keys it does not have): said so, and who to reach. */
  unreadable: { checkinId: string; ownerId: string; firedAt: number }[];
  /** Late alerts for checks whose verified "Vardı" line arrived first. */
  resolved: { checkinId: string; ownerId: string; firedAt: number }[];
  /** Checks whose owner said "Vardı", scoped by owner and kept for 48 hours. */
  arrived: ArrivedCheck[];
  /** Highest opened seq per owner/check, independent of the current 50-alert page. */
  revisions: AlertRevision[];
}
const EMPTY_ALERTS: AlertsState = {
  alerts: [],
  unreadable: [],
  resolved: [],
  arrived: [],
  revisions: [],
};

export const useOwnChecks = create<OwnState>(() => EMPTY_OWN);
export const useAlerts = create<AlertsState>(() => EMPTY_ALERTS);

// ---- account and vault -----------------------------------------------------------------------

let generation = 0;
interface SessionContext {
  generation: number;
  userId: string | null;
  deviceId: string | null;
}
function sessionContext(): SessionContext {
  const auth = useAuth.getState();
  return { generation, userId: auth.userId, deviceId: auth.device?.deviceId ?? null };
}
function isCurrent(context: SessionContext): boolean {
  const now = sessionContext();
  return (
    context.generation === now.generation &&
    context.userId === now.userId &&
    context.deviceId === now.deviceId
  );
}
function assertCurrent(context: SessionContext): void {
  if (context.userId === null || context.deviceId === null || !isCurrent(context)) {
    throw new Error('check-in session changed');
  }
}

let loaded = false;
let loadedGeneration = -1;
function load(): void {
  if (!isVaultOpen()) {
    loaded = false;
    loadedGeneration = -1;
    useOwnChecks.setState(EMPTY_OWN, true);
    useAlerts.setState(EMPTY_ALERTS, true);
    return;
  }
  if (loaded && loadedGeneration === generation) return;
  loaded = true;
  loadedGeneration = generation;
  const read = (key: string) => {
    try {
      const raw = vault().get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  };
  const own = read(OWN_KEY);
  useOwnChecks.setState(
    typeof own === 'object' && own !== null ? { ...EMPTY_OWN, ...own } : EMPTY_OWN,
    true,
  );
  const alerts = read(ALERTS_KEY);
  const restored =
    typeof alerts === 'object' && alerts !== null ? { ...EMPTY_ALERTS, ...alerts } : EMPTY_ALERTS;
  const rawArrived: unknown = (restored as { arrived?: unknown }).arrived;
  const arrived = Array.isArray(rawArrived)
    ? rawArrived.filter(
        (each: unknown): each is ArrivedCheck =>
          typeof each === 'object' &&
          each !== null &&
          'ownerId' in each &&
          typeof each.ownerId === 'string' &&
          'checkinId' in each &&
          typeof each.checkinId === 'string' &&
          'receivedAt' in each &&
          typeof each.receivedAt === 'number',
      )
    : [];
  const now = Date.now();
  useAlerts.setState(
    {
      ...restored,
      arrived: pruneArrived(arrived, now),
      revisions: pruneAlertRevisions(restored.revisions, now),
    },
    true,
  );
}
useOwnChecks.subscribe((state) => {
  if (loaded && loadedGeneration === generation && isVaultOpen()) {
    vault().set(OWN_KEY, JSON.stringify(state));
  }
});
useAlerts.subscribe((state) => {
  if (loaded && loadedGeneration === generation && isVaultOpen()) {
    vault().set(ALERTS_KEY, JSON.stringify(state));
  }
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
async function boxesOf(
  check: OwnCheck,
  now: number,
  context: SessionContext,
): Promise<CheckinBox[] | null> {
  assertCurrent(context);
  const device = useAuth.getState().device;
  if (device === null) return null;
  const power = await battery();
  assertCurrent(context);
  const payload: ChatPayload = alertOf(check, useMyFix.getState().fix, power, now);
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
async function tellLineAwait(
  userId: string,
  line: Line,
  context: SessionContext,
): Promise<boolean> {
  try {
    assertCurrent(context);
    const outbox = await loadCheckinOutbox();
    assertCurrent(context);
    const result = await outbox.sendCheckinLine(userId, line);
    return isCurrent(context) && result === 'sent';
  } catch (error) {
    if (!isCurrent(context)) return false;
    throw error;
  }
}
function tellLine(userId: string, line: Line, context = sessionContext()): void {
  void tellLineAwait(userId, line, context).catch(() => undefined);
}

async function remind(check: OwnCheck, context: SessionContext): Promise<void> {
  const place =
    check.place === null ? i18n.t('checkin.title') : `${check.place.emoji} ${check.place.name}`;
  assertCurrent(context);
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
async function created(
  id: string,
  openAt: number,
  boxes: CheckinBox[],
  context: SessionContext,
): Promise<CheckinReply> {
  let lost: unknown;
  for (const wait of [0, ...RETRY_MS]) {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    assertCurrent(context);
    try {
      const reply = await checkinApi.create(id, openAt, boxes);
      assertCurrent(context);
      return reply;
    } catch (error) {
      if (!isCurrent(context)) throw error;
      lost = error;
    }
  }
  throw lost;
}

function dropUnsure(id: string, context?: SessionContext): void {
  if (context !== undefined && !isCurrent(context)) return;
  useOwnChecks.setState((state) => ({
    ...state,
    unsure: state.unsure.filter((each) => each.id !== id),
  }));
}

function planWants(planId: string, due: number, id: string): boolean {
  const plan = useOwnChecks.getState().plans.find((each) => each.id === planId);
  return plan?.day?.id === id && plan.day.due === due && !plan.skip.includes(due);
}

/** Sets a check: its sealed alerts go to the server, "İyi misin?" is set for its time. */
export async function startCheck(input: NewCheck, tell = true): Promise<CheckinResult> {
  load();
  const context = sessionContext();
  if (context.userId === null || context.deviceId === null) return 'failed';
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
      unsure: [...state.unsure, { id: check.id, openAt, recipients: check.recipients }],
    }));
  }
  const marker = { generation: context.generation, id: check.id };
  sending.add(marker);
  try {
    const boxes = await boxesOf(check, now, context);
    if (boxes === null) {
      dropUnsure(check.id, context);
      return 'RECIPIENT';
    }
    const reply = await created(check.id, openAt, boxes, context);
    if ('refused' in reply) {
      dropUnsure(check.id, context);
      return reply.refused;
    }
  } catch {
    // Still unsure: the next sync cancels it if the server took it after all.
    if (isCurrent(context)) syncLater(context);
    return 'failed';
  } finally {
    sending.delete(marker);
  }
  if (!isCurrent(context)) return 'failed';
  if (check.planId !== undefined && !planWants(check.planId, check.due, check.id)) {
    try {
      assertCurrent(context);
      await checkinApi.cancel(check.id);
      assertCurrent(context);
    } catch {
      if (isCurrent(context)) {
        useOwnChecks.setState((state) => ({
          ...state,
          pending: [
            ...state.pending.filter((each) => each.checkinId !== check.id),
            { checkinId: check.id, recipients: check.recipients, how: 'skipped', late: false },
          ],
        }));
        syncLater(context);
      }
      return 'failed';
    }
    return 'NOT_FOUND';
  }
  useOwnChecks.setState((state) => ({
    ...state,
    checks: state.checks.some((each) => each.id === check.id)
      ? state.checks
      : [...state.checks, check],
    unsure: state.unsure.filter((each) => each.id !== check.id),
  }));
  await remind(check, context);
  if (!isCurrent(context)) return 'failed';
  // A one-time check is told as it is set; a repeated one only when its plan is (the PM, 3).
  if (tell) {
    for (const userId of check.recipients) {
      tellLine(userId, { kind: 'checkinSet', checkinId: check.id, due: check.due }, context);
    }
  }
  return 'ok';
}

/** A repeated check: the plan stays here; its first day's check is set at once if it can be. */
export async function startPlan(
  plan: Omit<CheckPlan, 'id' | 'lastDue' | 'skip'>,
): Promise<CheckinResult> {
  load();
  const context = sessionContext();
  if (context.userId === null || context.deviceId === null) return 'failed';
  const saved: CheckPlan = { ...plan, id: randomUuid(), lastDue: null, skip: [] };
  useOwnChecks.setState((state) => ({ ...state, plans: [...state.plans, saved] }));
  for (const userId of plan.recipients) {
    tellLine(
      userId,
      {
        kind: 'checkinSet',
        checkinId: null,
        due: null,
        plan: { days: plan.days, at: plan.at },
      },
      context,
    );
  }
  await planTick();
  return isCurrent(context) ? 'ok' : 'failed';
}

export function stopPlan(planId: string): void {
  const set = useOwnChecks
    .getState()
    .checks.find((check) => check.planId === planId && check.state === 'armed');
  useOwnChecks.setState((state) => ({
    ...state,
    plans: state.plans.filter((plan) => plan.id !== planId),
  }));
  if (set !== undefined) void settle(set, 'skipped');
}

/** "Bugün atla": the plan's next check is not set (or is cancelled if it was). */
export async function skipNext(planId: string): Promise<void> {
  load();
  const plan = useOwnChecks.getState().plans.find((each) => each.id === planId);
  if (plan === undefined) return;
  const set = useOwnChecks
    .getState()
    .checks.find((check) => check.planId === planId && check.state === 'armed');
  const due = set?.due ?? plan.day?.due ?? nextDue(plan, Date.now());
  if (due === null) return;
  useOwnChecks.setState((state) => ({
    ...state,
    plans: state.plans.map((each) =>
      each.id === planId && !each.skip.includes(due)
        ? { ...each, skip: [...each.skip, due] }
        : each,
    ),
  }));
  if (set !== undefined) await settle(set, 'skipped');
}

function setPlan(planId: string, change: Partial<CheckPlan>, context: SessionContext): void {
  if (!isCurrent(context)) return;
  useOwnChecks.setState((state) => ({
    ...state,
    plans: state.plans.map((each) => (each.id === planId ? { ...each, ...change } : each)),
  }));
}

let ticking: { generation: number; promise: Promise<void> } | null = null;

/**
 * Each plan's next check, set ahead when its time is within reach (docs/ADR/0039 §2). The day's
 * id is made once and kept on the plan before it is sent, so every try that day asks with it
 * (QA-44 Orta 3). One round at a time and account.
 */
export function planTick(now = Date.now()): Promise<void> {
  load();
  const context = sessionContext();
  if (context.userId === null || context.deviceId === null) return Promise.resolve();
  if (ticking?.generation === context.generation) return ticking.promise;
  const promise = tickPlans(now, context).finally(() => {
    if (ticking?.promise === promise) ticking = null;
  });
  ticking = { generation: context.generation, promise };
  return promise;
}

async function tickPlans(now: number, context: SessionContext): Promise<void> {
  for (const plan of useOwnChecks.getState().plans) {
    if (!isCurrent(context)) return;
    const due = nextDue(plan, now);
    if (due === null) continue;
    const id = dayIdOf(plan, due, randomUuid);
    if (plan.day?.id !== id) setPlan(plan.id, { day: { due, id } }, context);
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
    if (result === 'ok' && planWants(plan.id, due, id)) {
      setPlan(plan.id, { lastDue: due }, context);
    }
  }
}

/**
 * Ends a check well: arrived, "İyiyim", or a repeated day skipped. If it has not fired it is gone
 * from the server for good; if it had, its recipients are told "Vardı, haber geç ulaştı". Offline,
 * the cancellation waits and is tried again (the PM's second condition).
 */
async function settle(check: OwnCheck, how: SettleHow): Promise<CheckinResult> {
  const context = sessionContext();
  if (!isCurrent(context) || context.userId === null || context.deviceId === null) return 'failed';
  update({ ...check, state: 'done' });
  void cancelDue(check.id).catch(() => undefined);
  if (!wantsLocation()) void hideOpenNotice().catch(() => undefined);
  let late = check.state === 'fired';
  try {
    assertCurrent(context);
    const reply = await checkinApi.cancel(check.id);
    assertCurrent(context);
    if ('refused' in reply && reply.refused === 'FIRED') late = true;
  } catch {
    if (isCurrent(context)) {
      useOwnChecks.setState((state) => ({
        ...state,
        pending: [
          ...state.pending,
          { checkinId: check.id, recipients: check.recipients, how, late },
        ],
      }));
    }
    return 'failed';
  }
  if (how !== 'skipped' || late) {
    for (const userId of check.recipients) {
      tellLine(userId, { kind: 'checkinOk', checkinId: check.id, late }, context);
    }
  }
  return 'ok';
}

/** "Vardım" / "İyiyim" by hand, before or after the alert went. */
export function imOk(checkinId: string): Promise<CheckinResult> {
  const check = ownChecks().checks.find((each) => each.id === checkinId && each.state !== 'done');
  return check === undefined ? Promise.resolve('ok') : settle(check, 'ok');
}

function sameArmed(check: OwnCheck): boolean {
  const current = useOwnChecks.getState().checks.find((each) => each.id === check.id);
  return (
    current?.state === 'armed' &&
    current.seq === check.seq &&
    current.due === check.due &&
    current.sentAt === check.sentAt
  );
}

function updateArmed(next: OwnCheck, expected: OwnCheck): void {
  useOwnChecks.setState((state) => ({
    ...state,
    checks: state.checks.map((each) =>
      each.id === expected.id &&
      each.state === 'armed' &&
      each.seq === expected.seq &&
      each.due === expected.due &&
      each.sentAt === expected.sentAt
        ? next
        : each,
    ),
  }));
}

/** "15 dk uzat": the due time moves, the alerts are sealed again for it. Only the owner can. */
export async function extendCheck(checkinId: string): Promise<CheckinResult> {
  const check = ownChecks().checks.find((each) => each.id === checkinId && each.state === 'armed');
  if (check === undefined) return 'NOT_FOUND';
  const context = sessionContext();
  const now = Date.now();
  const next: OwnCheck = {
    ...check,
    due: Math.max(check.due, now) + EXTEND_MS,
    seq: check.seq + 1,
    extends: check.extends + 1,
    sentAt: now,
  };
  try {
    const boxes = await boxesOf(next, now, context);
    if (boxes === null) return 'RECIPIENT';
    assertCurrent(context);
    if (!sameArmed(check)) return 'NOT_FOUND';
    const reply = await checkinApi.extend(next.id, openAtOf(next.due, next.grace), boxes);
    assertCurrent(context);
    if ('refused' in reply) return reply.refused;
  } catch {
    return 'failed';
  }
  if (!sameArmed(check)) return 'NOT_FOUND';
  updateArmed(next, check);
  await remind(next, context);
  return isCurrent(context) ? 'ok' : 'failed';
}

/** On the way: the alerts sealed again with the newest location (never a new time). */
async function refresh(check: OwnCheck, now: number): Promise<void> {
  const context = sessionContext();
  const next = { ...check, seq: check.seq + 1, sentAt: now };
  const boxes = await boxesOf(next, now, context);
  if (boxes === null) return;
  assertCurrent(context);
  if (!sameArmed(check)) return;
  const reply = await checkinApi.refresh(next.id, boxes);
  assertCurrent(context);
  if (!sameArmed(check)) return;
  if ('ok' in reply) updateArmed(next, check);
  else if (reply.refused === 'FIRED') updateArmed({ ...check, state: 'fired' }, check);
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
  const context = sessionContext();
  const device = useAuth.getState().device;
  if (device === null || context.userId === null) return;
  const { alerts } = await checkinApi.inbox();
  assertCurrent(context);
  const now = Date.now();
  const previous = useAlerts.getState();
  const keyOf = (alert: { ownerId: string; checkinId: string }) =>
    `${alert.ownerId}:${alert.checkinId}`;
  const visiblePrevious = previous.alerts.filter(
    (alert) => alertRevisionOf(alert).validUntil > now,
  );
  const previousByKey = new Map(visiblePrevious.map((alert) => [keyOf(alert), alert]));
  const revisions = new Map<string, AlertRevision>();
  const knownRevisions = pruneAlertRevisions(
    [...previous.revisions, ...visiblePrevious.map(alertRevisionOf)],
    now,
  );
  for (const revision of knownRevisions) {
    const key = keyOf(revision);
    const kept = revisions.get(key);
    if (kept === undefined || revision.seq > kept.seq) revisions.set(key, revision);
  }

  const opened = new Map<string, ReceivedAlert>();
  const unreadable: AlertsState['unreadable'] = [];
  const resolved: AlertsState['resolved'] = [];
  for (const alert of alerts) {
    const meta = {
      checkinId: alert.checkinId,
      ownerId: alert.ownerId,
      firedAt: alert.firedAt,
    };
    if (arrivedBefore(previous.arrived, alert.ownerId, alert.checkinId, now)) {
      resolved.push(meta);
      continue;
    }
    const sender = deviceOf(alert.ownerId);
    try {
      if (sender?.deviceId !== alert.box.senderDeviceId) throw new Error('keys');
      const payload = openDirect({ envelope: alert.box, recipient: device, sender, now });
      if (payload.kind !== 'checkin' || payload.id !== alert.checkinId) throw new Error('kind');
      const received = receivedOf(payload, alert, now);
      const key = keyOf(received);
      const before = revisions.get(key);
      if (before === undefined || received.seq > before.seq) {
        opened.set(key, received);
        revisions.set(key, alertRevisionOf(received));
      } else {
        // Keep the visible copy only when it is already known; an equal or older replay cannot
        // recreate an alert after an empty page or replace a conflicting equal-seq payload.
        const known = previousByKey.get(key);
        const current = opened.get(key);
        if (known !== undefined && (current === undefined || current.seq < known.seq)) {
          opened.set(key, known);
        }
      }
    } catch {
      unreadable.push(meta);
    }
  }
  const unreadableKeys = new Set(unreadable.map(keyOf));
  const kept = visiblePrevious.filter(
    (alert) => unreadableKeys.has(keyOf(alert)) && !opened.has(keyOf(alert)),
  );
  useAlerts.setState((state) => ({
    ...state,
    alerts: [...opened.values(), ...kept],
    unreadable: unreadable.filter(
      (alert) => !visiblePrevious.some((known) => keyOf(known) === keyOf(alert)),
    ),
    resolved,
    arrived: pruneArrived(state.arrived, now),
    revisions: [...revisions.values()],
  }));
}

/** "Gördüm": this person's box goes from the server, and the alert from this phone. */
export async function ackAlert(checkinId: string): Promise<void> {
  const context = sessionContext();
  assertCurrent(context);
  const before = useAlerts.getState();
  const pageWasFull =
    before.alerts.length + before.unreadable.length + before.resolved.length === 50;
  await checkinApi.ack(checkinId);
  assertCurrent(context);
  useAlerts.setState((state) => ({
    ...state,
    alerts: state.alerts.filter((alert) => alert.checkinId !== checkinId),
    unreadable: state.unreadable.filter((alert) => alert.checkinId !== checkinId),
    resolved: state.resolved.filter((alert) => alert.checkinId !== checkinId),
  }));
  if (pageWasFull) {
    assertCurrent(context);
    await fetchAlerts();
  }
}

// ---- wiring ---------------------------------------------------------------------------------

onCheckinOk(({ ownerId, checkinId }) => {
  load();
  if (useAuth.getState().userId === null) return;
  const receivedAt = Date.now();
  useAlerts.setState((state) => {
    const existing = [...state.alerts, ...state.unreadable].find(
      (alert) => alert.ownerId === ownerId && alert.checkinId === checkinId,
    );
    const resolved = state.resolved.filter(
      (alert) => alert.ownerId !== ownerId || alert.checkinId !== checkinId,
    );
    if (existing !== undefined) resolved.push(existing);
    return {
      ...state,
      alerts: state.alerts.filter(
        (alert) => alert.ownerId !== ownerId || alert.checkinId !== checkinId,
      ),
      unreadable: state.unreadable.filter(
        (alert) => alert.ownerId !== ownerId || alert.checkinId !== checkinId,
      ),
      resolved,
      arrived: pruneArrived(
        [
          ...state.arrived.filter(
            (alert) => alert.ownerId !== ownerId || alert.checkinId !== checkinId,
          ),
          { ownerId, checkinId, receivedAt },
        ],
        receivedAt,
      ),
    };
  });
});

const firedSchema = z.object({
  type: z.literal('checkin.fired'),
  checkinId: z.uuid(),
  ownerId: z.uuid(),
});

function onFired(event: ServerEvent): void {
  const parsed = firedSchema.safeParse(event);
  if (!parsed.success) return;
  const context = sessionContext();
  const me = context.userId;
  if (parsed.data.ownerId === me) {
    const check = ownChecks().checks.find((each) => each.id === parsed.data.checkinId);
    if (check?.state === 'armed') update({ ...check, state: 'fired' });
    return;
  }
  void fetchAlerts()
    .then(() => {
      if (
        !isCurrent(context) ||
        arrivedBefore(
          useAlerts.getState().arrived,
          parsed.data.ownerId,
          parsed.data.checkinId,
          Date.now(),
        )
      ) {
        return;
      }
      toast.notice(i18n.t('checkin.alert.pushBody'), 'error', () => {
        if (!isCurrent(context)) return;
        void import('expo-router').then(({ router }) => {
          if (isCurrent(context)) router.push('/checkin/alerts');
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
  const context = sessionContext();
  if (context.userId === null || context.deviceId === null) return;
  assertCurrent(context);
  lastSync = Date.now();
  for (const waiting of useOwnChecks.getState().pending) {
    assertCurrent(context);
    const reply = await checkinApi.cancel(waiting.checkinId);
    assertCurrent(context);
    const late = waiting.late === true || ('refused' in reply && reply.refused === 'FIRED');
    const how = waiting.how ?? 'ok';
    if (how !== 'skipped' || late) {
      for (const userId of waiting.recipients) {
        tellLine(userId, { kind: 'checkinOk', checkinId: waiting.checkinId, late }, context);
      }
    }
    useOwnChecks.setState((state) => ({
      ...state,
      pending: state.pending.filter((each) => each.checkinId !== waiting.checkinId),
    }));
  }
  const { checkins } = await checkinApi.list();
  assertCurrent(context);
  for (const check of useOwnChecks.getState().checks) {
    const there = checkins.find((each) => each.id === check.id);
    if (check.state === 'armed' && there?.firedAt !== null && there !== undefined) {
      update({ ...check, state: 'fired' });
    }
  }
  // Done and fired checks are kept a day for the screen, then forgotten.
  const dayAgo = Date.now() - 24 * 3_600_000;
  const now = Date.now();
  useOwnChecks.setState((state) => ({
    ...state,
    checks: state.checks.filter((check) => check.state === 'armed' || check.due > dayAgo),
  }));
  useAlerts.setState((state) => ({ ...state, arrived: pruneArrived(state.arrived, now) }));
  await planTick();
  assertCurrent(context);

  // A late create answer is cancelled as soon as the server shows it. Any acknowledged cancel,
  // including a FIRED refusal, ends the retry timer for that id.
  for (const waiting of useOwnChecks.getState().unsure) {
    const there = checkins.find((each) => each.id === waiting.id);
    if (there === undefined) {
      if (waiting.openAt <= now) dropUnsure(waiting.id, context);
      continue;
    }
    if (there.firedAt === null) {
      assertCurrent(context);
      await checkinApi.cancel(waiting.id);
      assertCurrent(context);
    }
    dropUnsure(waiting.id, context);
  }

  const state = useOwnChecks.getState();
  const known = new Set([
    ...state.checks.map((check) => check.id),
    ...state.plans.flatMap((plan) =>
      plan.day === undefined || plan.skip.includes(plan.day.due) ? [] : [plan.day.id],
    ),
    ...[...sending].filter((each) => each.generation === context.generation).map((each) => each.id),
    ...state.unsure.map((each) => each.id),
  ]);
  for (const id of strayChecks(checkins, known)) {
    assertCurrent(context);
    await checkinApi.cancel(id);
    assertCurrent(context);
  }
  await fetchAlerts();
  if (isCurrent(context) && useOwnChecks.getState().unsure.length > 0) syncLater(context);
}

let later: { generation: number; timer: ReturnType<typeof setTimeout> } | null = null;
/** A set that got no answer: the server is asked again soon, and again while it cannot be reached. */
function syncLater(context = sessionContext()): void {
  if (!isCurrent(context) || context.userId === null || context.deviceId === null) return;
  if (later?.generation === context.generation) return;
  if (later !== null) clearTimeout(later.timer);
  const timer = setTimeout(() => {
    if (later?.timer !== timer || context.generation !== generation) return;
    later = null;
    if (!isCurrent(context)) return;
    syncChecks().catch(() => {
      if (isCurrent(context)) syncLater(context);
    });
  }, SYNC_GAP_MS);
  later = { generation: context.generation, timer };
}

/**
 * Before signing out (QA-44 Düşük 3): every check not yet fired ends on the server first, with
 * what waited to be cancelled and what was unsure. A late "Vardı" line is awaited too: false asks
 * the caller whether to sign out anyway rather than hiding a failed delivery.
 */
export async function closeChecksBeforeSignOut(): Promise<boolean> {
  load();
  const context = sessionContext();
  if (context.userId === null || context.deviceId === null) return true;
  const state = useOwnChecks.getState();
  const targets = new Map<string, { recipients: Set<string>; late: boolean; how: SettleHow }>();
  const add = (
    id: string,
    recipients: readonly string[] | undefined,
    late: boolean,
    how: SettleHow = 'ok',
  ) => {
    const target = targets.get(id) ?? {
      recipients: new Set<string>(),
      late: false,
      how,
    };
    for (const recipient of recipients ?? []) target.recipients.add(recipient);
    target.late ||= late;
    if (how === 'skipped') target.how = 'skipped';
    targets.set(id, target);
  };
  const done = new Set(
    state.checks.filter((check) => check.state === 'done').map((check) => check.id),
  );
  for (const check of state.checks) {
    if (check.state !== 'done') add(check.id, check.recipients, check.state === 'fired');
  }
  for (const waiting of state.pending) {
    add(waiting.checkinId, waiting.recipients, waiting.late === true, waiting.how ?? 'ok');
  }
  for (const waiting of state.unsure) add(waiting.id, waiting.recipients, false);
  for (const plan of state.plans) {
    if (plan.day !== undefined && !done.has(plan.day.id) && !plan.skip.includes(plan.day.due)) {
      add(plan.day.id, plan.recipients, false);
    }
  }
  let reached = true;
  for (const [id, target] of targets) {
    let late = target.late;
    try {
      assertCurrent(context);
      const reply = await checkinApi.cancel(id);
      assertCurrent(context);
      late ||= 'refused' in reply && reply.refused === 'FIRED';
    } catch {
      reached = false;
      continue;
    }
    if (target.how === 'skipped' && !late) continue;
    if (target.recipients.size === 0) {
      reached = false;
      continue;
    }
    for (const userId of target.recipients) {
      try {
        const sent = await tellLineAwait(
          userId,
          { kind: 'checkinOk', checkinId: id, late },
          context,
        );
        if (!sent) reached = false;
      } catch {
        reached = false;
      }
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
  generation += 1;
  loaded = false;
  loadedGeneration = -1;
  sending.clear();
  ticking = null;
  lastSync = 0;
  if (later !== null) clearTimeout(later.timer);
  later = null;
  useOwnChecks.setState(EMPTY_OWN, true);
  useAlerts.setState(EMPTY_ALERTS, true);
  void hideOpenNotice().catch(() => undefined);
  void cancelAllDue().catch(() => undefined);
});
