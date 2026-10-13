import { Inject, Injectable } from '@nestjs/common';
import { signingKeyFromSeed, verificationKeyFromRaw, type OkpJwk } from '@bargu/crypto';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/** Server secrets from the environment, decoded once. Never logged, never serialised. */
@Injectable()
export class AuthKeys {
  readonly signingKey: OkpJwk;
  readonly signingKeyId: string;
  /** Access tokens are accepted when signed by one of these (current and previous key). */
  readonly verificationKeys: ReadonlyMap<string, OkpJwk>;
  readonly otpKey: Uint8Array;
  readonly emailLookupKey: Uint8Array;
  readonly jobPayloadKey: Uint8Array;

  constructor(@Inject(ENV) env: Env) {
    const current = signingKeyFromSeed(env.JWT_SIGNING_KEY);
    this.signingKey = current.privateJwk;
    this.signingKeyId = current.keyId;
    const keys = new Map([[current.keyId, current.publicJwk]]);
    if (env.JWT_PREVIOUS_PUBLIC_KEY !== undefined) {
      const previous = verificationKeyFromRaw(env.JWT_PREVIOUS_PUBLIC_KEY);
      keys.set(previous.keyId, previous.publicJwk);
    }
    this.verificationKeys = keys;
    this.otpKey = env.OTP_KEY;
    this.emailLookupKey = env.EMAIL_LOOKUP_KEY;
    this.jobPayloadKey = env.JOB_PAYLOAD_KEY;
  }
}
