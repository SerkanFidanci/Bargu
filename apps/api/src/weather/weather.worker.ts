import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { forecastUrl, openMeteoResponseSchema, toSnapshot } from './weather-grid.js';

/** Where the latest snapshot is kept, and the channel that tells the API it changed. */
export const WEATHER_KEY = 'weather:snapshot';
export const WEATHER_CHANNEL = 'weather';
/** How often the grid is fetched; conditions change slowly. */
export const WEATHER_REFRESH_MS = 30 * 60_000;
/** A snapshot older than this is dropped (the phones then show no weather rather than old). */
const WEATHER_TTL_SECONDS = 3 * 3600;
/** One worker fetches per period, even if several run. */
const LOCK_KEY = 'weather:lock';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetches current weather for the whole grid (weather-grid.ts) from the weather service, every
 * 30 minutes, and publishes it for the API. Only grid points are ever sent out: no user location
 * is involved (docs/ADR/0013). Runs in the worker, the only process with internet access.
 */
@Injectable()
export class WeatherWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Weather');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.WEATHER_URL === 'off') {
      this.logger.log('weather is off');
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), WEATHER_REFRESH_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Fetches and publishes once; false when it was skipped or failed (the next round retries). */
  async refresh(fetcher: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
    if (this.env.WEATHER_URL === 'off') return false;
    const locked = await this.redis.set(LOCK_KEY, '1', {
      condition: 'NX',
      expiration: { type: 'PX', value: WEATHER_REFRESH_MS - 60_000 },
    });
    if (locked !== 'OK') return false;
    try {
      const response = await fetcher(forecastUrl(this.env.WEATHER_URL), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const parsed = openMeteoResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('unexpected response');
      const snapshot = toSnapshot(parsed.data, now);
      await this.redis.set(WEATHER_KEY, JSON.stringify(snapshot), {
        expiration: { type: 'EX', value: WEATHER_TTL_SECONDS },
      });
      await this.redis.publish(WEATHER_CHANNEL, String(snapshot.at));
      this.logger.log(`weather updated (${String(snapshot.cells.length)} cells)`);
      return true;
    } catch (error) {
      // Free the lock so the next round tries again; the old snapshot stays until it expires.
      await this.redis.del(LOCK_KEY);
      this.logger.warn(
        `weather not updated: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }
}
