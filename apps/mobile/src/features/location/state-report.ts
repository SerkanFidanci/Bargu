import { type DeviceKeys, encryptMessage } from '@bargu/crypto';
import type { MessageEnvelope, PublishReply, StatePayload } from '@bargu/schemas';

import type { KeyStore } from '../keys/key-store';
import type { SendCircle } from './engine';
import { SEND_RULES } from './send';
import type { Why } from './why';

/**
 * No position of any kind for this long, with nothing else to blame: "Konum alınamıyor". Well
 * under the ten minutes after which a friend's pin turns grey, so the reason is there by then. To
 * be measured on a phone ("ayarlanacak", docs/ADR/0028).
 */
export const NOFIX_AFTER_MS = 3 * 60_000;
/**
 * The least between two messages to one circle. The relay allows three a minute per circle on the
 * state route (RELAY_LIMITS.states): a setting flipped back and forth never gets near that, and one
 * more is room for the message that goes out when the connection returns. To be tuned on a phone
 * ("ayarlanacak", docs/ADR/0028).
 */
export const STATE_GAP_MS = 45_000;
/** After a message that did not get through (offline, refused, over the relay's limit). */
export const RETRY_MS = 60_000;

/** What the phone knows about itself that keeps its location from being fresh. */
export interface Signals {
  /** The location permission is off or was taken back (not just never asked). */
  permissionOff: boolean;
  /** The phone's location services are switched off. */
  servicesOff: boolean;
  /** Battery saver: the system keeps the location service from reporting. */
  saver: boolean;
}

export const NO_SIGNALS: Signals = { permissionOff: false, servicesOff: false, saver: false };

/**
 * The reason, if any, most telling first: without the permission nothing else matters; with the
 * services off no position can be had; battery saver is why they are rare; and when none of these
 * is known but nothing has come in for a while, no position can be had either (`silent`).
 */
export function reasonOf(signals: Signals, silentMs: number): { why: Why; silent: boolean } | null {
  if (signals.permissionOff) return { why: 'permission', silent: false };
  if (signals.servicesOff) return { why: 'nofix', silent: false };
  if (signals.saver) return { why: 'saver', silent: false };
  if (silentMs >= NOFIX_AFTER_MS) return { why: 'nofix', silent: true };
  return null;
}

export interface ReporterDeps {
  keys: () => KeyStore;
  device: () => DeviceKeys | null;
  /** The circles this phone's location goes to now (the engine's own list: ghost, time, pause). */
  audience: () => readonly SendCircle[];
  /** Some circle holds an old location of this phone that a reason could explain. */
  holding: () => boolean;
  /** One message to one circle, by the state route; throws when it did not get there. */
  send: (envelope: MessageEnvelope) => Promise<PublishReply>;
  /** The relay refused some circles (old epoch, no longer a member, paused): ask for them again. */
  outdated?: (circleIds: string[]) => void;
  /**
   * What the circles are being told now, or null: for the user's own card ("Arkadaşların seni
   * şöyle görüyor"), so what a friend sees of this phone is not a secret from its owner. Called
   * when it changes.
   */
  sending?: (current: { why: Why; since: number } | null) => void;
  now?: () => number;
}

/**
 * The sending half of "Neden eski?" (docs/ADR/0028): tells the circles this phone shares with why
 * its location may be old. A `state` message goes out when a reason starts or changes, again with
 * the 5-minute heartbeat while it lasts (the relay keeps nothing; the receiver lets a reason lapse
 * when it is not renewed), and a clear (`why: none`) when it ends. It carries no position. Nothing
 * goes to a circle the location does not go to (ghost, sharing off, time up, paused), whatever the
 * precision: the message is the same reason for every circle.
 *
 * It is a loop that brings what each circle was told in line with what is so now (`reconcile`),
 * started by what changes (a setting, the permission, a circle, a position that came in) and by its
 * own timer for the heartbeat and the silence: nothing is polled.
 */
