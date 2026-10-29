import { PRECISION_CELL_KM } from '@bargu/crypto';
import type { Circle } from '@bargu/schemas';

import { memberName, partnerOf } from '../circles/names';
import { distanceM } from '../location/send';
import { isSharingWith, type SharingSettings } from '../location/sharing';
import {
  type ChatItem,
  circleConversation,
  type Conversation,
  conversationTarget,
  personConversation,
} from './messages';

/** To the same circle at most this often (docs/ADR/0037 §4): it is no rain of notifications. */
export const NEAR_EVERY_MS = 10 * 60_000;
/** A group larger than this does not get it (the PM, 2026-10-29): not a crowd, a few friends. */
export const NEAR_MAX_MEMBERS = 8;
/** The sender's location is used for how far only while this fresh (docs/ADR/0037 §2). */
export const NEAR_FRESH_MS = 2 * 60_000;
/** How far, to this many metres (the PM, 2026-10-29). */
export const NEAR_ROUND_M = 50;
/**
 * A location this unsure came through a neighbourhood or a city cell (applyPrecision rounds `acc`
 * up to whole cell radii): its sender does not share exactly, so no number is written.
 */
export const NEAR_COARSE_M = Math.ceil((PRECISION_CELL_KM.neighborhood * 1000) / Math.SQRT2);

/** A circle "Yakındayım" can go to now, and when it can again if it went a moment ago. */
export interface NearTarget {
  circleId: string;
  /** A friendship's is the friend's own conversation (docs/ADR/0035 §1). */
  conversation: Conversation;
  title: string;
  /** Who it reaches, by id. */
  people: string[];
  /** Until it can go again (ms), 0 when it can now. */
  waitMs: number;
}

/**
 * Where "Yakındayım" can go (docs/ADR/0037 §3 and the PM's decisions): a friendship, or a lasting
 * circle of at most eight, with someone else in it, that this phone shares its location with right
 * now (no ghost, sharing on and not over, not paused). Never an event's circle.
 */
export function nearTargets(
  circles: readonly Circle[],
  sharing: SharingSettings,
  me: string | null,
  items: readonly ChatItem[],
  now: number,
): NearTarget[] {
  const targets: NearTarget[] = [];
  for (const circle of circles) {
    if (circle.myStatus !== 'active' || circle.kind === 'event' || circle.paused === true) continue;
    if (!isSharingWith(sharing, circle.id, now)) continue;
    const active = circle.members.filter((member) => member.status === 'active');
    const people = active.filter((member) => member.userId !== me).map((member) => member.userId);
    if (people.length === 0 || active.length > NEAR_MAX_MEMBERS) continue;
    const partner = partnerOf(circle, me);
    if (circle.kind === 'pair' && partner === undefined) continue;
    const conversation =
      partner === undefined ? circleConversation(circle.id) : personConversation(partner.userId);
    const last = Math.max(
      0,
      ...items
        // Only what went (or is going): one that failed starts no wait (QA-41).
        .filter(
          (item) =>
            item.kind === 'near' &&
            item.from === me &&
            item.conversation === conversation &&
            item.state !== 'failed',
        )
        .map((item) => item.at),
    );
    targets.push({
      circleId: circle.id,
      conversation,
      title: partner === undefined ? (circle.name ?? '') : memberName(partner),
      people,
      waitMs: Math.max(0, last + NEAR_EVERY_MS - now),
    });
  }
  return targets;
}

/**
 * The circle whose location of the sender tells how far they are: a circle's own, or for a friend's
 * conversation the friendship with them.
 */
export function nearCircleOf(
  conversation: Conversation,
  circles: readonly Circle[],
  from: string,
): string | null {
  const target = conversationTarget(conversation);
  if ('circleId' in target) return target.circleId;
  const pair = circles.find(
    (circle) => circle.kind === 'pair' && circle.members.some((member) => member.userId === from),
  );
  return pair?.id ?? null;
}

interface Spot {
  lat: number;
  lng: number;
  ts: number;
}

/**
 * How far the sender is, worked out on this phone from what it already has (docs/ADR/0037 §2):
 * their latest location in that circle and this phone's own, both fresh, to 50 m. Their location
 * through a neighbourhood or city cell, or either one old or missing: only "nearby".
 */
export function nearDistance(
  theirs: (Spot & { acc: number }) | undefined,
  mine: Spot | null,
  now: number,
): number | 'nearby' {
  if (theirs === undefined || mine === null) return 'nearby';
  if (theirs.acc >= NEAR_COARSE_M) return 'nearby';
  if (now - theirs.ts > NEAR_FRESH_MS || now - mine.ts > NEAR_FRESH_MS) return 'nearby';
  const metres = distanceM(theirs, mine);
  return Math.max(NEAR_ROUND_M, Math.round(metres / NEAR_ROUND_M) * NEAR_ROUND_M);
}
