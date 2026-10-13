import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { Mailer, type OutgoingEmail } from '../../src/jobs/mailer.js';
import { WorkerModule } from '../../src/worker.module.js';
import { createTestApp, type TestApp } from './support/app.js';
import { codeFor, requestCode, uniqueEmail } from './support/client.js';

let test: TestApp;
let worker: TestingModule;
const sent: OutgoingEmail[] = [];

beforeAll(async () => {
  test = await createTestApp();
  // The worker shares the API's secrets (same environment in production).
  worker = await Test.createTestingModule({ imports: [WorkerModule.forRoot(test.env)] })
    .overrideProvider(Mailer)
    .useValue({ send: (email: OutgoingEmail) => Promise.resolve(void sent.push(email)) })
    .compile();
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
    await vi.waitFor(
      () => {
        expect(sent.some((message) => message.to === email)).toBe(true);
      },
      { timeout: 15_000, interval: 100 },
    );
    const message = sent.find((candidate) => candidate.to === email);
    expect(message?.subject).toBe('Bargu giriş kodun');
    expect(message?.text).toContain(codeFor(test, challengeId));
    // The subject never carries the code (lock-screen previews).
    expect(message?.subject).not.toMatch(/\d{6}/);
  });
});