export function createStateReporter(deps: ReporterDeps) {
  const now = deps.now ?? Date.now;
  let signals: Signals = NO_SIGNALS;
  let lastSample = now();
  let reason: { why: Why; since: number; silent: boolean } | null = null;
  /** What each circle was last told, since when that reason holds, and when it was told. */
  const told = new Map<string, { why: Why; since: number; at: number }>();
  let sendingKey = '';
  /** Not before this time may the circle be told again. */
  const nextAt = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  /** How many times a pass was asked for; a pass that sees it moved on runs once more. */
  let requests = 0;

  /** The reason now, keeping `since` while it stays the same one. */
  function update(at: number, hasAudience: boolean): void {
    const found = hasAudience ? reasonOf(signals, at - lastSample) : null;
    if (found === null) {
      reason = null;
    } else if (reason?.why !== found.why || reason.silent !== found.silent) {
      reason = { ...found, since: found.silent ? lastSample : at };
    }
  }

  /** Who is to be told now, and when to look again. */
  function plan(at: number): { due: SendCircle[]; wakeAt: number | null } {
    const circles = deps.holding() ? deps.audience() : [];
    update(at, circles.length > 0);
    // A circle that no longer gets the location is told nothing, and what it was told is forgotten.
    const ids = new Set(circles.map((circle) => circle.id));
    for (const id of [...told.keys()]) if (!ids.has(id)) told.delete(id);
    for (const id of [...nextAt.keys()]) if (!ids.has(id)) nextAt.delete(id);
    const due: SendCircle[] = [];
    let wakeAt: number | null = null;
    const wake = (when: number) => {
      wakeAt = wakeAt === null ? when : Math.min(wakeAt, when);
    };
    for (const circle of circles) {
      const sent = told.get(circle.id);
      const beat = sent === undefined ? null : sent.at + SEND_RULES.heartbeatMs;
      const needed =
        reason === null
          ? sent !== undefined
          : sent?.why !== reason.why || (beat !== null && at >= beat);
      if (!needed) {
        if (reason !== null && beat !== null) wake(beat);
        continue;
      }
      const allowed = nextAt.get(circle.id) ?? 0;
      if (allowed > at) wake(allowed);
      else due.push(circle);
    }
    // Nothing to say yet, but a silence long enough would be one.
    if (circles.length > 0 && reason === null) wake(lastSample + NOFIX_AFTER_MS);
    return { due, wakeAt };
  }

  async function pass(): Promise<void> {
    const { due } = plan(now());
    const device = deps.device();
    if (due.length === 0 || device === null) return;
    const saying = reason;
    const outdated: string[] = [];
    for (const circle of due) {
      const at = now();
      const payload: StatePayload =
        saying === null
          ? { kind: 'state', why: 'none', since: at, ts: at }
          : { kind: 'state', why: saying.why, since: saying.since, ts: at };
      let accepted = false;
      try {
        const keys = deps.keys();
        const envelope = encryptMessage({
          state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
          sender: device,
          payload,
        }).envelope;
        const reply = await deps.send(envelope);
        const refusal = reply.refused.find((refused) => refused.circleId === circle.id)?.code;
        if (refusal === undefined) {
          accepted = reply.accepted > 0;
        } else if (refusal === 'EPOCH' || refusal === 'NOT_MEMBER' || refusal === 'PAUSED') {
          outdated.push(circle.id);
        }
      } catch {
        // Offline or refused: tried again after RETRY_MS, or at once when the connection returns.
      }
      const sentAt = now();
      if (!accepted) {
        nextAt.set(circle.id, sentAt + RETRY_MS);
      } else {
        nextAt.set(circle.id, sentAt + STATE_GAP_MS);
        if (saying === null) told.delete(circle.id);
        else told.set(circle.id, { why: saying.why, since: saying.since, at: sentAt });
      }
    }
    if (outdated.length > 0) deps.outdated?.(outdated);
  }

  /** The next time something is due: the heartbeat, a wait that ends, or a silence long enough. */
  function arm(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const { wakeAt } = plan(now());
    announce();
    if (wakeAt === null) return;
    timer = setTimeout(
      () => {
        timer = null;
        void reconcile();
      },
      Math.max(0, wakeAt - now()),
    );
  }

  /** Tells the owner's own card what the circles hold of this phone now (the newest word). */
  function announce(): void {
    let newest: { why: Why; since: number; at: number } | null = null;
    for (const entry of told.values()) if (newest === null || entry.at > newest.at) newest = entry;
    const key = newest === null ? '' : `${newest.why}:${String(newest.since)}`;
    if (key === sendingKey) return;
    sendingKey = key;
    deps.sending?.(newest === null ? null : { why: newest.why, since: newest.since });
  }

  function reconcile(): Promise<void> {
    requests += 1;
    if (running !== null) return running;
    running = (async () => {
      try {
        // Asked again while a pass was going: one more pass, with what is so by then.
        let seen: number;
        do {
          seen = requests;
          await pass();
        } while (requests !== seen);
      } catch {
        // Nothing here may stop the location from being shared.
      } finally {
        running = null;
        arm();
      }
    })();
    return running;
  }

  return {
    /** What the phone knows about itself changed (permission, services, battery saver). */
    set(next: Partial<Signals>): Promise<void> {
      signals = { ...signals, ...next };
      return reconcile();
    },

    /** A raw position came in (from the location service or the 1-second watch). */
    sampled(at: number): void {
      lastSample = at;
      // Only a silence ends by a position; the other reasons end by their own signal.
      if (reason?.silent === true) void reconcile();
    },

    /** Sharing, circles or what the circles hold changed. */
    changed(): Promise<void> {
      return reconcile();
    },

    /** Back online: what did not get through goes out now. */
    flush(): Promise<void> {
      nextAt.clear();
      return reconcile();
    },

    /** The reason now, if any (a diagnostic for tests; nothing else reads it). */
    current(): Why | null {
      return reason?.why ?? null;
    },

    /** Sign-out: nothing carries over. */
    reset(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signals = NO_SIGNALS;
      reason = null;
      lastSample = now();
      told.clear();
      nextAt.clear();
      announce();
    },
  };
}

export type StateReporter = ReturnType<typeof createStateReporter>;
