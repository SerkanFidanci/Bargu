/**
 * People whose stickers would touch closer than this (px) on screen stand together: one row of
 * stickers above one island (a sticker is 50 px wide, ui/avatar-marker.tsx).
 */
export const CLUSTER_PX = 52;
/** MapLibre's world is 512 px wide at zoom 0. */
const TILE_PX = 512;

/** A point's position on the world map at a zoom (Web Mercator pixels). */
export function worldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const size = TILE_PX * 2 ** zoom;
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export interface Cluster<T> {
  /** Stable while the same people are in it. */
  key: string;
  members: T[];
  lat: number;
  lng: number;
  /** Each member's on-screen offset (px) from the centre, for the merge animation. */
  offsets: { x: number; y: number }[];
}

/**
 * Groups people whose avatars would overlap at this zoom. Greedy and deterministic (by id): a
 * person joins the first group whose first member is within `radiusPx`. Singles are groups of one.
 */
export function clusterPeople<T extends { id: string; lat: number; lng: number }>(
  people: readonly T[],
  zoom: number,
  radiusPx = CLUSTER_PX,
): Cluster<T>[] {
  const sorted = [...people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed = sorted.map((person) => ({ person, at: worldPx(person.lat, person.lng, zoom) }));
  const used = new Set<string>();
  const clusters: Cluster<T>[] = [];
  for (const seed of placed) {
    if (used.has(seed.person.id)) continue;
    const group = placed.filter(
      (other) =>
        !used.has(other.person.id) &&
        Math.hypot(other.at.x - seed.at.x, other.at.y - seed.at.y) <= radiusPx,
    );
    for (const member of group) used.add(member.person.id);
    const cx = group.reduce((sum, member) => sum + member.at.x, 0) / group.length;
    const cy = group.reduce((sum, member) => sum + member.at.y, 0) / group.length;
    clusters.push({
      key: group.map((member) => member.person.id).join('+'),
      members: group.map((member) => member.person),
      lat: group.reduce((sum, member) => sum + member.person.lat, 0) / group.length,
      lng: group.reduce((sum, member) => sum + member.person.lng, 0) / group.length,
      offsets: group.map((member) => ({ x: member.at.x - cx, y: member.at.y - cy })),
    });
  }
  return clusters;
}

/** Avatars side by side in one capsule at most; more show one fewer and "+N" (cluster-bubble.tsx). */
export const CAPSULE_MAX = 4;

/** Who a capsule shows, in order, each with its index in the cluster, and how many more. */
export interface Capsule<T> {
  shown: { member: T; index: number }[];
  more: number;
}

/**
 * The people of a cluster as a capsule shows them side by side: the others in the cluster's own
 * (stable) order, the user last, so their own avatar is always there and always in the same place
 * (QA: the user's avatar sat on top of a friend's, proje sahibi 2026-10-16). Past CAPSULE_MAX the
 * rest are counted.
 */
export function capsuleOf<T extends { id: string }>(
  members: readonly T[],
  meId: string | null,
): Capsule<T> {
  const indexed = members.map((member, index) => ({ member, index }));
  const others = indexed.filter(({ member }) => member.id !== meId);
  const mine = indexed.filter(({ member }) => member.id === meId);
  if (indexed.length <= CAPSULE_MAX) return { shown: [...others, ...mine], more: 0 };
  const room = CAPSULE_MAX - 1 - mine.length;
  const shown = [...others.slice(0, room), ...mine];
  return { shown, more: indexed.length - shown.length };
}
