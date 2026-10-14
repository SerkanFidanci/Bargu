import { generateRequestNonce, signRequest } from '@bargu/crypto';
import type { WeatherSnapshot } from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.module.js';
import { gridPoints } from '../../src/weather/weather-grid.js';
import { WeatherWorker } from '../../src/weather/weather.worker.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { as, type Person, person } from './support/people.js';

let test: TestApp;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  test = await createTestApp();
  await test.app.listen(0, '127.0.0.1');
  url = await test.app.getUrl();
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await test.close();
});

function connect(who: Person): Promise<Socket> {
  const nonce = generateRequestNonce();
  const ts = Date.now();
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      path: EVENTS_PATH,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth: {
        token: who.session.accessToken,
        ts: String(ts),
        nonce,
        sig: signRequest(who.device.identity.secretKey, {
          method: 'GET',
          path: EVENTS_PATH,
          timestamp: ts,
          nonce,
          deviceId: who.device.deviceId,
          body: new Uint8Array(0),
        }),
      },
    });
    sockets.push(socket);
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', reject);
  });
}

describe('weather', () => {
  it('fetches only the grid, serves the same snapshot to everyone and announces it live', async () => {
    const ayse = await person(test);
    // Nothing fetched yet.
    expect((await as(test, ayse, 'GET', '/v1/weather')).statusCode).toBe(404);
    const socket = await connect(ayse);
    const announced: { at: number }[] = [];
    socket.on('weather', (payload: { at: number }) => {
      announced.push(payload);
    });

    const requested: string[] = [];
    const fakeFetch: typeof fetch = (input) => {
      requested.push(input instanceof Request ? input.url : input.toString());
      const body = gridPoints().map(() => ({
        current: {
          weather_code: 71,
          is_day: 0,
          temperature_2m: -2,
          cloud_cover: 90,
          precipitation: 1.2,
          wind_speed_10m: 8,
        },
      }));
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    };
    const worker = new WeatherWorker(
      test.app.get<RedisClient>(REDIS),
      testEnv({ WEATHER_URL: 'https://weather.example.test/v1/forecast' }),
    );
    expect(await worker.refresh(fakeFetch, 1_800_000_000_000)).toBe(true);
    // A second worker in the same period does not fetch again.
    expect(await worker.refresh(fakeFetch)).toBe(false);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('https://weather.example.test/v1/forecast?latitude=36%2C36');

    await vi.waitFor(() => {
      expect(announced).toEqual([{ at: 1_800_000_000_000 }]);
    });
    const snapshot = (await as(test, ayse, 'GET', '/v1/weather')).json<WeatherSnapshot>();
    expect(snapshot.at).toBe(1_800_000_000_000);
    expect(snapshot.cells[0]).toEqual([71, 0, -2, 90, 1.2, 8]);
  });
});
