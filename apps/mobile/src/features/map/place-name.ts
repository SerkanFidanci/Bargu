import { distanceBetween, type GlidePoint } from './glide';

/**
 * Label layers of our own map style that name places (Protomaps basemap, styles/*.json):
 * neighbourhoods first, then towns and districts.
 */
export const PLACE_LAYERS = ['places_subplace', 'places_locality'];
const PLACE_KINDS = { area: ['neighbourhood', 'macrohood'], town: ['locality'] } as const;

/**
 * How far a label may be from the point it names (docs/ADR/0013). Further out the map has not
 * drawn the nearby small towns yet, and the nearest label drawn can be a city hundreds of
 * kilometres away: the owner in Bozüyük saw "İstanbul".
 */
const NAME_RANGE_M = { area: 3_000, town: 15_000 } as const;

/** A feature as MapLibre returns it from a rendered-features query (only what is read here). */
export interface PlaceFeature {
  geometry: { type: string; coordinates?: unknown };
  properties: Record<string, unknown> | null;
}

function nameOf(properties: Record<string, unknown> | null, language: string): string | null {
  if (properties === null) return null;
  for (const key of [`name:${language}`, 'name', 'pgf:name']) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function pointOf(feature: PlaceFeature): GlidePoint | null {
  if (feature.geometry.type !== 'Point') return null;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [lng, lat] = coordinates as unknown[];
  return typeof lng === 'number' && typeof lat === 'number' ? { lat, lng } : null;
}

/**
 * "Serencebey, Beşiktaş": the nearest neighbourhood and the nearest town or district among the
 * labels the map has drawn around a point. Done on the phone from map data it already has, so the
 * point is never sent anywhere (BARGU_PLAN §1: no third-party geocoding). Null when the map shows
 * no place name nearby (zoomed far out, or the labels collided).
 */
export function placeName(
  features: readonly PlaceFeature[],
  at: GlidePoint,
  language: string,
): string | null {
  const parts = [
    nearest(features, at, language, PLACE_KINDS.area, NAME_RANGE_M.area),
    nearest(features, at, language, PLACE_KINDS.town, NAME_RANGE_M.town),
  ].filter((part, index, all): part is string => part !== null && all.indexOf(part) === index);
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * The town or district around a point ("Kadıköy"), from the labels the map has drawn, as for
 * placeName: on the phone, never sent anywhere (docs/ADR/0013). For the weather card; null when
 * the map shows none nearby.
 */
export function townName(
  features: readonly PlaceFeature[],
  at: GlidePoint,
  language: string,
): string | null {
  return nearest(features, at, language, PLACE_KINDS.town, NAME_RANGE_M.town);
}

/** The name of the nearest label of these kinds within `range` metres of the point, if any. */
function nearest(
  features: readonly PlaceFeature[],
  at: GlidePoint,
  language: string,
  kinds: readonly string[],
  range: number,
): string | null {
  // Native queries return GeoJSON without the layer: the basemap's `kind` tells them apart.
  let best: { name: string; distance: number } | null = null;
  for (const feature of features) {
    if (!kinds.includes(String(feature.properties?.kind))) continue;
    const point = pointOf(feature);
    const name = nameOf(feature.properties, language);
    if (point === null || name === null) continue;
    const distance = distanceBetween(at, point);
    if (distance <= range && (best === null || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? null;
}

/**
 * The town to show for the square kilometre this phone is in: only the one found there (QA 24
 * B-3). Moved on, the old name goes; where the map names nothing, none.
 */
export function townIn(
  found: { cell: string; name: string } | null,
  cell: string | null,
): string | null {
  return found !== null && cell !== null && found.cell === cell ? found.name : null;
}
