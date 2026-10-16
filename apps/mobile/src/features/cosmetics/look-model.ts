import { verifyCosmeticPass } from '@bargu/crypto';
import {
  COSMETIC_PACKS,
  COSMETIC_PASS_TTL_MS,
  type CosmeticPass,
  type EdgeStyle,
  type IslandPattern,
} from '@bargu/schemas';

/** What a member looks like on the map: only what their pass gives them, until it runs out. */
export interface Look {
  island?: IslandPattern | undefined;
  edge?: EdgeStyle | undefined;
  /** The pass's end (Unix ms): after it, the plain look. */
  until: number;
}

/** What someone chose (null: the plain one), as they send it. */
export interface LookChoice {
  island: string | null;
  edge: string | null;
}

const isIsland = (id: string | null): id is IslandPattern =>
  id !== null && (COSMETIC_PACKS.islands as readonly string[]).includes(id);
const isEdge = (id: string | null): id is EdgeStyle =>
  id !== null && (COSMETIC_PACKS.edges as readonly string[]).includes(id);

/**
 * The look a choice shows for `userId` (docs/ADR/0025 §3): each part only when the pass holds for
 * them now (a trusted key, theirs, in time) and names its pack, and only when this app knows it.
 * Anything else is the plain look, never an error. The same for others' looks and for one's own.
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
  const island = packs.has('islands') && isIsland(choice.island) ? choice.island : undefined;
  const edge = packs.has('edges') && isEdge(choice.edge) ? choice.edge : undefined;
  if (island === undefined && edge === undefined) return null;
  return { island, edge, until: signed.expiresAt };
}

/** A look still to show at `now` (the pass may have run out since it came). */
export const lookAt = (look: Look | undefined, now: number): Look | undefined =>
  look !== undefined && look.until > now ? look : undefined;

/** Whether to ask for a new pass: none yet, or less than half of its 30 days left. */
export function passDue(pass: CosmeticPass | null, now: number): boolean {
  return pass === null || pass.expiresAt - now < COSMETIC_PASS_TTL_MS / 2;
}

/** What a circle last got from this phone: sent again when the epoch, the choice or the pass change. */
export function lookMarker(epoch: number, choice: LookChoice, pass: CosmeticPass | null): string {
  return [epoch, choice.island ?? '-', choice.edge ?? '-', pass?.issuedAt ?? '-'].join(':');
}
