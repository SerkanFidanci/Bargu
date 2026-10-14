import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { type WeatherSnapshot, weatherSnapshotSchema } from '@bargu/schemas';

import { EventsService } from '../events/events.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { WEATHER_CHANNEL, WEATHER_KEY } from './weather.worker.js';

/**
 * Serves the weather snapshot the worker publishes, the same for every user, and tells every
 * connected phone when a new one is in (a live message; phones never poll for it).
 */
@Injectable()
export class WeatherService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Weather');
  private subscriber: RedisClient | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    // Weather is a nicety: the API starts (and keeps serving) even if this channel cannot open.
    void this.listen().catch((error: unknown) => {
      this.logger.warn(
        `weather channel not open: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    });
  }

  private async listen(): Promise<void> {
    const subscriber = this.redis.duplicate();
    subscriber.on('error', (error: Error) => {
      this.logger.warn(`weather channel: ${error.name}`);
    });
    this.subscriber = subscriber;
    await subscriber.connect();
    await subscriber.subscribe(WEATHER_CHANNEL, (message) => {
      const at = Number(message);
      if (Number.isSafeInteger(at)) this.events.emitAll('weather', { at });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.subscriber?.isOpen === true) await this.subscriber.close();
  }

  async snapshot(): Promise<WeatherSnapshot | null> {
    const raw = await this.redis.get(WEATHER_KEY);
    if (raw === null) return null;
    const parsed = weatherSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
}
