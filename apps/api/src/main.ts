import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { configureApp } from './http/configure-app.js';
import { createHttpAdapter } from './http/http-adapter.js';
import { createNestLogger } from './logging/nest-logger.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    createHttpAdapter(env),
    { logger: createNestLogger(env) },
  );
  configureApp(app);
  await app.listen({ port: env.PORT, host: env.HOST });
}

try {
  await bootstrap();
} catch (error: unknown) {
  // Fail fast with a readable reason; the orchestrator restarts the container.
  process.stderr.write(`${error instanceof Error ? error.message : 'Startup failed'}\n`);
  process.exit(1);
}
