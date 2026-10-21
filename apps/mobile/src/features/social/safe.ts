import {
  applyPrecision,
  type DeviceKeys,
  encryptMessage,
  generateMessageId,
  type PrecisionLevel,
} from '@bargu/crypto';
import {
  type Circle,
  safeIdSchema,
  type SafePayload,
  safeReplySchema,
  type SafeRequest,
} from '@bargu/schemas';
import { z } from 'zod';

import i18n from '@/i18n';

import { memberName, partnerOf } from '../circles/names';
import type { KeyStore } from '../keys/key-store';
import { circleSharing, isSharingWith, type SharingSettings } from '../location/sharing';
import type { PushContacts } from '../notifications/push-contacts';
import { sealPushes } from '../places/presence';
import type { KeyValueStore } from '../storage/vault';
import { keepSpot, type SafeSpot } from './safe-spot';

/**
 * "Güvendeyim" on this phone (docs/ADR/0029): one tap tells the circles the user picked that they
 * are safe, with where they are and the battery. The location is made per circle at THAT circle's
 * precision before anything is sealed; a message that cannot go yet (no connection) waits in the
 * encrypted vault and goes once when the connection returns.
 */

/** A message that has waited this long is not sent any more: the server forgets ids after a day. */
export const SAFE_KEEP_MS = 24 * 60 * 60_000;
/** A message older than this when it arrives is not shown (the notification service is a day too). */
export const SAFE_FRESH_MS = 24 * 60 * 60_000;
/** The words carry the time once the message is older than this (it waited for a connection). */
export const SAFE_LATE_MS = 5 * 60_000;
/** How many ids of shown messages this phone keeps, to show each once. */
const SEEN_KEEP = 100;
/** How many outcomes of sent messages are kept in memory for the report of a tap. */
const FATES_KEEP = 50;

/** Waiting messages, one key each: `safe:out:{id}`. */
const OUT_PREFIX = 'safe:out:';
/** The circles ticked last time. */
export const SAFE_CHOICE_KEY = 'safe:choice:v1';
/** Ids of the messages shown, newest last. */
export const SAFE_SEEN_KEY = 'safe:seen:v1';

/** A message waiting to be sent: its inputs, the location already at the circle's precision. */
const queuedSchema = z
  .object({
    id: safeIdSchema,
    circleId: z.uuid(),
    lat: z.number(),
    lng: z.number(),
    acc: z.number(),
    bat: z.number().int(),
    /** When the user tapped. */
    ts: z.number(),
  })
  .strict();
export type QueuedSafe = z.infer<typeof queuedSchema>;

/** The position a message is made from (a fix of the location engine, or a one-off). */
export interface SafeFix {
  lat: number;
  lng: number;
  /** Metres. */
  acc: number;
  ts: number;
}

const outKey = (id: string) => `${OUT_PREFIX}${id}`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---- What the sheet shows ------------------------------------------------------------------

/** A circle the user can tell. */
export interface SafeRow {
  circleId: string;
  /** The friend for a friendship, else the circle's name. */
  title: string;
  /** It gets the neighbourhood or city cell, not the exact place ("yaklaşık konum"). */
  coarse: boolean;
  /** It does not get this phone's location now (ghost mode, sharing off or over): this is a one-off. */
  unshared: boolean;
}

/**
 * The circles one can tell: those this phone is in, with somebody else active in them, and an event
 * that has not ended. A paused circle is among them (a safety feature works there, docs/ADR/0024).
 */
export function safeRows(
  circles: readonly Circle[],
  settings: SharingSettings,
  me: string | null,
  now: number,
): SafeRow[] {
  return circles
    .filter(
      (circle) =>
        circle.myStatus === 'active' &&
        circle.members.some((member) => member.userId !== me && member.status === 'active') &&
        (circle.expiresAt === undefined || circle.expiresAt > now),
    )
    .map((circle) => {
      const partner = partnerOf(circle, me);
      return {
        circleId: circle.id,
        title: partner === undefined ? (circle.name ?? '') : memberName(partner),
        coarse: circleSharing(settings, circle.id).precision !== 'exact',
        unshared: !isSharingWith(settings, circle.id, now),
      };
    });
}

