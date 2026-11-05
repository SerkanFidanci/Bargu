import { CHECKIN, type ChatPayload } from '@bargu/schemas';

import { distanceM, type Fix } from '../location/send';
import type { LocationPermission } from '../location/tracker';

/**
 * "Eve vardım kontrolü" on this phone (docs/ADR/0039): the rules that need no network, kept apart
 * so they can be tested. The destination's coordinates stay here: only its name goes in the sealed
 * alert, and nothing of it to the server.
 */

export type Grace = (typeof CHECKIN.graceMinutes)[number];

/** Where the check waits for the person: a saved place, or a point; its centre stays on the phone. */
export interface CheckPlace {
  name: string;
  emoji: string;
  lat: number;
  lng: number;
  radius: number;
}

/** A check this phone set. */
export interface OwnCheck {
  id: string;
  /** T: "en geç" (signed into every alert). */
  due: number;
  grace: Grace;
  place: CheckPlace | null;
  recipients: string[];
  note?: string;
  /** Which refresh the server has; the next one is one more. */
  seq: number;
  createdAt: number;
  extends: number;
  /** When the server last took its boxes (set, refreshed, extended). */
  sentAt: number;
  /**
   * armed: waiting for arrival or its time; fired: the alert went; done: arrived or "İyiyim" (and,
   * if it had fired, the recipients were told).
   */
  state: 'armed' | 'fired' | 'done';
  /** The plan it came from (a repeated check). */
  planId?: string;
}

/** A repeated check (docs/ADR/0039 §2): only this phone keeps it; each day's check is set ahead. */
export interface CheckPlan {
  id: string;
  /** Days of the week, 0 Sunday. */
  days: number[];
  /** "23:30", the phone's own time. */
  at: string;
  grace: Grace;
  place: CheckPlace | null;
  recipients: string[];
  note?: string;
  /** The due time of the last check this plan set (one per day), and days to skip ("Bugün atla"). */
  lastDue: number | null;
  skip: number[];
  /**
   * The check being set for a day, made once and kept before it is sent: a lost answer is asked
   * again with the same id, never a new one (QA-44 Orta 3).
   */
  day?: { due: number; id: string };
}

/** A plan's id for the check of `due`: the one already made for it, or a new one. */
export function dayIdOf(plan: Pick<CheckPlan, 'day'>, due: number, fresh: () => string): string {
  return plan.day?.due === due ? plan.day.id : fresh();
}

/**
 * The server's open checks this phone does not know (an answer that never came, a check set before
 * the app was put on again): to be cancelled, so none fires unknown (QA-44 Orta 3). A fired one
 * cannot be taken back; ids still on their way are left alone.
 */
export function strayChecks(
  server: readonly { id: string; firedAt: number | null }[],
  known: ReadonlySet<string>,
): string[] {
  return server.filter((check) => check.firedAt === null && !known.has(check.id)).map((c) => c.id);
}

export const ARRIVAL = {
  /** A position counts for arriving only this fresh, and this sharp (as a meeting's "geldi"). */
  freshMs: 2 * 60_000,
  maxAccM: 100,
  /** A point on the map is "there" within this. */
  pointRadiusM: 150,
} as const;

/** Unknown permission is not consent to promise automatic arrival; only granted can do it. */
export function automaticArrivalEnabled(permission: LocationPermission): boolean {
  return permission === 'granted';
}

export const REFRESH = { movingMs: 5 * 60_000, stillMs: 15 * 60_000 } as const;
/** When the alert is said to be early: before its time by more than this (two clocks differ). */
export const EARLY_SLACK_MS = 2 * 60_000;
/** "15 dk uzat". */
export const EXTEND_MS = 15 * 60_000;

/** When the server hands the alert over: the due time and its grace. */
export function openAtOf(due: number, grace: Grace): number {
  return due + grace * 60_000;
}

/**
 * Arrived: a fresh, sharp position inside the destination. Never concluded from an old or coarse
 * one; and never "did not arrive" from anything (docs/ADR/0039 §6).
 */
export function hasArrived(check: Pick<OwnCheck, 'place'>, fix: Fix, now: number): boolean {
  if (check.place === null) return false;
  if (now - fix.ts > ARRIVAL.freshMs || fix.acc > ARRIVAL.maxAccM) return false;
  return distanceM(fix, check.place) <= check.place.radius;
}

/** Time for a refresh with the newest location: every 5 minutes moving, 15 still. */
export function refreshDue(check: Pick<OwnCheck, 'sentAt'>, moving: boolean, now: number): boolean {
  return now - check.sentAt >= (moving ? REFRESH.movingMs : REFRESH.stillMs);
}

