import { Test, type TestingModule } from '@nestjs/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { JOB_QUEUE } from '../../src/jobs/jobs.module.js';
import { Mailer, type OutgoingEmail } from '../../src/jobs/mailer.js';
import { QUEUES } from '../../src/jobs/queues.js';
import { WorkerModule } from '../../src/worker.module.js';
import { createTestApp, type TestApp } from './support/app.js';
import { codeFor, requestCode, uniqueEmail } from './support/client.js';

let test: TestApp;
let worker: TestingModule;
const sent: OutgoingEmail[] = [];
/** Queue events of the worker, reported when a delivery check times out. */
const events: string[] = [];

/** Waits for `check`; on timeout, fails with what the worker's queue saw (diagnosable in CI). */
async function eventually(check: () => void | Promise<void>): Promise<void> {
  try {
    await vi.waitFor(check, { timeout: 15_000, interval: 200 });
  } catch (error) {
    const boss = worker.get<PgBoss>(JOB_QUEUE);
    const queue = await boss.getQueue(QUEUES.email).catch((e: unknown) => String(e));
    const jobs = await test.admin
      .query<Record<string, unknown>>(
        'SELECT name, state, retry_count, start_after, created_on FROM pgboss.job ORDER BY created_on DESC LIMIT 5',
      )
      .then((r) => r.rows)
      .catch((e: unknown) => String(e));
    const wip = boss.getWipData({ includeInternal: true });
    throw new Error(
      `worker did not finish the job: ${JSON.stringify({ events, queue, jobs, wip })}`,
      {
        cause: error,
      },
    );
  }
}

beforeAll(async () => {
  test = await createTestApp();
  // The worker shares the API's secrets (same environment in production).
  worker = await Test.createTestingModule({ imports: [WorkerModule.forRoot(test.env)] })
    .overrideProvider(Mailer)
    .useValue({ send: (email: OutgoingEmail) => Promise.resolve(void sent.push(email)) })
    .compile();
  const boss = worker.get<PgBoss>(JOB_QUEUE);
  boss.on('error', (error: Error) => events.push(`error: ${error.message}`));
  boss.on('warning', (warning: unknown) => events.push(`warning: ${JSON.stringify(warning)}`));
  await worker.init();
});
afterAll(async () => {
  await worker.close();
  await test.close();
});

describe('email worker', () => {
  it('delivers the login code that the API queued, to the address that asked for it', async () => {
    const email = uniqueEmail();
    const { challengeId } = await requestCode(test, email);
    await eventually(() => {
      expect(sent.some((message) => message.to === email)).toBe(true);
    });
    const message = sent.find((candidate) => candidate.to === email);
    expect(message?.subject).toBe('Bargu giriş kodun');
    expect(message?.text).toContain(codeFor(test, challengeId));
    // The subject never carries the code (lock-screen previews).
    expect(message?.subject).not.toMatch(/\d{6}/);
  });

  it('drops a job it can never open instead of retrying it', async () => {
    // Queued by an API with other keys (e.g. before a key rotation).
    const foreign = await createTestApp();
    try {
      const { challengeId } = await requestCode(foreign, uniqueEmail());
      await eventually(async () => {
        const { rows } = await test.admin.query<{ state: string; retry_count: number }>(
          'SELECT state, retry_count FROM pgboss.job WHERE id = $1',
          [challengeId],
        );
        expect(rows[0]).toEqual({ state: 'completed', retry_count: 0 });
      });
    } finally {
      await foreign.close();
    }
  });
});
