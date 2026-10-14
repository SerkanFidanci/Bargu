import type { LocPayload } from '@bargu/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { BarguCryptoError } from '../src/errors.js';
import { applyPrecision, PRECISION_CELL_KM } from '../src/precision.js';

const base: LocPayload = {
  kind: 'loc',
  lat: 41.0082,
  lng: 28.9784,
  acc: 6,
  spd: 3,
  hdg: 120,
  since: 1_700_000_000_000,
  bat: 50,
  chg: false,
  ts: 1_791_880_000_000,
};

/** Great-circle distance in km. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const location = fc.record({
  lat: fc.double({ min: -85, max: 85, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe('applyPrecision', () => {
  it('leaves exact locations untouched', () => {
    expect(applyPrecision(base, 'exact')).toEqual(base);
  });

  it.each(['neighborhood', 'city'] as const)(
    '%s: stays within its cell, drops speed and heading, widens accuracy (property)',
    (level) => {
      const cellKm = PRECISION_CELL_KM[level];
      fc.assert(
        fc.property(location, ({ lat, lng }) => {
          const snapped = applyPrecision({ ...base, lat, lng }, level);
          expect(snapped.spd).toBeUndefined();
          expect(snapped.hdg).toBeUndefined();
          expect(snapped.since).toBeUndefined();
          expect(snapped.acc).toBeGreaterThanOrEqual((cellKm * 1000) / Math.SQRT2);
          expect(snapped.lat).toBeGreaterThanOrEqual(-90);
          expect(snapped.lat).toBeLessThanOrEqual(90);
          expect(snapped.lng).toBeGreaterThanOrEqual(-180);
          expect(snapped.lng).toBeLessThan(180);
          // Never further than half a cell diagonal (plus spherical slack).
          expect(distanceKm({ lat, lng }, snapped)).toBeLessThanOrEqual(cellKm * 0.75);
        }),
        { numRuns: 500 },
      );
    },
  );

  it('is deterministic and idempotent, so averaging reveals nothing (property)', () => {
    fc.assert(
      fc.property(
        location,
        fc.constantFrom('neighborhood', 'city' as const),
        ({ lat, lng }, level) => {
          const once = applyPrecision({ ...base, lat, lng }, level);
          expect(applyPrecision({ ...base, lat, lng }, level)).toEqual(once);
          expect(applyPrecision(once, level)).toEqual(once);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('maps nearby points to the same cell centre', () => {
    const a = applyPrecision({ ...base, lat: 41.0082, lng: 28.9784 }, 'city');
    const b = applyPrecision({ ...base, lat: 41.0085, lng: 28.979 }, 'city');
    expect(b).toEqual(a);
  });

  it('handles the poles and the antimeridian', () => {
    for (const [lat, lng] of [
      [90, 0],
      [-90, 179.9999],
      [0, 180],
      [0, -180],
    ] as const) {
      const snapped = applyPrecision({ ...base, lat, lng }, 'city');
      expect(Math.abs(snapped.lat)).toBeLessThanOrEqual(90);
      expect(snapped.lng).toBeGreaterThanOrEqual(-180);
      expect(snapped.lng).toBeLessThan(180);
    }
  });

  it('rounds accuracy up to whole cell radii instead of passing the raw value through', () => {
    const radius = Math.ceil(1000 / Math.SQRT2);
    expect(applyPrecision({ ...base, acc: 6 }, 'neighborhood').acc).toBe(radius);
    expect(applyPrecision({ ...base, acc: radius + 1 }, 'neighborhood').acc).toBe(2 * radius);
    expect(applyPrecision({ ...base, acc: 3 * radius }, 'neighborhood').acc).toBe(3 * radius);
    // Capped below the schema maximum, so the result is always a valid payload.
    const city = applyPrecision({ ...base, acc: 1_000_000 }, 'city');
    expect(city.acc).toBeLessThanOrEqual(1_000_000);
    expect(city.acc % Math.ceil(10_000 / Math.SQRT2)).toBe(0);
  });

  it('rejects invalid locations', () => {
    expect(() => applyPrecision({ ...base, lat: 100 }, 'city')).toThrow(BarguCryptoError);
  });
});
