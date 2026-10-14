import { type WeatherSnapshot, weatherSnapshotSchema } from '@bargu/schemas';
import { create } from 'zustand';

/** What the map shows for the weather where the user is. */
export type WeatherKind = 'clear' | 'clouds' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export interface WeatherHere {
  kind: WeatherKind;
  /** 0–1: how strong the effect is (light rain … downpour). */
  intensity: number;
  day: boolean;
  /** °C. */
  temperature: number;
  /** km/h: tilts rain and pushes clouds. */
  wind: number;
}

export const useWeather = create<{ snapshot: WeatherSnapshot | null }>(() => ({ snapshot: null }));

/** Farther than this (degrees) from every grid point: outside the grid, no weather shown. */
const OUTSIDE_DEG = 1.5;

/** WMO weather codes (Open-Meteo) to what the map draws, with how strong it is. */
export function kindOf(code: number, cloud: number): { kind: WeatherKind; intensity: number } {
  if (code >= 95) return { kind: 'storm', intensity: 1 };
  if (code === 71 || code === 85) return { kind: 'snow', intensity: 0.4 };
  if (code === 73 || code === 77) return { kind: 'snow', intensity: 0.7 };
  if (code === 75 || code === 86) return { kind: 'snow', intensity: 1 };
  if (code === 61 || code === 66 || code === 80) return { kind: 'rain', intensity: 0.45 };
  if (code === 63 || code === 81) return { kind: 'rain', intensity: 0.75 };
  if (code === 65 || code === 67 || code === 82) return { kind: 'rain', intensity: 1 };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', intensity: 0.35 };
  if (code === 45 || code === 48) return { kind: 'fog', intensity: 0.8 };
  if (code === 3 || cloud >= 70) return { kind: 'clouds', intensity: Math.min(1, cloud / 100) };
  return { kind: 'clear', intensity: 1 - cloud / 100 };
}

/**
 * The weather at a point, from the nearest cell of the shared grid. Looked up on the phone: the
 * point never leaves it (docs/ADR/0013). Null outside the grid or for an empty cell.
 */
export function weatherAt(
  snapshot: WeatherSnapshot,
  point: { lat: number; lng: number },
): WeatherHere | null {
  const { south, west, step, rows, cols } = snapshot.grid;
  const row = Math.round((point.lat - south) / step);
  const col = Math.round((point.lng - west) / step);
  const nearestLat = south + Math.min(Math.max(row, 0), rows - 1) * step;
  const nearestLng = west + Math.min(Math.max(col, 0), cols - 1) * step;
  if (
    Math.abs(point.lat - nearestLat) > OUTSIDE_DEG ||
    Math.abs(point.lng - nearestLng) > OUTSIDE_DEG
  ) {
    return null;
  }
  const index = Math.min(Math.max(row, 0), rows - 1) * cols + Math.min(Math.max(col, 0), cols - 1);
  const cell = snapshot.cells[index];
  if (cell === undefined || cell === null) return null;
  const [code, day, temperature, cloud, , wind] = cell;
  return { ...kindOf(code, cloud), day: day === 1, temperature, wind };
}

/** A weather snapshot from the server, or null when there is none (or it is malformed). */
export function parseSnapshot(raw: unknown): WeatherSnapshot | null {
  const parsed = weatherSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The emoji for the small chip on the map. */
export function weatherEmoji(here: WeatherHere): string {
  switch (here.kind) {
    case 'storm':
      return '⛈️';
    case 'snow':
      return '🌨️';
    case 'rain':
      return '🌧️';
    case 'drizzle':
      return '🌦️';
    case 'fog':
      return '🌫️';
    case 'clouds':
      return '☁️';
    case 'clear':
      return here.day ? '☀️' : '🌙';
  }
}
