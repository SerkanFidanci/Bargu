import { usePlaces } from '../places/places';
import { places } from '../places/places-session';
import { isVaultOpen, vault } from '../storage/vault';

/** The vault entry: the spots this phone added for its meetings. */
const SPOTS_KEY = 'meeting:spots:v1';
/** Kept places stay listed; the oldest fall off past this many. */
const MAX_SPOTS = 50;

function mySpots(): string[] {
  if (!isVaultOpen()) return [];
  try {
    const raw = vault().get(SPOTS_KEY);
    const parsed: unknown = raw === undefined ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function keep(ids: readonly string[]): void {
  if (isVaultOpen()) vault().set(SPOTS_KEY, JSON.stringify(ids.slice(-MAX_SPOTS)));
}

/**
 * A spot this phone just added for a meeting (docs/ADR/0026 Ek 1). Only such spots ever go with a
 * meeting from this phone: a plan's `placeGoes` alone is not believed (QA-35: a member who may
 * write the plan could name the circle's "Ev" in it and have the starter's phone delete it).
 */
export function rememberSpot(placeId: string): void {
  keep([...mySpots().filter((id) => id !== placeId), placeId]);
}

/** Lets a spot of this phone's go with its meeting; any other place stays, whatever a plan says. */
export async function forgetSpot(placeId: string): Promise<void> {
  if (!mySpots().includes(placeId)) return;
  const place = usePlaces.getState()[placeId];
  if (place !== undefined && !(await places.remove(place))) return;
  keep(mySpots().filter((id) => id !== placeId));
}
