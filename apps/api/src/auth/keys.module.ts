import { Global, Module } from '@nestjs/common';

import { AuthKeys } from './auth-keys.js';

/** Server secrets, available to every module (auth, jobs, worker). */
@Global()
@Module({ providers: [AuthKeys], exports: [AuthKeys] })
export class KeysModule {}
