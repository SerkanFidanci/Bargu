import { safeIdSchema } from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import { glide } from '@/theme/motion';

import type { KeyValueStore } from '../storage/vault';

/**
 * Where somebody said "Güvendeyim" (docs/ADR/0029 §5): kept on this phone only, in the encrypted
 * vault, for a day. A phone whose app is closed gets the place inside the sealed notification
 * (nothing is kept on the server); tapping the notification shows it on the map.
 */

/** A place is kept this long after the message was made (the same day a notification is good for). */
export const SPOT_KEEP_MS = 24 * 60 * 60_000;
/** At most this many places are kept: the newest. */
const SPOTS_MAX = 20;
/** The encrypted vault's key. */
export const SPOTS_KEY = 'safe:spots:v1';
/** The camera shows at least this much around a place (m): a street, not a building. */
const MIN_REACH_M = 150;
const METRES_PER_DEGREE = 111_320;

const spotSchema = z
  .object({
    /** The message's own id: the notification and the live message are one. */
    id: safeIdSchema,
    circleId: z.uuid(),
    /** Who, as this phone knew them when it came. */
    name: z.string(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Accuracy radius (m): a coarse circle's cell, or what the phone measured. */
    acc: z.number().nonnegative().max(1_000_000),
    bat: z.number().int().min(0).max(100),
    /** When the sender tapped. */
    ts: z.number(),
  })
  .strict();
export type SafeSpot = z.infer<typeof spotSchema>;

function save(store: KeyValueStore, spots: readonly SafeSpot[]): void {
  if (spots.length === 0) store.delete(SPOTS_KEY);
  else store.set(SPOTS_KEY, JSON.stringify(spots));
}

/**
 * The places kept, those older than a day gone: they are deleted from the vault here, whenever it
 * is looked at (a notification coming in, the app opening, a tap), not only left unshown.
 */
export function loadSpots(store: KeyValueStore, now: number): SafeSpot[] {
  const raw = store.get(SPOTS_KEY);
  if (raw === undefined) return [];
  let found: unknown;
  try {
    found = JSON.parse(raw);
  } catch {
    found = null;
  }
  const parsed = z.array(spotSchema).safeParse(found);
  if (!parsed.success) {
    store.delete(SPOTS_KEY);
    return [];
  }
  const alive = parsed.data.filter((spot) => now - spot.ts <= SPOT_KEEP_MS);
  if (alive.length !== parsed.data.length) save(store, alive);
  return alive;
}

/** Keeps a place (one per message), and forgets the ones that are a day old. */
export function keepSpot(store: KeyValueStore, spot: SafeSpot, now: number): void {
  const others = loadSpots(store, now).filter((kept) => kept.id !== spot.id);
  save(store, now - spot.ts > SPOT_KEEP_MS ? others : [...others, spot].slice(-SPOTS_MAX));
}

/** The place of a message, if this phone still has it. */
export function spotOf(store: KeyValueStore, id: string, now: number): SafeSpot | null {
  return loadSpots(store, now).find((spot) => spot.id === id) ?? null;
}

/**
 * How the map shows it: a dot for a place the phone knew well, a circle with its accuracy for a
 * coarse one (a neighbourhood or city cell, or a rough fix): never a dot that claims more.
 */
export function spotShape(acc: number): 'dot' | 'circle' {
  return acc > glide.roughAccuracyM ? 'circle' : 'dot';
}

/** The area the camera shows for a place: its circle whole, at least a street. [W, S, E, N]. */
export function spotBounds(
  spot: Pick<SafeSpot, 'lat' | 'lng' | 'acc'>,
): [number, number, number, number] {
  const reach = Math.max(spot.acc, MIN_REACH_M);
  const dLat = reach / METRES_PER_DEGREE;
  const dLng = reach / (METRES_PER_DEGREE * Math.max(0.01, Math.cos((spot.lat * Math.PI) / 180)));
  return [
    Math.max(-180, spot.lng - dLng),
    Math.max(-90, spot.lat - dLat),
    Math.min(180, spot.lng + dLng),
    Math.min(90, spot.lat + dLat),
  ];
}

/** The place the map shows now, and a counter that moves each time one is asked for. */
export const useSafeSpot = create<{ spot: SafeSpot | null; request: number }>(() => ({
  spot: null,
  request: 0,
}));

/** Show this place: the map looks at it (and the screens over the map make way, use-safe-spot). */
export function showSpot(spot: SafeSpot): void {
  useSafeSpot.setState((state) => ({ spot, request: state.request + 1 }));
}

/** A tap on the map takes the place away. */
export function clearSpot(): void {
  useSafeSpot.setState({ spot: null });
}

/** Sign-out. */
export function resetSpot(): void {
  useSafeSpot.setState({ spot: null, request: 0 });
}

/**
 * A tapped notification names a message: its place, if this phone still has it, is shown on the
 * map. False when it is gone (a day old): the caller opens the circle instead.
 */
export function openSpot(store: KeyValueStore, id: string, now: number): boolean {
  const spot = spotOf(store, id, now);
  if (spot === null) return false;
  showSpot(spot);
  return true;
}
