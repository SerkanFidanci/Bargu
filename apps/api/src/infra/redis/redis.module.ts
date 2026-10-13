import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { ENV } from '../../config/config.module.js';
import { RateLimiter } from './rate-limiter.js';
import { createRedisClient, REDIS, type RedisClient } from './redis.client.js';

export { REDIS, type RedisClient };

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ENV], useFactory: createRedisClient }, RateLimiter],
  exports: [REDIS, RateLimiter],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly client: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    } else {
      this.client.destroy();
    }
  }
}