/** What each recipient's sealed alert says now. */
export function alertOf(
  check: OwnCheck,
  last: Fix | null,
  battery: { level: number; charging: boolean } | null,
  now: number,
): Extract<ChatPayload, { kind: 'checkin' }> {
  return {
    kind: 'checkin',
    id: check.id,
    due: check.due,
    grace: check.grace,
    place: check.place === null ? null : { name: check.place.name, emoji: check.place.emoji },
    last:
      last === null
        ? null
        : { lat: last.lat, lng: last.lng, acc: Math.round(last.acc), ts: last.ts },
    bat: battery === null ? null : Math.round(Math.min(Math.max(battery.level, 0), 100)),
    chg: battery?.charging ?? null,
    ...(check.note === undefined ? {} : { note: check.note }),
    seq: check.seq,
    ts: now,
  };
}

const parseAt = (at: string) => {
  const [hours = 0, minutes = 0] = at.split(':').map(Number);
  return { hours, minutes };
};

/**
 * The next due time of a plan this phone should set now: the soonest day it runs whose time is
 * between 5 minutes and 23 hours away (so its alert is in place before the way home), not skipped
 * and not already set. Null when there is none yet.
 */
export function nextDue(plan: CheckPlan, now: number): number | null {
  const { hours, minutes } = parseAt(plan.at);
  for (let ahead = 0; ahead <= 1; ahead += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + ahead);
    day.setHours(hours, minutes, 0, 0);
    const due = day.getTime();
    if (!plan.days.includes(day.getDay())) continue;
    if (plan.skip.includes(due) || (plan.lastDue !== null && plan.lastDue >= due)) continue;
    const open = openAtOf(due, plan.grace);
    if (open - now < CHECKIN.minAheadMs || open - now > CHECKIN.maxAheadMs) continue;
    return due;
  }
  return null;
}

/** A verified "Vardı" line, kept for late alerts of this owner and check only (ADR 0039 §10). */
export interface ArrivedCheck {
  ownerId: string;
  checkinId: string;
  receivedAt: number;
}

export const ARRIVED_FOR_MS = 48 * 3_600_000;

export function pruneArrived(arrived: readonly ArrivedCheck[], now: number): ArrivedCheck[] {
  return arrived.filter((each) => now - each.receivedAt < ARRIVED_FOR_MS);
}

export function arrivedBefore(
  arrived: readonly ArrivedCheck[],
  ownerId: string,
  checkinId: string,
  now: number,
): boolean {
  return pruneArrived(arrived, now).some(
    (each) => each.ownerId === ownerId && each.checkinId === checkinId,
  );
}

/** A recipient's view of an alert they opened. */
export interface ReceivedAlert {
  checkinId: string;
  ownerId: string;
  firedAt: number;
  /** The sealed payload's revision: an older replay never replaces a newer opened box. */
  seq: number;
  due: number;
  grace: Grace;
  place: { name: string; emoji: string } | null;
  last: { lat: number; lng: number; acc: number; ts: number } | null;
  bat: number | null;
  chg: boolean | null;
  note?: string;
  /** Handed over before its own time: said on screen (docs/ADR/0039 §10). */
  early: boolean;
}

/** Highest opened payload revision, retained even after the alert leaves the visible inbox. */
export interface AlertRevision {
  ownerId: string;
  checkinId: string;
  seq: number;
  /** The same end of life as the sealed box: due + grace + 24 hours. */
  validUntil: number;
}

const ALERT_AFTER_OPEN_MS = 24 * 3_600_000;

export function alertRevisionOf(alert: ReceivedAlert): AlertRevision {
  return {
    ownerId: alert.ownerId,
    checkinId: alert.checkinId,
    seq: alert.seq,
    validUntil: openAtOf(alert.due, alert.grace) + ALERT_AFTER_OPEN_MS,
  };
}

export function pruneAlertRevisions(
  revisions: readonly AlertRevision[],
  now: number,
): AlertRevision[] {
  return revisions.filter((each) => each.validUntil > now);
}

export function receivedOf(
  opened: Extract<ChatPayload, { kind: 'checkin' }>,
  meta: { checkinId: string; ownerId: string; firedAt: number },
  now: number,
): ReceivedAlert {
  return {
    ...meta,
    seq: opened.seq,
    due: opened.due,
    grace: opened.grace,
    place: opened.place,
    last: opened.last,
    bat: opened.bat,
    chg: opened.chg,
    ...(opened.note === undefined ? {} : { note: opened.note }),
    early: now < openAtOf(opened.due, opened.grace) - EARLY_SLACK_MS,
  };
}

/** Newer revisions win; an equal revision is already known and is never replaced by a replay. */
export function mergeReceivedAlerts(
  previous: readonly ReceivedAlert[],
  opened: readonly ReceivedAlert[],
): ReceivedAlert[] {
  const kept = new Map(previous.map((alert) => [`${alert.ownerId}:${alert.checkinId}`, alert]));
  return opened.map((alert) => {
    const before = kept.get(`${alert.ownerId}:${alert.checkinId}`);
    return before !== undefined && before.seq >= alert.seq ? before : alert;
  });
}

/** How long ago, in whole minutes, the last location was (on this phone's clock). */
export function minutesAgo(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / 60_000));
}
