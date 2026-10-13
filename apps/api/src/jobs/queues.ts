import type { Queue } from 'pg-boss';

/** Postgres schema holding the job tables (pg-boss), separate from the application schema. */
export const JOBS_SCHEMA = 'pgboss';

export const QUEUES = {
  /** Transactional email (login codes). Payload sealed with JOB_PAYLOAD_KEY. */
  email: 'email.send',
  emailDead: 'email.send.dead',
} as const;

type QueueOptions = Omit<Queue, 'name'>;

/**
 * Queue definitions, created by the migration step (the runtime role cannot create tables).
 * Order matters: a dead-letter queue must exist before the queue that points at it.
 */
export const QUEUE_DEFINITIONS: readonly (readonly [string, QueueOptions])[] = [
  // Failed sends are kept a week for inspection; the payload stays sealed.
  [QUEUES.emailDead, { retentionSeconds: 7 * 24 * 3600, deleteAfterSeconds: 7 * 24 * 3600 }],
  [
    QUEUES.email,
    {
      retryLimit: 5,
      retryDelay: 2,
      retryBackoff: true,
      retryDelayMax: 120,
      expireInSeconds: 60,
      // A login code is valid for 10 minutes: an email still unsent after that is useless.
      retentionSeconds: 10 * 60,
      deleteAfterSeconds: 3600,
      deadLetter: QUEUES.emailDead,
      notify: true,
    },
  ],
];
