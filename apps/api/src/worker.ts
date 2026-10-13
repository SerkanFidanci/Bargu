import { NestFactory } from '@nestjs/core';

import { loadEnv } from './config/env.js';
import { createNestLogger } from './logging/nest-logger.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    logger: createNestLogger(env),
  });
  app.enableShutdownHooks();
}

try {
  await bootstrap();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Worker startup failed'}\n`);
  process.exit(1);
}
