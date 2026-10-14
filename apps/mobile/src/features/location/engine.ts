import type { DeviceKeys } from '@bargu/crypto';
import {
  type Circle,
  MAX_ENVELOPES_PER_PUBLISH,
  type MessageEnvelope,
  type PublishReply,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';
import { type Battery, buildEnvelopes, type Fix, type LastSent, shouldSend } from './send';
import { circleSharing, type SharingSettings, sharedCircles } from './sharing';

/** What sending needs of a circle; kept in the vault so a background start has it too. */
export type SendCircle = Pick<Circle, 'id' | 'epoch' | 'myStatus'> & {
  /** Someone else is active in it (nobody to send to otherwise, e.g. a request not accepted). */
  withOthers: boolean;
};

/** The sending view of a circle for the signed-in user. */
export function toSendCircle(circle: Circle, me: string | null): SendCircle {
  return {
    id: circle.id,
    epoch: circle.epoch,
    myStatus: circle.myStatus,
    withOthers: circle.members.some((member) => member.userId !== me && member.status === 'active'),
  };
}

/** Someone looked at a circle: this phone sends about once a second for this long. */
export const LIVE_MS = 2 * 60_000;

/** Circles whose server copy holds this phone's last location (to take back when it stops). */
const PUBLISHED_KEY = 'loc:published:v1';
const publishedSchema = z.array(z.string());

/** This phone's own latest position, for its marker (memory only). */
export const useMyFix = create<{ fix: Fix | null }>(() => ({ fix: null }));

export interface EngineDeps {
  keys: () => KeyStore;
  device: () => DeviceKeys | null;
  circles: () => readonly SendCircle[];
  sharing: () => SharingSettings;
  store: () => KeyValueStore;
  battery: () => Promise<Battery>;
  /** One batch to the relay (live connection or HTTP); throws when it did not get there. */
  publish: (envelopes: MessageEnvelope[]) => Promise<PublishReply>;
  /** Takes this phone's location back from these circles; throws when it did not get there. */
  withdraw: (circleIds: string[]) => Promise<void>;
  /** The relay refused some circles (old epoch, no longer a member): refresh them. */
  outdated?: (circleIds: string[]) => void;
  now?: () => number;
}

/**
 * The sending half of the location engine (BARGU_PLAN §3.3), the same whether the app is open or
 * the screen is locked: the location service hands every fix to `fix()`, which decides by the
 * frequency table whether it goes out. Only the newest unsent fix is kept while offline. Circles
 * that stop getting the location (sharing off, time up, ghost "hide") get it taken back.
 */
export function createLocationEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now;
  let last: LastSent | null = null;
  let latest: Fix | null = null;
  let pending: Fix | null = null;
  let liveUntil = 0;
  let running: Promise<void> | null = null;

  const live = () => now() < liveUntil;
  const shared = () =>
    sharedCircles(
      deps.circles().filter((circle) => circle.withOthers),
      deps.sharing(),
      now(),
    );

  function published(): Set<string> {
    const raw = deps.store().get(PUBLISHED_KEY);
    const parsed = publishedSchema.safeParse(raw === undefined ? [] : JSON.parse(raw));
    return new Set(parsed.success ? parsed.data : []);
  }

  function setPublished(ids: Set<string>): void {
    deps.store().set(PUBLISHED_KEY, JSON.stringify([...ids]));
  }

  /** Circles holding this phone's location that should not any more (a frozen ghost keeps all). */
  function toWithdraw(): string[] {
    if (deps.sharing().ghost === 'freeze') return [];
    const current = new Set(shared().map((circle) => circle.id));
    return [...published()].filter((id) => !current.has(id));
  }

  async function settle(): Promise<void> {
    const drop = toWithdraw();
    if (drop.length === 0) return;
    await deps.withdraw(drop);
    const held = published();
    for (const id of drop) held.delete(id);
    setPublished(held);
  }

  /** Sends one fix to every shared circle; false when it has to wait (offline, server error). */
  async function send(fix: Fix): Promise<boolean> {
    const device = deps.device();
    const circles = shared();
    if (device === null || circles.length === 0) return true;
    const at = now();
    const envelopes = buildEnvelopes({
      fix,
      battery: await deps.battery(),
      circles,
      settings: deps.sharing(),
      keys: deps.keys(),
      device,
      now: at,
    });
    const refused = new Set<string>();
    const outdated: string[] = [];
    try {
      for (let start = 0; start < envelopes.length; start += MAX_ENVELOPES_PER_PUBLISH) {
        const reply = await deps.publish(envelopes.slice(start, start + MAX_ENVELOPES_PER_PUBLISH));
        for (const refusal of reply.refused) {
          refused.add(refusal.circleId);
          if (refusal.code === 'EPOCH' || refusal.code === 'NOT_MEMBER')
            outdated.push(refusal.circleId);
        }
      }
    } catch {
      return false;
    }
    last = { fix, sentAt: at };
    const held = published();
    for (const circle of circles) if (!refused.has(circle.id)) held.add(circle.id);
    setPublished(held);
    if (outdated.length > 0) deps.outdated?.(outdated);
    return true;
  }

  /** Takes back what is no longer shared, then sends what is pending, one at a time. */
  function pump(): Promise<void> {
    running ??= (async () => {
      try {
        await settle().catch(() => undefined);
        while (pending !== null) {
          const next = pending;
          pending = null;
          if (!(await send(next))) {
            // A newer fix that arrived meanwhile wins; otherwise this one waits for the network.
            pending ??= next;
            return;
          }
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function fix(next: Fix): Promise<void> {
    latest = next;
    useMyFix.setState({ fix: next });
    if (shouldSend(last, next, now(), live())) {
      pending = next;
      return pump();
    }
    // Nothing to send, but a timed share may just have ended: take it back without waiting.
    if (toWithdraw().length > 0) return pump();
    return running ?? Promise.resolve();
  }

  return {
    /** A new position from the location service. */
    fix,

    /** Someone looks at one of this phone's circles: live updates for a while. */
    watched(): Promise<void> {
      liveUntil = now() + LIVE_MS;
      return latest === null ? Promise.resolve() : fix(latest);
    },

    live,

    /** Whether any circle gets this phone's location now (else the location service can stop). */
    active(): boolean {
      return shared().length > 0;
    },

    /**
     * Whether GPS is worth its battery: some circle gets the exact location. Neighbourhood and
     * city cells (1 and 10 km) are well served by Wi-Fi and cell positioning.
     */
    gps(): boolean {
      const settings = deps.sharing();
      return shared().some((circle) => circleSharing(settings, circle.id).precision === 'exact');
    },

    /** Back online: the newest unsent fix goes out. */
    flush(): Promise<void> {
      return pending === null ? (running ?? Promise.resolve()) : pump();
    },

    /**
     * Sharing settings or circles changed: take back what is no longer shared, and send the
     * latest position again at once (a new circle should not wait for the next fix, and a coarser
     * precision must replace the finer location the server still holds).
     */
    changed(): Promise<void> {
      if (latest !== null) {
        last = null;
        pending = latest;
      }
      return pump();
    },

    /** Sign-out: nothing carries over. */
    reset(): void {
      last = null;
      latest = null;
      pending = null;
      liveUntil = 0;
      useMyFix.setState({ fix: null });
    },
  };
}

export type LocationEngine = ReturnType<typeof createLocationEngine>;
