import type { WeatherSnapshot } from '@bargu/schemas';

import { kindOf, parseSnapshot, weatherAt, weatherEmoji } from './weather';

/** A 2 × 3 grid from 40°N 27°E at 1°. */
function snapshot(): WeatherSnapshot {
  const grid = { south: 40, west: 27, step: 1, rows: 2, cols: 3 };
  const cells: WeatherSnapshot['cells'] = [
    [0, 1, 24, 5, 0, 10], // 40°N 27°E
    [3, 1, 18, 95, 0, 12], // 40°N 28°E
    null, // 40°N 29°E: no answer
    [63, 0, 9.5, 100, 2, 30], // 41°N 27°E
    [71, 0, -1, 100, 1, 5], // 41°N 28°E
    [95, 1, 20, 100, 8, 50], // 41°N 29°E
  ];
  return { at: 1, grid, cells };
}

describe('weather where the user is', () => {
  it('reads the nearest cell of the shared grid', () => {
    expect(weatherAt(snapshot(), { lat: 41.04, lng: 28.3 })).toEqual({
      kind: 'snow',
      intensity: 0.4,
      day: false,
      temperature: -1,
      wind: 5,
    });
    expect(weatherAt(snapshot(), { lat: 40.2, lng: 26.9 })).toMatchObject({
      kind: 'clear',
      day: true,
    });
    expect(weatherAt(snapshot(), { lat: 41.3, lng: 29.2 })?.kind).toBe('storm');
  });

  it('shows nothing outside the grid or for a cell without an answer', () => {
    expect(weatherAt(snapshot(), { lat: 48, lng: 2 })).toBeNull();
    expect(weatherAt(snapshot(), { lat: 40, lng: 29 })).toBeNull();
  });

  it('turns weather codes into what the map draws', () => {
    expect(kindOf(65, 100)).toEqual({ kind: 'rain', intensity: 1 });
    expect(kindOf(53, 100).kind).toBe('drizzle');
    expect(kindOf(45, 100).kind).toBe('fog');
    expect(kindOf(2, 80).kind).toBe('clouds');
    expect(kindOf(1, 20)).toEqual({ kind: 'clear', intensity: 0.8 });
    expect(
      weatherEmoji({ kind: 'clear', intensity: 1, day: false, temperature: 10, wind: 0 }),
    ).toBe('🌙');
  });

  it('ignores a malformed snapshot', () => {
    expect(
      parseSnapshot({ at: 1, grid: { south: 0, west: 0, step: 1, rows: 2, cols: 2 }, cells: [] }),
    ).toBeNull();
    expect(parseSnapshot(snapshot())).not.toBeNull();
  });
});