/** The circles remembered from last time, if the phone has any memory of it. */
export function loadChoice(store: KeyValueStore): string[] | null {
  const raw = store.get(SAFE_CHOICE_KEY);
  if (raw === undefined) return null;
  const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export function saveChoice(store: KeyValueStore, circleIds: readonly string[]): void {
  store.set(SAFE_CHOICE_KEY, JSON.stringify(circleIds));
}

/**
 * What is ticked when the sheet opens: last time's choice, as far as those circles are still
 * there. Without a memory, the circles that get this phone's location anyway; a circle that came
 * since is never ticked for the user.
 */
export function initialSelection(rows: readonly SafeRow[], remembered: string[] | null): string[] {
  if (remembered === null) return rows.filter((row) => !row.unshared).map((row) => row.circleId);
  return rows.filter((row) => remembered.includes(row.circleId)).map((row) => row.circleId);
}

/**
 * Whether the user is asked first ("Konumun bu kez paylaşılacak"): a ghost, or a circle that does
 * not get the location now, is about to get it, once. The ghost mode itself stays as it is.
 */
export function needsConfirm(rows: readonly SafeRow[], selected: readonly string[]): boolean {
  return rows.some((row) => selected.includes(row.circleId) && row.unshared);
}

// ---- The words -----------------------------------------------------------------------------

/**
 * "Ayşe: İyiyim ✓ · %45", in the phone's language; with the time when it came late. The receiving
 * phone writes it (the notification carries no text, docs/ADR/0016).
 */
export function safeWords(input: { name: string; bat: number; ts: number; now: number }): string {
  const { name, bat, ts, now } = input;
  if (now - ts <= SAFE_LATE_MS) return i18n.t('notifications.safe', { name, bat });
  const time = new Date(ts).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return i18n.t('notifications.safeAt', { name, bat, time });
}

/**
 * Whether this message id was not shown yet; it is remembered if so. A phone that gets both the
 * message and its notification (the server sends the notification only when the app is closed,
 * but a connection can drop in between) shows it once.
 */
export function rememberSafe(store: KeyValueStore, id: string): boolean {
  const raw = store.get(SAFE_SEEN_KEY);
  const seen = z
    .array(z.string())
    .catch([])
    .parse(raw === undefined ? [] : JSON.parse(raw));
  if (seen.includes(id)) return false;
  store.set(SAFE_SEEN_KEY, JSON.stringify([...seen, id].slice(-SEEN_KEEP)));
  return true;
}

/**
 * What the open app shows of a message that came live, or null (too old, repeated, unknown): the
 * words, and the place, which is also kept for a day like one from a notification (safe-spot.ts).
 */
export interface ReceivedSafe {
  text: string;
  spot: SafeSpot;
}

export function receiveSafe(input: {
  store: KeyValueStore;
  circles: readonly Circle[];
  circleId: string;
  userId: string;
  safe: SafePayload;
  now: number;
}): ReceivedSafe | null {
  const { store, circles, circleId, userId, safe, now } = input;
  if (now - safe.ts > SAFE_FRESH_MS) return null;
  const member = circles
    .find((circle) => circle.id === circleId && circle.myStatus === 'active')
    ?.members.find((candidate) => candidate.userId === userId && candidate.status === 'active');
  if (member === undefined) return null;
  if (!rememberSafe(store, safe.id)) return null;
  const name = memberName(member);
  const spot: SafeSpot = {
    id: safe.id,
    circleId,
    name,
    lat: safe.lat,
    lng: safe.lng,
    acc: safe.acc,
    bat: safe.bat,
    ts: safe.ts,
  };
  keepSpot(store, spot, now);
  return { text: safeWords({ name, bat: safe.bat, ts: safe.ts, now }), spot };
}

// ---- Sending -------------------------------------------------------------------------------

export interface SafeDeps {
  store: () => KeyValueStore;
  keys: () => Pick<KeyStore, 'ownKey' | 'reserveSeq'>;
  device: () => DeviceKeys | null;
  circles: () => readonly Circle[];
  /** The devices to seal a notification for in a circle (trusted members). */
  recipients: (circleId: string) => PushContacts['recipients'][string];
  sharing: () => SharingSettings;
  /** Where this phone is now; null when it cannot say. */
  fix: () => Promise<SafeFix | null>;
  /** 0-100. */
  battery: () => Promise<number>;
  /** One request to the server; throws when it got no answer (offline, a server error). */
  send: (request: SafeRequest) => Promise<unknown>;
  /** The server will never take this (a bad request, an old API): it is not tried again. */
  permanent: (error: unknown) => boolean;
  /** Fetches a circle again (an epoch the phone missed, no longer a member). */
  refresh: (circleId: string) => Promise<void>;
  /** How many messages wait now (for the sheet). */
  onWaiting?: (count: number) => void;
  now?: () => number;
}

/** What `tell` did. */
export interface SafeReport {
  /** `nothing`: no circle to tell; `noLocation`: the phone cannot say where it is. */
  status: 'sent' | 'waiting' | 'noLocation' | 'nothing';
  /** Circles told. */
  sent: number;
  /** Circles whose message waits for a connection. */
  waiting: number;
  /** Circles that took no more of them for now (too often). */
  limited: number;
}

type Fate = 'sent' | 'limited' | 'dropped';

export function createSafeCheckIns(deps: SafeDeps) {
  const now = deps.now ?? Date.now;
  /** Passes run one after another, so one message is never in two requests at once. */
  let chain: Promise<unknown> = Promise.resolve();
  /** What became of the messages this run, for the report of the tap that made them. */
  const fates = new Map<string, Fate>();

  function outbox(): QueuedSafe[] {
    const store = deps.store();
    return store
      .keys()
      .filter((key) => key.startsWith(OUT_PREFIX))
      .flatMap((key) => {
        const raw = store.get(key);
        const parsed = raw === undefined ? null : queuedSchema.safeParse(JSON.parse(raw));
        if (parsed?.success !== true) {
          store.delete(key);
          return [];
        }
        return [parsed.data];
      })
      .sort((a, b) => a.ts - b.ts);
  }

  function counted(): void {
    deps.onWaiting?.(outbox().length);
  }

  function settle(item: QueuedSafe, fate: Fate): void {
    deps.store().delete(outKey(item.id));
    fates.set(item.id, fate);
    // Only the tap that made a message reads its fate; those sent on a reconnection are not read.
    if (fates.size > FATES_KEEP) {
      const oldest = fates.keys().next();
      if (oldest.done !== true) fates.delete(oldest.value);
    }
  }

  /** The sealed message and its notifications, made now: a fresh sequence number every attempt. */
  function request(item: QueuedSafe, circle: Circle, device: DeviceKeys): SafeRequest {
    const keys = deps.keys();
    const payload: SafePayload = {
      kind: 'safe',
      id: item.id,
      lat: item.lat,
      lng: item.lng,
      acc: item.acc,
      bat: item.bat,
      ts: item.ts,
    };
    const { envelope } = encryptMessage({
      state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
      sender: device,
      payload,
    });
    // The place goes in the notification too (sealed for each device, signed): a phone whose app is
    // closed shows it when the notification is tapped, and the server keeps no copy (ADR 0029 §5).
    // The same coordinates as in the message, so the same precision: this circle's.
    const pushes = sealPushes(deps.recipients(circle.id), device, {
      kind: 'safe',
      circleId: circle.id,
      id: item.id,
      bat: item.bat,
      lat: item.lat,
      lng: item.lng,
      acc: item.acc,
      ts: item.ts,
    });
    return { id: item.id, envelope, pushes };
  }

  /** Sends everything that waits, oldest first; stops at the first one that gets no answer. */
  async function pass(): Promise<void> {
    const device = deps.device();
    if (device === null) return;
    for (const item of outbox()) {
      let retried = false;
      for (;;) {
        const circle = deps.circles().find((candidate) => candidate.id === item.circleId);
        if (now() - item.ts > SAFE_KEEP_MS || circle?.myStatus !== 'active') {
          settle(item, 'dropped');
          break;
        }
        let reply;
        try {
          reply = safeReplySchema.parse(await deps.send(request(item, circle, device)));
        } catch (error) {
          if (deps.permanent(error)) {
            settle(item, 'dropped');
            break;
          }
          // No answer: everything waits for the next connection, in order.
          counted();
          return;
        }
        if ('ok' in reply) {
          settle(item, 'sent');
        } else if (reply.refused === 'RATE_LIMITED') {
          settle(item, 'limited');
        } else if (reply.refused === 'EPOCH') {
          if (!retried) {
            // The circle moved on without this phone: fetch it, and send it once more.
            retried = true;
            await deps.refresh(circle.id).catch(() => undefined);
            continue;
          }
          // Still the wrong epoch: it waits for the next connection, when the circle is current.
        } else {
          // Not a member (any more), or refused as invalid: not again.
          void deps.refresh(circle.id).catch(() => undefined);
          settle(item, 'dropped');
        }
        break;
      }
    }
    counted();
  }

  function flush(): Promise<void> {
    const run = chain.then(pass, pass);
    chain = run.catch(() => undefined);
    return run;
  }

  return {
    /**
     * Tells the chosen circles: one message each, made now (the location at that circle's
     * precision), sent at once or, with no connection, kept to be sent once when it returns. The
     * choice is remembered for next time.
     */
    async tell(circleIds: readonly string[]): Promise<SafeReport> {
      const chosen = [...new Set(circleIds)];
      saveChoice(deps.store(), chosen);
      const circles = deps.circles();
      const device = deps.device();
      const targets = chosen.flatMap((id) => {
        const circle = circles.find((candidate) => candidate.id === id);
        return circle?.myStatus === 'active' ? [circle] : [];
      });
      const empty: SafeReport = { status: 'nothing', sent: 0, waiting: 0, limited: 0 };
      if (device === null || targets.length === 0) return empty;
      const fix = await deps.fix();
      if (fix === null) return { ...empty, status: 'noLocation' };

      const at = now();
      const bat = Math.round(clamp(await deps.battery(), 0, 100));
      const settings = deps.sharing();
      const ids: string[] = [];
      for (const circle of targets) {
        // The circle's own precision, applied here and kept so: nothing finer is stored or sent.
        const precision: PrecisionLevel = circleSharing(settings, circle.id).precision;
        const placed = applyPrecision(
          {
            kind: 'loc',
            lat: fix.lat,
            lng: fix.lng,
            acc: clamp(fix.acc, 0, 1_000_000),
            bat,
            chg: false,
            ts: fix.ts,
          },
          precision,
        );
        const item: QueuedSafe = {
          id: generateMessageId(),
          circleId: circle.id,
          lat: placed.lat,
          lng: placed.lng,
          acc: placed.acc,
          bat,
          ts: at,
        };
        deps.store().set(outKey(item.id), JSON.stringify(item));
        ids.push(item.id);
      }
      counted();
      await flush().catch(() => undefined);

      const report: SafeReport = { status: 'sent', sent: 0, waiting: 0, limited: 0 };
      const stored = new Set(outbox().map((item) => item.id));
      for (const id of ids) {
        const fate = fates.get(id);
        fates.delete(id);
        if (stored.has(id)) report.waiting += 1;
        else if (fate === 'sent') report.sent += 1;
        else if (fate === 'limited') report.limited += 1;
      }
      if (report.waiting > 0) report.status = 'waiting';
      return report;
    },

    /** The connection is back (or the app started): what waits goes now. */
    flush,

    /** The number of waiting messages, told to the sheet (the app starting). */
    restore(): void {
      counted();
    },

    /** Messages waiting. */
    waiting(): number {
      return outbox().length;
    },

    /** Sign-out: the vault goes with everything in it; the counter goes to zero. */
    reset(): void {
      fates.clear();
      deps.onWaiting?.(0);
    },
  };
}

export type SafeCheckIns = ReturnType<typeof createSafeCheckIns>;
