import type { WeatherSnapshot } from '@bargu/schemas';
import { z } from 'zod';

/**
 * The grid weather is fetched for: all of Turkey at 1° (about 100 km), 7 × 20 = 140 points. Coarse
 * on purpose: it only picks the map's weather animation, and every point is an API call
 * (Open-Meteo free tier: 10,000 a day; 140 every 30 minutes is 6,720).
 */
export const WEATHER_GRID = { south: 36, west: 26, step: 1, rows: 7, cols: 20 } as const;

/** Grid points in snapshot order: row-major from the south-west corner, rows going north. */
export function gridPoints(grid = WEATHER_GRID): { lat: number; lng: number }[] {
  return Array.from({ length: grid.rows * grid.cols }, (_, index) => ({
    lat: grid.south + Math.floor(index / grid.cols) * grid.step,
    lng: grid.west + (index % grid.cols) * grid.step,
  }));
}

/** What is asked of Open-Meteo for each point (current conditions only). */
const WEATHER_FIELDS = [
  'weather_code',
  'is_day',
  'temperature_2m',
  'cloud_cover',
  'precipitation',
  'wind_speed_10m',
] as const;

const current = z.object({
  weather_code: z.number().int().min(0).max(99),
  is_day: z.number().int().min(0).max(1),
  temperature_2m: z.number(),
  cloud_cover: z.number(),
  precipitation: z.number(),
  wind_speed_10m: z.number(),
});

/** Open-Meteo answers a list of locations with an array, in the order they were asked. */
export const openMeteoResponseSchema = z.array(z.object({ current }));

export function forecastUrl(base: string, grid = WEATHER_GRID): string {
  const points = gridPoints(grid);
  const params = new URLSearchParams({
    latitude: points.map((point) => String(point.lat)).join(','),
    longitude: points.map((point) => String(point.lng)).join(','),
    current: WEATHER_FIELDS.join(','),
    timezone: 'GMT',
    wind_speed_unit: 'kmh',
  });
  return `${base}?${params.toString()}`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/** The response as the phones get it: compact, clamped, in grid order. */
export function toSnapshot(
  response: z.infer<typeof openMeteoResponseSchema>,
  at: number,
  grid = WEATHER_GRID,
): WeatherSnapshot {
  const cells = gridPoints(grid).map((_, index) => {
    const point = response[index]?.current;
    if (point === undefined) return null;
    return [
      point.weather_code,
      point.is_day,
      round1(clamp(point.temperature_2m, -90, 70)),
      Math.round(clamp(point.cloud_cover, 0, 100)),
      round1(clamp(point.precipitation, 0, 500)),
      round1(clamp(point.wind_speed_10m, 0, 500)),
    ] as [number, number, number, number, number, number];
  });
  return { at, grid: { ...grid }, cells };
}
