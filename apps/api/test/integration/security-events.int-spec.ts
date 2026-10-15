import { type SecurityEvent, SECURITY_EVENTS_DAYS } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccountPurge } from '../../src/account/account-purge.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login, uniqueEmail } from './support/client.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const list = (accessToken: string) =>
  call(test.app, { method: 'GET', url: '/v1/me/security-events', accessToken });

describe('security events (Faz 9)', () => {
  it('are kept no longer than they are shown (QA Faz 9 slice 4, K5)', async () => {
    const email = uniqueEmail();
    const first = await login(test, email);
    const { userId } = first.session;
    await test.admin.query(
      `UPDATE app.security_events SET created_at = now() - interval '91 days' WHERE user_id = $1`,
      [userId],
    );
    await login(test, email);
    expect(await test.app.get(AccountPurge).expireSecurityEvents()).toBeGreaterThanOrEqual(1);
    const { rows } = await test.admin.query<{ created_at: Date }>(
      `SELECT created_at FROM app.security_events WHERE user_id = $1`,
      [userId],
    );
    expect(rows.length).toBeGreaterThan(0);
    const oldest = Math.min(...rows.map((row) => row.created_at.getTime()));
    expect(Date.now() - oldest).toBeLessThan(SECURITY_EVENTS_DAYS * 24 * 3600_000);
  });

  it('list the account’s own, newest first, with the kind of phone and whether it is this one', async () => {
    const email = uniqueEmail();
    const first = await login(test, email);
    // A new phone signs in: the first is replaced.
    const second = await login(test, email);
    const response = await list(second.session.accessToken);
    expect(response.statusCode).toBe(200);
    const { events } = response.json<{ events: SecurityEvent[] }>();
    expect(events.map((event) => event.type)).toEqual([
      'login_otp',
      'device_replaced',
      'login_otp',
    ]);
    expect(events[0]?.device).toEqual({ platform: 'android', current: true });
    expect(events[2]?.device).toEqual({ platform: 'android', current: false });
    expect(events[0]?.at).toBeGreaterThanOrEqual(events[2]?.at ?? Infinity);
    // The replaced phone cannot read them any more.
    expect((await list(first.session.accessToken)).statusCode).toBe(401);
  });

  it('show nobody else’s, and nothing older than the window', async () => {
    const [ayse, bora] = [await login(test, uniqueEmail()), await login(test, uniqueEmail())];
    await test.admin.query(
      `INSERT INTO app.security_events (user_id, type, created_at)
       VALUES ($1, 'logout', now() - make_interval(days => $2))`,
      [ayse.session.userId, SECURITY_EVENTS_DAYS + 1],
    );
    const ayses = (await list(ayse.session.accessToken)).json<{ events: SecurityEvent[] }>();
    const boras = (await list(bora.session.accessToken)).json<{ events: SecurityEvent[] }>();
    expect(ayses.events.map((event) => event.type)).toEqual(['login_otp']);
    expect(boras.events).toHaveLength(1);
    expect(boras.events[0]?.id).not.toBe(ayses.events[0]?.id);
    expect(
      (await call(test.app, { method: 'GET', url: '/v1/me/security-events' })).statusCode,
    ).toBe(401);
  });
});
