import { locPayloadSchema, type LocPayload } from '@bargu/schemas';

import { BarguCryptoError } from './errors.js';

/** Location precision a member chooses per circle (BARGU_PLAN §3.1, "Hassasiyet"). */
export type PrecisionLevel = 'exact' | 'neighborhood' | 'city';

/** Grid cell edge length in kilometres for each reduced level. */
export const PRECISION_CELL_KM: Readonly<Record<Exclude<PrecisionLevel, 'exact'>, number>> = {
  neighborhood: 1,
  city: 10,
};

const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LNG_AT_EQUATOR = 111.32;

/** Index of the cell containing `offset` when [0, span) is cut into `count` equal cells. */
function cellIndex(offset: number, span: number, count: number): number {
  return Math.min(count - 1, Math.floor((offset / span) * count));
}

/**
 * Deterministic grid snap to the centre of a fixed cell. Unlike random noise, repeated reports from
 * the same place always produce the same point, so averaging many updates cannot recover the true
 * position. Rows and columns divide 180° / 360° exactly, so the grid tiles the globe without a
 * partial cell at the antimeridian, and snapping a centre returns the same centre (idempotent).
 * Columns widen with latitude so cells stay roughly square; near the poles a row is one cell.
 */
function snapToGrid(lat: number, lng: number, cellKm: number): { lat: number; lng: number } {
  const rows = Math.max(1, Math.floor((180 * KM_PER_DEGREE_LAT) / cellKm));
  const row = cellIndex(lat + 90, 180, rows);
  const snappedLat = -90 + ((row + 0.5) * 180) / rows;

  const kmPerDegreeLng = KM_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((snappedLat * Math.PI) / 180);
  const columns = Math.max(1, Math.floor((360 * kmPerDegreeLng) / cellKm));
  const column = cellIndex(lng + 180, 360, columns);
  const snappedLng = -180 + ((column + 0.5) * 360) / columns;

  return { lat: snappedLat, lng: snappedLng };
}

/**
 * Applies the sender's precision setting before encryption. Below full precision, speed and
 * heading are dropped (they would reveal movement inside the cell) and the accuracy radius grows
 * to cover the whole cell.
 */
export function applyPrecision(location: LocPayload, level: PrecisionLevel): LocPayload {
  const parsed = locPayloadSchema.safeParse(location);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid location');
  if (level === 'exact') return parsed.data;

  const cellKm = PRECISION_CELL_KM[level];
  const { lat, lng } = snapToGrid(parsed.data.lat, parsed.data.lng, cellKm);
  const cellRadiusMetres = Math.ceil((cellKm * 1000) / Math.SQRT2);
  return {
    kind: 'loc',
    lat,
    lng,
    acc: Math.max(parsed.data.acc, cellRadiusMetres),
    bat: parsed.data.bat,
    chg: parsed.data.chg,
    ts: parsed.data.ts,
  };
}
