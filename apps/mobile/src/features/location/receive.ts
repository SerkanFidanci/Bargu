import { BarguCryptoError, decryptMessage, ReplayGuard, type ReplayState } from '@bargu/crypto';
import {
  type Circle,
  locPayloadSchema,
  type MessageEnvelope,
  type Payload,
  type PokePayload,
} from '@bargu/schemas';

type StatusPayload = Extract<Payload, { kind: 'status' }>;
type ProfilePayload = Extract<Payload, { kind: 'profile' }>;
type ArrivedPayload = Extract<Payload, { kind: 'arrived' }>;
type LookPayload = Extract<Payload, { kind: 'look' }>;
type PlaceEventPayload = Extract<Payload, { kind: 'place_enter' | 'place_exit' }>;
type LatePayload = Extract<Payload, { kind: 'late' }>;
type SafePayload = Extract<Payload, { kind: 'safe' }>;
type StatePayload = Extract<Payload, { kind: 'state' }>;
import { z } from 'zod';
import { create } from 'zustand';

import { verifiedBundle } from '../keys/bundle-cache';
import type { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';
import { probe, timed } from './probe';
import { type ReceivedState, receivedStateSchema, useStates } from './why';

const receivedSchema = z
  .object({
    circleId: z.string(),
    userId: z.string(),
    loc: locPayloadSchema,
    receivedAt: z.number(),
  })
  .strict();

/** A member's latest location as received in one circle. */
export type ReceivedLocation = z.infer<typeof receivedSchema>;

/** Everyone's latest location per circle, keyed `${circleId}:${userId}` (screens read this). */
export const useLocations = create<Record<string, ReceivedLocation>>(() => ({}));

const REPLAY_KEY = 'replay:v1';
/**
 * The latest location of each member, kept in the encrypted vault: after a restart the replay
 * guard rightly refuses envelopes already opened, so the map starts from this copy instead.
 * Only the newest one per person and circle is kept; it never leaves the phone.
 */
const LOCATIONS_KEY = 'locations:v1';
/**
 * The latest reason each member gave for an old location (docs/ADR/0028 "Neden eski?"), kept like
 * the locations: the relay does not keep it, and the replay guard refuses what was opened before.
 * It holds no position.
 */
const STATES_KEY = 'states:v1';
const entryKey = (circleId: string, userId: string) => `${circleId}:${userId}`;
/**
 * A location measured up to this long before the one shown arrived late (the relay's snapshot
 * after a reconnection, an older position sent after a newer one): it is not shown, the person
 * would step back on the map. Older still, the sender's clock was put back: it is shown
 * (docs/ADR/0028). The same time again replaces it (a coarser precision for the same position).
 */
const LATE_WITHIN_MS = 10 * 60_000;

export type Outcome = 'shown' | 'removed' | 'bumped' | 'waiting' | 'ignored';

/**
 * The live route a message came by, named after the relay's event (apps/api relay): the server
 * cannot tell what a message is, so the phone binds the two. A message is shown only as the kind its
 * route is for; any other (a location sent through the poke or "Güvendeyim" route, which skip the
 * paused-circle check and the limits of the location route; a poke through the safe route) is
 * dropped. A route that is not known (nothing says it) never shows a "Güvendeyim" (docs/ADR/0029 §8)
 * nor a `state` ("Neden eski?", docs/ADR/0028): the reason for an old location has a route of its
 * own, and the other routes skip its paused-circle check and its limit.
 */
export type Route = 'loc' | 'bump' | 'safe' | 'place' | 'status' | 'profile' | 'look' | 'state';
const ROUTE_KINDS: Readonly<Record<Route, readonly Payload['kind'][]>> = {
  loc: ['loc', 'share_stop'],
  bump: ['bump', 'poke'],
  safe: ['safe'],
  place: ['place_enter', 'place_exit', 'late', 'arrived'],
  status: ['status'],
  profile: ['profile'],
  look: ['look'],
  state: ['state'],
};

/** Whether a message of this kind may come by this route. */
export function kindFitsRoute(kind: Payload['kind'], route: Route | undefined): boolean {
  if (route === undefined) return kind !== 'safe' && kind !== 'state';
  return ROUTE_KINDS[route].includes(kind);
}

export interface ReceiverDeps {
  keys: () => KeyStore;
  /** Circles as currently known (cache); a circle missing here is waited for. */
  circles: () => readonly Circle[];
  store: () => KeyValueStore;
  /** A member poked this phone (BARGU_PLAN §4.3 "Dürt"). */
  onBump?: (circleId: string, userId: string, ts: number) => void;
  /** A member poked someone with a feeling or a question (docs/ADR/0031): shown only if for me. */
  onPoke?: (circleId: string, userId: string, poke: PokePayload) => void;
  /** A member set or changed their status (emoji and short text). */
  onStatus?: (circleId: string, userId: string, status: StatusPayload) => void;
  /** A member's profile message (their photo key, docs/ADR/0014). */
  onProfile?: (userId: string, profile: ProfilePayload, senderDeviceId: string) => void;
  /** A member's look: the cosmetics they chose and the server's pass (docs/ADR/0025). */
  onLook?: (userId: string, look: LookPayload) => void;
  /** A member arrived at or left one of the circle's places (docs/ADR/0015). */
  onPlace?: (circleId: string, userId: string, event: PlaceEventPayload) => void;
  /** A member will be late to the event's meeting (docs/ADR/0018). */
  onLate?: (circleId: string, userId: string, late: LatePayload) => void;
  /** A member says they are at the circle's meeting ("Geldim", docs/ADR/0026 §5). */
  onArrived?: (circleId: string, userId: string, arrived: ArrivedPayload) => void;
  /** A member told the circle they are safe ("Güvendeyim", docs/ADR/0029). */
  onSafe?: (circleId: string, userId: string, safe: SafePayload) => void;
  /** A moment for the screen between two slices of a batch (a frame); the default is a timer. */
  pause?: () => Promise<void>;
  now?: () => number;
}

/**
 * Messages opened in one go before the screen gets a moment: a few take about a frame on a phone
 * (each is a signature check and a decryption in JavaScript), so a snapshot of dozens never stops
 * the map for longer than that.
 */
const SLICE = 5;

/**
 * A member who may be on this phone's map: active in a circle this phone is active in, one that
 * somebody keeps open (a paused circle shows nobody, docs/ADR/0024).
 */
function isVisible(circles: readonly Circle[], circleId: string, userId: string): boolean {
  const circle = circles.find((candidate) => candidate.id === circleId);
  return (
    circle?.myStatus === 'active' &&
    circle.paused !== true &&
    circle.members.some((member) => member.userId === userId && member.status === 'active')
  );
}

/**
 * Opens location messages addressed to circles this phone is in (BARGU_PLAN §3.3 receiver):
 * signature, sender key and replay window checked by decryptMessage. A message whose sender key
 * has not arrived yet waits (one per sender) and is tried again after the next key sync; messages
 * from a member whose identity key changed are ignored until the user accepts the change.
 */
export function createReceiver({
  keys,
  circles,
  store,
  onBump,
  onPoke,
  onStatus,
  onProfile,
  onLook,
  onPlace,
  onLate,
  onArrived,
  onSafe,
  pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  now = Date.now,
}: ReceiverDeps) {
  let replay: ReplayGuard | null = null;
  const waiting = new Map<string, { envelope: MessageEnvelope; route: Route | undefined }>();
  /** Locations that came in while a snapshot was being opened: that snapshot must not drop them. */
  const windows = new Set<Set<string>>();
  /** Counts sign-outs, so a batch being opened in slices stops when one happens. */
  let run = 0;

  function guard(): ReplayGuard {
    if (replay === null) {
      const raw = store().get(REPLAY_KEY);
      replay = new ReplayGuard(raw === undefined ? {} : (JSON.parse(raw) as ReplayState));
    }
    return replay;
  }

  function replaceLocations(next: Record<string, ReceivedLocation>): void {
    useLocations.setState(next, true);
    store().set(LOCATIONS_KEY, JSON.stringify(Object.values(next)));
  }

  function replaceStates(next: Record<string, ReceivedState>): void {
    useStates.setState(next, true);
    store().set(STATES_KEY, JSON.stringify(Object.values(next)));
  }

  /** Keeps the locations, and the reasons of the same people, that the predicate keeps. */
  function keep(predicate: (entry: { circleId: string; userId: string }) => boolean): void {
    const current = useLocations.getState();
    const kept = Object.fromEntries(
      Object.entries(current).filter(([, entry]) => predicate(entry)),
    );
    if (Object.keys(kept).length !== Object.keys(current).length) replaceLocations(kept);
    const states = useStates.getState();
    const keptStates = Object.fromEntries(
      Object.entries(states).filter(([, entry]) => predicate(entry)),
    );
    if (Object.keys(keptStates).length !== Object.keys(states).length) replaceStates(keptStates);
  }

  /**
   * A member says why their location is old. Only the newest counts (it may arrive late), and a
   * time ahead of this phone's clock is not believed: it would keep a reason alive for ever.
   */
  function setReason(circleId: string, userId: string, payload: StatePayload): Outcome {
    const at = now();
    const key = entryKey(circleId, userId);
    const ts = Math.min(payload.ts, at);
    const held = useStates.getState()[key];
    if (held !== undefined && ts < held.ts) return 'ignored';
    replaceStates({
      ...useStates.getState(),
      [key]: {
        circleId,
        userId,
        why: payload.why,
        since: Math.min(payload.since, ts),
        ts,
        receivedAt: at,
      },
    });
    return 'shown';
  }

  function set(entry: ReceivedLocation): void {
    for (const touched of windows) touched.add(entryKey(entry.circleId, entry.userId));
    replaceLocations({
      ...useLocations.getState(),
      [entryKey(entry.circleId, entry.userId)]: entry,
    });
  }

  function remove(circleId: string, userId: string): void {
    keep((entry) => entry.circleId !== circleId || entry.userId !== userId);
  }

  function persistReplay(current: ReplayGuard): void {
    store().set(REPLAY_KEY, JSON.stringify(current.toJSON()));
  }

  function receive(envelope: MessageEnvelope, route?: Route): Outcome {
    // A reason waiting for a key has a place of its own: it must not push out the location that
    // waits beside it (one per sender, the newest, for each).
    const waitKey = `${envelope.circleId}:${envelope.senderDeviceId}${route === 'state' ? ':state' : ''}`;
    const circle = circles().find((candidate) => candidate.id === envelope.circleId);
    const sender = circle?.members.find(
      (member) => member.device?.bundle.deviceId === envelope.senderDeviceId,
    );
    const keyStore = keys();
    const senderKey = keyStore.receivedKey(
      envelope.circleId,
      envelope.epoch,
      envelope.senderDeviceId,
    );
    const device = sender?.device ?? null;
    if (circle === undefined || sender === undefined || device === null || senderKey === null) {
      // Keys or membership not here yet: keep the newest one per sender for the next sync.
      waiting.set(waitKey, { envelope, route });
      return 'waiting';
    }
    waiting.delete(waitKey);
    if (!keyStore.trusted(sender)) return 'ignored';
    const replayGuard = guard();
    // Already opened (a snapshot after a restart or a short drop hands over what this phone has):
    // decryptMessage refuses it as a replay in the end, after a bundle check, a signature check
    // and the replay window. The answer is the same, so nothing is spent finding it out.
    if (
      replayGuard.check(
        envelope.circleId,
        envelope.senderDeviceId,
        envelope.epoch,
        envelope.seq,
      ) === 'replay'
    ) {
      return 'ignored';
    }
    try {
      const payload = decryptMessage({
        envelope,
        senderKey,
        sender: verifiedBundle(device.bundle),
        replay: replayGuard,
      });
      persistReplay(replayGuard);
      // Opened and recorded, but not by this route: nothing of it is shown or done.
      if (!kindFitsRoute(payload.kind, route)) return 'ignored';
      if (payload.kind === 'loc') {
        const shown = useLocations.getState()[entryKey(circle.id, sender.userId)]?.loc.ts;
        const late =
          shown !== undefined && payload.ts < shown && shown - payload.ts <= LATE_WITHIN_MS;
        const at = now();
        probe.current?.received({
          userId: sender.userId,
          ts: payload.ts,
          acc: payload.acc,
          at,
          ignored: late,
        });
        if (late) return 'ignored';
        set({ circleId: circle.id, userId: sender.userId, loc: payload, receivedAt: at });
        return 'shown';
      }
      if (payload.kind === 'share_stop') {
        remove(circle.id, sender.userId);
        return 'removed';
      }
      if (payload.kind === 'profile') {
        onProfile?.(sender.userId, payload, envelope.senderDeviceId);
        return 'shown';
      }
      if (payload.kind === 'look') {
        onLook?.(sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'status') {
        onStatus?.(circle.id, sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'bump') {
        onBump?.(circle.id, sender.userId, payload.ts);
        return 'bumped';
      }
      if (payload.kind === 'poke') {
        onPoke?.(circle.id, sender.userId, payload);
        return 'bumped';
      }
      if (payload.kind === 'place_enter' || payload.kind === 'place_exit') {
        onPlace?.(circle.id, sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'late') {
        onLate?.(circle.id, sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'arrived') {
        onArrived?.(circle.id, sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'safe') {
        onSafe?.(circle.id, sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'state') return setReason(circle.id, sender.userId, payload);
      return 'ignored';
    } catch (error) {
      if (error instanceof BarguCryptoError) {
        // STALE is the one refusal that advanced the replay window (the message was authentic and
        // is now recorded): keep it. A forged or replayed one changed nothing, so nothing is written.
        if (error.code === 'STALE') persistReplay(replayGuard);
        return 'ignored';
      }
      throw error;
    }
  }

  /**
   * Opens a batch a few at a time (SLICE), leaving the screen a moment between slices, so dozens
   * of messages after a start or a reconnection never hold the JavaScript thread for long.
   */
  async function receiveAll(envelopes: readonly MessageEnvelope[], route?: Route): Promise<void> {
    const started = run;
    for (let start = 0; start < envelopes.length; start += SLICE) {
      if (start > 0) {
        await pause();
        // Signed out meanwhile: nothing of this batch may reach the next account.
        if (run !== started) return;
      }
      timed('receive.slice', () => {
        for (const envelope of envelopes.slice(start, start + SLICE)) receive(envelope, route);
      });
    }
  }

  return {
    receive,

    /** The locations this phone had before a restart (shown until fresher ones arrive). */
    restore(): void {
      const states = store().get(STATES_KEY);
      if (states !== undefined) {
        const parsedStates = z.array(receivedStateSchema).safeParse(JSON.parse(states));
        if (parsedStates.success) {
          useStates.setState(
            Object.fromEntries(
              parsedStates.data.map((entry) => [entryKey(entry.circleId, entry.userId), entry]),
            ),
            true,
          );
        }
      }
      const raw = store().get(LOCATIONS_KEY);
      if (raw === undefined) return;
      const parsed = z.array(receivedSchema).safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      useLocations.setState(
        Object.fromEntries(
          parsed.data.map((entry) => [entryKey(entry.circleId, entry.userId), entry]),
        ),
        true,
      );
    },

    /**
     * Snapshot after (re)connecting: every member's latest envelope on the server. A location the
     * server no longer has (expired after 24 hours, taken back, member gone) goes from the map too.
     */
    async receiveSnapshot(envelopes: readonly MessageEnvelope[]): Promise<void> {
      const touched = new Set<string>();
      windows.add(touched);
      try {
        await receiveAll(envelopes, 'loc');
      } finally {
        windows.delete(touched);
      }
      const known = circles();
      const onServer = new Set(
        envelopes.map((envelope) => `${envelope.circleId}:${envelope.senderDeviceId}`),
      );
      keep((entry) => {
        // A location that came in live while the slices were being opened is newer than the snapshot.
        if (touched.has(entryKey(entry.circleId, entry.userId))) return true;
        const circle = known.find((candidate) => candidate.id === entry.circleId);
        const member = circle?.members.find((candidate) => candidate.userId === entry.userId);
        const deviceId = member?.device?.bundle.deviceId;
        return deviceId !== undefined && onServer.has(`${entry.circleId}:${deviceId}`);
      });
    },

    /** Statuses and profiles after (re)connecting: opened in slices, as the snapshot is. */
    receiveAll,

    /** After key or membership sync: messages that waited for a sender key get another try. */
    retryWaiting(): void {
      for (const entry of [...waiting.values()]) receive(entry.envelope, entry.route);
    },

    /** The relay says a member's location is gone (left, removed, hidden). */
    gone(circleId: string, userId: string): void {
      remove(circleId, userId);
    },

    /** The relay says a member's reason is gone (they left the circle, or took their location back). */
    stateGone(circleId: string, userId: string): void {
      const states = useStates.getState();
      const key = entryKey(circleId, userId);
      if (states[key] === undefined) return;
      replaceStates(Object.fromEntries(Object.entries(states).filter(([held]) => held !== key)));
    },

    /**
     * A person this phone shares no circle with any more (forget-person.ts): their locations and
     * reasons here and in the vault, what waited for a key from their devices, and the replay
     * window of those devices (no message of theirs can be opened again: no key, no membership).
     */
    forgetPerson(userId: string, deviceIds: ReadonlySet<string>): void {
      keep((entry) => entry.userId !== userId);
      for (const [key, held] of [...waiting]) {
        if (deviceIds.has(held.envelope.senderDeviceId)) waiting.delete(key);
      }
      const current = guard();
      if (current.forgetSenders(deviceIds) > 0) persistReplay(current);
    },

    /** Circles or members changed: only active members of active circles stay on the map. */
    prune(): void {
      const known = circles();
      keep((entry) => isVisible(known, entry.circleId, entry.userId));
      for (const key of [...waiting.keys()]) {
        const circleId = key.slice(0, key.indexOf(':'));
        if (!known.some((circle) => circle.id === circleId && circle.myStatus === 'active')) {
          waiting.delete(key);
        }
      }
    },

    /** Sign-out (the vault is destroyed with everything in it). */
    reset(): void {
      run += 1;
      replay = null;
      waiting.clear();
      useLocations.setState({}, true);
      useStates.setState({}, true);
    },
  };
}

export type Receiver = ReturnType<typeof createReceiver>;

/**
 * One dot per person on the map: of their locations in different circles (each possibly at a
 * different precision), the most precise among the recent ones, else the newest.
 */
export function bestPerPerson(
  locations: Readonly<Record<string, ReceivedLocation>>,
  recentMs = 60_000,
): ReceivedLocation[] {
  const byUser = new Map<string, ReceivedLocation[]>();
  for (const entry of Object.values(locations)) {
    byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]);
  }
  return [...byUser.values()].map((entries) => {
    const newest = Math.max(...entries.map((entry) => entry.loc.ts));
    const recent = entries.filter((entry) => newest - entry.loc.ts <= recentMs);
    return recent.reduce((best, entry) => (entry.loc.acc < best.loc.acc ? entry : best));
  });
}
