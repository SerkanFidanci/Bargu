import { CLIENT_LEVEL, CLIENT_LEVEL_QUERY } from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { createTestApp, testEnv, type TestApp } from './support/app.js';
import { call } from './support/client.js';
import { person } from './support/people.js';

/** A server that serves this app and nothing older, and one with the default (every app). */
let strict: TestApp;
let open: TestApp;
const sockets: Socket[] = [];

beforeAll(async () => {
  strict = await createTestApp({ env: testEnv({ MIN_CLIENT_LEVEL: String(CLIENT_LEVEL) }) });
  open = await createTestApp();
  for (const test of [strict, open]) await test.app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await strict.close();
  await open.close();
});

/** What the event socket answers a handshake with no credentials: its refusal, or "connected". */
async function handshake(test: TestApp, query: Record<string, string>): Promise<string> {
  const url = await test.app.getUrl();
  return new Promise((resolve) => {
    const socket = io(url, {
      path: EVENTS_PATH,
      transports: ['websocket'],
      auth: {},
      query,
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    socket.once('connect', () => {
      resolve('connected');
    });
    socket.once('connect_error', (error) => {
      resolve(error.message);
    });
  });
}

describe('the oldest app served (QA 19 P4)', () => {
  it('tells an app older than the server serves to update, before anything else', async () => {
    const ayla = await person(strict);
    const old = await call(strict.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: ayla.session.accessToken,
      clientLevel: null,
    });
    expect(old.statusCode).toBe(426);
    expect(old.json()).toEqual({
      statusCode: 426,
      error: 'UPGRADE_REQUIRED',
      code: 'UPGRADE_REQUIRED',
    });
    // Even a request refused anyway (no session, no signature) hears it first.
    const older = await call(strict.app, {
      url: '/v1/auth/refresh',
      body: { refreshToken: 'x' },
      clientLevel: CLIENT_LEVEL - 1,
    });
    expect(older.statusCode).toBe(426);
    const current = await call(strict.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: ayla.session.accessToken,
    });
    expect(current.statusCode).toBe(200);
  });

  it('leaves the account web page and the health checks alone (a browser sends no level)', async () => {
    const code = await call(strict.app, { url: '/v1/web/code', body: {}, clientLevel: null });
    expect(code.statusCode).not.toBe(426);
    for (const url of ['/hesap', '/health/live']) {
      expect((await call(strict.app, { method: 'GET', url, clientLevel: null })).statusCode).toBe(
        200,
      );
    }
  });

  it('refuses an old app on the event socket too', async () => {
    expect(await handshake(strict, {})).toBe('UPGRADE_REQUIRED');
    // With its level, the handshake goes on to the credentials (none here).
    expect(await handshake(strict, { [CLIENT_LEVEL_QUERY]: String(CLIENT_LEVEL) })).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('serves every app by default, also those that send no level', async () => {
    const bora = await person(open);
    const old = await call(open.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: bora.session.accessToken,
      clientLevel: null,
    });
    expect(old.statusCode).toBe(200);
    expect(await handshake(open, {})).toBe('UNAUTHENTICATED');
  });
});
