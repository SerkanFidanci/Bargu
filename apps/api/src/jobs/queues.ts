import type { Queue } from 'pg-boss';

/** Postgres schema holding the job tables (pg-boss), separate from the application schema. */
export const JOBS_SCHEMA = 'pgboss';

export const QUEUES = {
  /** Transactional email (login codes). Payload sealed with JOB_PAYLOAD_KEY. */
  email: 'email.send',
  emailDead: 'email.send.dead',
  /** Push notifications (docs/ADR/0010). Payload: user id, kind, circle id; no token, no text. */
  push: 'push.send',
  pushDead: 'push.send.dead',
  /** Arrival checks (docs/ADR/0039): fires one at its time. Payload: the check's id, nothing else. */
  checkinFire: 'checkin.fire',
  checkinFireDead: 'checkin.fire.dead',
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
  [QUEUES.pushDead, { retentionSeconds: 24 * 3600, deleteAfterSeconds: 24 * 3600 }],
  [
    QUEUES.push,
    {
      retryLimit: 4,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 300,
      expireInSeconds: 60,
      // News older than an hour is better told by the app itself when it opens.
      retentionSeconds: 3600,
      deleteAfterSeconds: 3600,
      deadLetter: QUEUES.pushDead,
      notify: true,
    },
  ],
  [QUEUES.checkinFireDead, { retentionSeconds: 7 * 24 * 3600, deleteAfterSeconds: 7 * 24 * 3600 }],
  [
    QUEUES.checkinFire,
    {
      retryLimit: 10,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 120,
      expireInSeconds: 60,
      // Waits up to a day for its time (a check opens at most 23 hours after it is set).
      retentionSeconds: 2 * 24 * 3600,
      deleteAfterSeconds: 24 * 3600,
      deadLetter: QUEUES.checkinFireDead,
      notify: true,
    },
  ],
];
