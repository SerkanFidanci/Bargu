import { type DynamicModule, Module } from '@nestjs/common';

import type { Env } from './env.js';

/** Injection token for the validated, immutable environment. */
export const ENV = Symbol('ENV');

@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: ENV, useValue: Object.freeze({ ...env }) }],
      exports: [ENV],
    };
  }
}
