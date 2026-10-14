import { distanceBetween, type GlidePoint } from './glide';

/**
 * Label layers of our own map style that name places (Protomaps basemap, styles/*.json):
 * neighbourhoods first, then towns and districts.
 */
export const PLACE_LAYERS = ['places_subplace', 'places_locality'];
const PLACE_KINDS = { area: ['neighbourhood', 'macrohood'], town: ['locality'] } as const;

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
  // Native queries return GeoJSON without the layer: the basemap's `kind` tells them apart.
  const nearest = (kinds: readonly string[]) => {
    let best: { name: string; distance: number } | null = null;
    for (const feature of features) {
      if (!kinds.includes(String(feature.properties?.kind))) continue;
      const point = pointOf(feature);
      const name = nameOf(feature.properties, language);
      if (point === null || name === null) continue;
      const distance = distanceBetween(at, point);
      if (best === null || distance < best.distance) best = { name, distance };
    }
    return best?.name ?? null;
  };
  const parts = [nearest(PLACE_KINDS.area), nearest(PLACE_KINDS.town)].filter(
    (part, index, all): part is string => part !== null && all.indexOf(part) === index,
  );
  return parts.length === 0 ? null : parts.join(', ');
}
