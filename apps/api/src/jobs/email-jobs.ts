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
const codeEmailSchema = z
  .object({
    kind: z.enum(['otp', 'web', 'web-unlock']),
    to: z.email(),
    locale: localeSchema,
    challengeId: z.uuid(),
  })
  .strict();
type CodeEmailJob = z.infer<typeof codeEmailSchema>;

/**
 * A word to whoever runs the service (OPS_EMAIL, docs/ADR/0035 §9, §10): what happened and an id
 * to look it up by on the server. Never what was reported, nor who.
 */
const opsEmailSchema = z
  .object({
    kind: z.literal('ops'),
    to: z.email(),
    topic: z.enum(['report', 'media']),
    /** The reason of a report, or how full the photos' space is (a percentage). */
    detail: z.string().max(40),
    id: z.uuid(),
  })
  .strict();
export type OpsEmailJob = z.infer<typeof opsEmailSchema>;

const emailJobSchema = z.discriminatedUnion('kind', [codeEmailSchema, opsEmailSchema]);
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
  async enqueueOtp(job: Omit<CodeEmailJob, 'kind'>): Promise<void> {
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
  async enqueueWebCode(job: Omit<CodeEmailJob, 'kind'>): Promise<void> {
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
  async enqueueWebUnlock(job: Omit<CodeEmailJob, 'kind'>): Promise<void> {
    const box = sealAtRest(
      this.keys.jobPayloadKey,
      new TextEncoder().encode(JSON.stringify({ kind: 'web-unlock', ...job } satisfies EmailJob)),
      SEAL_CONTEXT,
    );
    await this.boss.send(QUEUES.email, { v: 1, box } satisfies QueuedEmail, {
      id: job.challengeId,
    });
  }

  /** A word to the operator; at most one per id (a report, a day of the photos' alarm). */
  async enqueueOps(job: Omit<OpsEmailJob, 'kind'>): Promise<void> {
    const box = sealAtRest(
      this.keys.jobPayloadKey,
      new TextEncoder().encode(JSON.stringify({ kind: 'ops', ...job } satisfies OpsEmailJob)),
      SEAL_CONTEXT,
    );
    await this.boss.send(QUEUES.email, { v: 1, box } satisfies QueuedEmail, { id: job.id });
  }

  open(data: unknown): EmailJob {
    const { box } = queuedEmailSchema.parse(data);
    const json: unknown = JSON.parse(
      new TextDecoder().decode(openAtRest(this.keys.jobPayloadKey, box, SEAL_CONTEXT)),
    );
    return emailJobSchema.parse(json);
  }
}
