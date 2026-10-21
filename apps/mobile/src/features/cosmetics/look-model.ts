import { verifyCosmeticPass } from '@bargu/crypto';
import {
  type Circle,
  COSMETIC_PASS_TTL_MS,
  type CosmeticPass,
  type MemberCard,
} from '@bargu/schemas';

import { isFrameStyle, isRingPattern, type Look, type LookChoice } from './look-styles';

/**
 * The look a choice shows for `userId` (docs/ADR/0025 §3): each part only when the pass holds for
 * them now (a trusted key, theirs, in time) and names its pack, and only when this app knows the
 * style. Anything else is the plain look (null), never an error. The same for others' looks and
 * for one's own.
 */
export function lookOf(
  userId: string,
  choice: LookChoice,
  signed: CosmeticPass | null,
  keys: ReadonlyMap<string, Uint8Array>,
  now: number,
): Look | null {
  if (signed === null) return null;
  const packs = verifyCosmeticPass(signed, { keys, userId, now });
  if (packs === null) return null;
  const ring = packs.has('rings') && isRingPattern(choice.ring) ? choice.ring : undefined;
  const frame = packs.has('frames') && isFrameStyle(choice.frame) ? choice.frame : undefined;
  if (ring === undefined && frame === undefined) return null;
  return { ring, frame, until: signed.expiresAt };
}

/** A look still to show at `now` (the pass may have run out since it came). */
export const lookAt = (look: Look | null | undefined, now: number): Look | undefined =>
  look !== null && look !== undefined && look.until > now ? look : undefined;

/**
 * Whether to ask for a new pass (docs/ADR/0025 §1): none yet, less than half of its 30 days left,
 * or the account has a pack (the plan says so) that the pass does not name.
 */
export function passDue(
  pass: CosmeticPass | null,
  now: number,
  owned: readonly string[] = [],
): boolean {
  if (pass === null || pass.expiresAt - now < COSMETIC_PASS_TTL_MS / 2) return true;
  return owned.some((pack) => !pass.packs.includes(pack));
}

/** A short fingerprint of some text (FNV-1a): to tell two lists apart, not to protect anything. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Who in a circle can read what this phone sends it: the phones of its other active members that
 * this phone trusts. A new member, a new phone or a trust given after a key change makes this
 * different, so the look goes again, wherever the profile goes (docs/ADR/0025 §3).
 */
export function audienceOf(
  circle: Pick<Circle, 'members'>,
  me: string | null,
  trusted: (member: MemberCard) => boolean,
): string {
  const devices = circle.members
    .filter((member) => member.userId !== me && member.status === 'active' && trusted(member))
    .flatMap((member) => (member.device === null ? [] : [member.device.bundle.deviceId]))
    .sort();
  return fingerprint(devices.join(','));
}

/**
 * What a circle last got from this phone: sent again when its epoch, the choice, the pass or the
 * phones that can read it change.
 */
export function lookMarker(
  epoch: number,
  choice: LookChoice,
  pass: CosmeticPass | null,
  audience: string,
): string {
  return [epoch, choice.ring ?? '-', choice.frame ?? '-', pass?.issuedAt ?? '-', audience].join(
    ':',
  );
}
