import { Inject, Injectable } from '@nestjs/common';
import { openAtRest, sealAtRest } from '@bargu/crypto';
import { localeSchema } from '@bargu/schemas';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { AuthKeys } from '../auth/auth-keys.js';
import { QUEUES } from './queues.js';
import { JOB_QUEUE } from './tokens.js';

const SEAL_CONTEXT = 'job/email';

/**
 * A login code (`otp`), the account web page's code (`web`, docs/ADR/0021), or its "recognise
 * this browser" link (`web-unlock`, QA 4 K2b; the challenge id is the link's id).
 */
const emailJobSchema = z
  .object({
    kind: z.enum(['otp', 'web', 'web-unlock']),
    to: z.email(),
    locale: localeSchema,
    challengeId: z.uuid(),
  })
  .strict();
export type EmailJob = z.infer<typeof emailJobSchema>;

/** What is stored in the queue: only a sealed blob, no address in clear. */
const queuedEmailSchema = z.object({ v: z.literal(1), box: z.string() }).strict();
type QueuedEmail = z.infer<typeof queuedEmailSchema>;

@Injectable()
export class EmailJobs {
  constructor(
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
    private readonly keys: AuthKeys,
  ) {}

  /** Queues a login-code email. The code itself is derived by the worker, never stored. */
  async enqueueOtp(job: Omit<EmailJob, 'kind'>): Promise<void> {
    const box = sealAtRest(
      this.keys.jobPayloadKey,
      new TextEncoder().encode(JSON.stringify({ kind: 'otp', ...job } satisfies EmailJob)),
      SEAL_CONTEXT,
    );
    // The job id is the challenge id: at most one email per challenge, even on a retried request.
    await this.boss.send(QUEUES.email, { v: 1, box } satisfies QueuedEmail, {
      id: job.challengeId,
    });
  }

  /** Queues the account web page's code (8 digits, its own label); derived by the worker too. */
  async enqueueWebCode(job: Omit<EmailJob, 'kind'>): Promise<void> {
    const box = sealAtRest(
      this.keys.jobPayloadKey,
      new TextEncoder().encode(JSON.stringify({ kind: 'web', ...job } satisfies EmailJob)),
      SEAL_CONTEXT,
    );
    await this.boss.send(QUEUES.email, { v: 1, box } satisfies QueuedEmail, {
      id: job.challengeId,
    });
  }

  /** Queues the "recognise this browser" link; its secret is derived by the worker too. */
  async enqueueWebUnlock(job: Omit<EmailJob, 'kind'>): Promise<void> {
    const box = sealAtRest(
      this.keys.jobPayloadKey,
      new TextEncoder().encode(JSON.stringify({ kind: 'web-unlock', ...job } satisfies EmailJob)),
      SEAL_CONTEXT,
    );
    await this.boss.send(QUEUES.email, { v: 1, box } satisfies QueuedEmail, {
      id: job.challengeId,
    });
  }

  open(data: unknown): EmailJob {
    const { box } = queuedEmailSchema.parse(data);
    const json: unknown = JSON.parse(
      new TextDecoder().decode(openAtRest(this.keys.jobPayloadKey, box, SEAL_CONTEXT)),
    );
    return emailJobSchema.parse(json);
  }
}
