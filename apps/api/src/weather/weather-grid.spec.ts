import { weatherSnapshotSchema } from '@bargu/schemas';
import { describe, expect, it } from 'vitest';

import { forecastUrl, gridPoints, toSnapshot, WEATHER_GRID } from './weather-grid.js';

describe('weather grid', () => {
  it('covers Turkey at 1°, row by row from the south-west', () => {
    const points = gridPoints();
    expect(points).toHaveLength(WEATHER_GRID.rows * WEATHER_GRID.cols);
    expect(points[0]).toEqual({ lat: 36, lng: 26 });
    expect(points[1]).toEqual({ lat: 36, lng: 27 });
    expect(points[WEATHER_GRID.cols]).toEqual({ lat: 37, lng: 26 });
    expect(points.at(-1)).toEqual({ lat: 42, lng: 45 });
  });

  it('asks only for the grid points, nothing else about anyone', () => {
    const url = new URL(forecastUrl('https://weather.example.test/v1/forecast'));
    const lats = url.searchParams.get('latitude')?.split(',') ?? [];
    expect(lats).toHaveLength(140);
    expect(new Set(lats)).toEqual(new Set(['36', '37', '38', '39', '40', '41', '42']));
    expect([...url.searchParams.keys()].sort()).toEqual(
      ['current', 'latitude', 'longitude', 'timezone', 'wind_speed_unit'].sort(),
    );
  });

  it('turns the answer into a compact snapshot the phones accept', () => {
    const answer = gridPoints().map((_, index) => ({
      current: {
        weather_code: index === 0 ? 63 : 0,
        is_day: 1,
        temperature_2m: 21.37,
        cloud_cover: 120,
        precipitation: -1,
        wind_speed_10m: 12.04,
      },
    }));
    const snapshot = toSnapshot(answer.slice(0, -1), 1_800_000_000_000);
    expect(weatherSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.cells[0]).toEqual([63, 1, 21.4, 100, 0, 12]);
    // A point the service did not answer stays empty.
    expect(snapshot.cells.at(-1)).toBeNull();
  });
});
