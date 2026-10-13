import { type DeviceKeys, randomUuid } from '@bargu/crypto';
import type { Me, Session, UsernameAvailability } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROFILE_LIMITS } from '../../src/users/profile.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login, uniqueEmail } from './support/client.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

interface Account {
  session: Session;
  device: DeviceKeys;
}

const signIn = (): Promise<Account> => login(test, uniqueEmail());

const me = (account: Account) =>
  call(test.app, { method: 'GET', url: '/v1/me', accessToken: account.session.accessToken });

const update = (account: Account, body: unknown) =>
  call(test.app, {
    method: 'PATCH',
    url: '/v1/me',
    body,
    accessToken: account.session.accessToken,
    device: account.device,
  });

const availability = (account: Account, username: string) =>
  call(test.app, {
    method: 'GET',
    url: `/v1/usernames/availability?username=${encodeURIComponent(username)}`,
    accessToken: account.session.accessToken,
  });

/** A fresh, valid username (the suite shares one database with other files). */
const uniqueName = () => `u${randomUuid().replaceAll('-', '').slice(-12)}`;

describe('profile', () => {
  it('starts empty and saves username, display name and avatar together', async () => {
    const account = await signIn();
    expect((await me(account)).json<Me>()).toMatchObject({
      username: null,
      displayName: null,
      avatar: null,
    });

    const username = uniqueName();
    const response = await update(account, {
      username: `@${username.toUpperCase()}`,
      displayName: '  Ayşe   Yılmaz ',
      avatar: { color: 4, emoji: '🦊' },
    });
    expect(response.statusCode).toBe(200);
    const expected = { username, displayName: 'Ayşe Yılmaz', avatar: { color: 4, emoji: '🦊' } };
    expect(response.json<Me>()).toMatchObject(expected);
    expect((await me(account)).json<Me>()).toMatchObject(expected);
  });

  it('changes one field without touching the others', async () => {
    const account = await signIn();
    const username = uniqueName();
    await update(account, { username, displayName: 'Can' });
    const response = await update(account, { avatar: { color: 0, emoji: null } });
    expect(response.json<Me>()).toMatchObject({
      username,
      displayName: 'Can',
      avatar: { color: 0, emoji: null },
    });
  });

  it('gives a username to one account only, also under a race', async () => {
    const [first, second] = await Promise.all([signIn(), signIn()]);
    const username = uniqueName();
    const responses = await Promise.all([
      update(first, { username }),
      update(second, { username }),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = responses.find((response) => response.statusCode === 409);
    expect(loser?.json()).toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it.each([
    ['a reserved name', { username: 'b.a.r.g.u' }],
    ['an invalid name', { username: 'ayşe' }],
    ['an emoji outside the set', { avatar: { color: 1, emoji: '🫠' } }],
    ['an invisible display name', { displayName: '\u200B' }],
    ['an unknown field', { email: 'x@example.test' }],
    ['an empty update', {}],
  ])('refuses %s', async (_, body) => {
    const account = await signIn();
    const response = await update(account, body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires the device signature to change anything', async () => {
    const account = await signIn();
    const response = await call(test.app, {
      method: 'PATCH',
      url: '/v1/me',
      body: { displayName: 'Mallory' },
      accessToken: account.session.accessToken,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'SIGNATURE_REQUIRED' });
    expect((await me(account)).json<Me>().displayName).toBeNull();
  });

  it('lets nobody change another account (the target is always the caller)', async () => {
    const [alice, mallory] = await Promise.all([signIn(), signIn()]);
    await update(alice, { displayName: 'Alice' });
    // Mallory signs with her own device and token: whatever she sends, only her row changes.
    await update(mallory, { displayName: 'Alice (official)' });
    expect((await me(alice)).json<Me>().displayName).toBe('Alice');
    const forged = await call(test.app, {
      method: 'PATCH',
      url: '/v1/me',
      body: { displayName: 'pwned' },
      accessToken: alice.session.accessToken,
      device: alice.device,
      sign: { signer: mallory.device },
    });
    expect(forged.statusCode).toBe(401);
    expect((await me(alice)).json<Me>().displayName).toBe('Alice');
  });
});

describe('username availability', () => {
  it('explains why a name cannot be used', async () => {
    const [owner, asker] = await Promise.all([signIn(), signIn()]);
    const username = uniqueName();
    await update(owner, { username });

    const check = async (account: Account, name: string) =>
      (await availability(account, name)).json<UsernameAvailability>();

    expect(await check(asker, uniqueName())).toMatchObject({ available: true, reason: null });
    expect(await check(asker, username.toUpperCase())).toEqual({
      username,
      available: false,
      reason: 'taken',
    });
    // Your own name is available to you (re-saving it is not a conflict).
    expect(await check(owner, username)).toMatchObject({ available: true });
    expect(await check(asker, 'Destek')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await check(asker, 'a..b')).toMatchObject({ available: false, reason: 'invalid' });
  });

  it('keeps the name of a deleted account taken (no impersonation of its former owner)', async () => {
    const [gone, asker] = await Promise.all([signIn(), signIn()]);
    const username = uniqueName();
    await update(gone, { username });
    await test.admin.query('UPDATE app.users SET deleted_at = now() WHERE id = $1', [
      gone.session.userId,
    ]);
    expect((await availability(asker, username)).json()).toMatchObject({ reason: 'taken' });
  });

  it('needs a session and stops scraping', async () => {
    const anonymous = await call(test.app, {
      method: 'GET',
      url: '/v1/usernames/availability?username=ali',
    });
    expect(anonymous.statusCode).toBe(401);

    const account = await signIn();
    for (let i = 0; i < PROFILE_LIMITS.usernameChecksPerHour; i++) {
      expect((await availability(account, `name${String(i)}`)).statusCode).toBe(200);
    }
    const blocked = await availability(account, 'onemore');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('rejects malformed queries', async () => {
    const account = await signIn();
    const response = await call(test.app, {
      method: 'GET',
      url: `/v1/usernames/availability?username=${'a'.repeat(65)}`,
      accessToken: account.session.accessToken,
    });
    expect(response.statusCode).toBe(400);
  });
});
