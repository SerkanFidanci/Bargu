import type { DeviceKeys } from '@bargu/crypto';
import type { Session } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REFRESH_RETRY_GRACE_MS } from '../../src/auth/sessions.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login, newDevice, uniqueEmail } from './support/client.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const refresh = (refreshToken: string, device?: DeviceKeys, signer?: DeviceKeys) =>
  call(test.app, {
    url: '/v1/auth/refresh',
    body: { refreshToken },
    ...(device === undefined ? {} : { device }),
    ...(signer === undefined ? {} : { sign: { signer } }),
  });

const me = (accessToken: string) => call(test.app, { method: 'GET', url: '/v1/me', accessToken });

async function events(userId: string): Promise<string[]> {
  const { rows } = await test.admin.query<{ type: string }>(
    'SELECT type FROM app.security_events WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows.map((row) => row.type);
}

/** Moves a token's "used" time into the past, as if the grace window had passed. */
async function age(refreshToken: string, milliseconds: number): Promise<void> {
  const id = refreshToken.split('.')[2];
  await test.admin.query(
    `UPDATE app.refresh_tokens SET used_at = used_at - make_interval(secs => $2) WHERE id = $1`,
    [id, milliseconds / 1000],
  );
}

describe('refresh token rotation', () => {
  it('rotates on every use and keeps the session alive', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const response = await refresh(session.refreshToken, device);
    expect(response.statusCode).toBe(200);
    const next = response.json<Session>();
    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(next.userId).toBe(session.userId);
    expect((await me(next.accessToken)).statusCode).toBe(200);
  });

  it('revokes the whole family when a rotated token is reused (theft)', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const rotated = (await refresh(session.refreshToken, device)).json<Session>();
    await age(session.refreshToken, REFRESH_RETRY_GRACE_MS + 1_000);

    const reuse = await refresh(session.refreshToken, device);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({ code: 'REFRESH_INVALID' });
    // Everything issued in that family is dead now, including the legitimate latest pair.
    expect((await refresh(rotated.refreshToken, device)).statusCode).toBe(401);
    expect((await me(rotated.accessToken)).json()).toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(await events(session.userId)).toContain('refresh_reuse');
  });

  it('treats a quick retry of a lost response as a retry, once', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const lost = (await refresh(session.refreshToken, device)).json<Session>();
    const retried = await refresh(session.refreshToken, device);
    expect(retried.statusCode).toBe(200);
    // The pair the client never saw is retired; the retried chain continues.
    expect((await refresh(lost.refreshToken, device)).statusCode).toBe(401);
  });

  it('needs the device signature and changes nothing without it', async () => {
    const { session, device } = await login(test, uniqueEmail());
    expect((await refresh(session.refreshToken)).json()).toMatchObject({
      code: 'SIGNATURE_REQUIRED',
    });
    expect((await refresh(session.refreshToken, device, newDevice())).json()).toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
    expect((await refresh(session.refreshToken, device)).statusCode).toBe(200);
  });

  it('rejects malformed, unknown and expired tokens', async () => {
    const { session, device } = await login(test, uniqueEmail());
    expect((await refresh('not-a-token', device)).statusCode).toBe(401);
    const forged = session.refreshToken.replace(/.{4}$/, 'AAAA');
    expect((await refresh(forged, device)).statusCode).toBe(401);
    await test.admin.query(
      `UPDATE app.refresh_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [session.refreshToken.split('.')[2]],
    );
    expect((await refresh(session.refreshToken, device)).statusCode).toBe(401);
  });
});

describe('one active device per account', () => {
  it('logging in on a new device ends the old device everywhere', async () => {
    const email = uniqueEmail();
    const first = await login(test, email);
    const second = await login(test, email);
    expect(second.session.userId).toBe(first.session.userId);

    expect((await me(first.session.accessToken)).json()).toMatchObject({ code: 'DEVICE_REVOKED' });
    expect((await refresh(first.session.refreshToken, first.device)).statusCode).toBe(401);
    expect((await me(second.session.accessToken)).statusCode).toBe(200);
    expect(await events(first.session.userId)).toContain('device_replaced');

    const { rows } = await test.admin.query<{ active: number }>(
      'SELECT count(*)::int AS active FROM app.devices WHERE user_id = $1 AND revoked_at IS NULL',
      [first.session.userId],
    );
    expect(rows[0]?.active).toBe(1);
  });

  it('a revoked device can never come back; the app must create new keys', async () => {
    const email = uniqueEmail();
    const first = await login(test, email);
    await login(test, email);
    await expect(login(test, email, first.device)).rejects.toThrow(/DEVICE_REVOKED/);
  });

  it('the same device logging in again keeps the device but ends its older sessions', async () => {
    const email = uniqueEmail();
    const first = await login(test, email);
    const again = await login(test, email, first.device);
    expect((await refresh(first.session.refreshToken, first.device)).statusCode).toBe(401);
    expect((await me(again.session.accessToken)).statusCode).toBe(200);
  });

  it("refuses another account's device id or identity key", async () => {
    const owner = await login(test, uniqueEmail());
    await expect(login(test, uniqueEmail(), owner.device)).rejects.toThrow(/DEVICE_CONFLICT/);
  });
});

describe('accounts awaiting deletion', () => {
  it('cannot be logged into or re-created with the same address', async () => {
    const email = uniqueEmail();
    const { session } = await login(test, email);
    await test.admin.query('UPDATE app.users SET deleted_at = now() WHERE id = $1', [
      session.userId,
    ]);
    await expect(login(test, email)).rejects.toThrow(/ACCOUNT_UNAVAILABLE/);
  });
});

describe('logout', () => {
  it('ends the session and retires the device', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const response = await call(test.app, {
      url: '/v1/auth/logout',
      accessToken: session.accessToken,
      device,
    });
    expect(response.statusCode).toBe(204);
    expect((await me(session.accessToken)).statusCode).toBe(401);
    expect((await refresh(session.refreshToken, device)).statusCode).toBe(401);
    expect(await events(session.userId)).toContain('logout');
  });
});
