import { createServer, type Http2Server, type IncomingHttpHeaders } from 'node:http2';
import type { AddressInfo } from 'node:net';

import { generateDeviceKeys, openPush, randomUuid } from '@bargu/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApnsClient, ApnsRejected } from './apns.js';
import { sealedFor } from './push.worker.js';
import type { PushTarget } from './push-tokens.js';

/** A throwaway P-256 key in PEM, as Apple hands out (.p8). */
async function testP8(): Promise<string> {
  const keys = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`;
}

interface Seen {
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Http2Server;
let origin = '';
const seen: Seen[] = [];
let reply: { status: number; body?: unknown } = { status: 200 };

// A local HTTP/2 server (cleartext) standing in for api.push.apple.com.
beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      seen.push({ headers: request.headers, body });
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const key = await testP8();
const message = {
  token: 'ab12cd',
  title: 'Bargu',
  body: 'Yeni bir bildirimin var',
  sealed: 'AQ-x',
};

function decodeJwt(header: string | string[] | undefined) {
  const [head, claims] = String(header).replace('bearer ', '').split('.');
  const json = (part = '') => JSON.parse(Buffer.from(part, 'base64url').toString()) as unknown;
  return { head: json(head), claims: json(claims) };
}

describe('ApnsClient', () => {
  it('sends a mutable alert with only a placeholder and the sealed box, signed as our team', async () => {
    const apns = new ApnsClient({
      key,
      keyId: 'KEY1234567',
      teamId: 'TEAM123456',
      topic: 'app.bargu',
      origin,
    });
    reply = { status: 200 };
    await expect(apns.send(message)).resolves.toBe('sent');
    const [first] = seen.splice(0);
    expect(first?.headers[':path']).toBe('/3/device/ab12cd');
    expect(first?.headers['apns-topic']).toBe('app.bargu');
    expect(first?.headers['apns-push-type']).toBe('alert');
    expect(JSON.parse(first?.body ?? '')).toEqual({
      aps: {
        alert: { title: 'Bargu', body: 'Yeni bir bildirimin var' },
        'mutable-content': 1,
        sound: 'default',
      },
      bargu: 'AQ-x',
    });
    const jwt = decodeJwt(first?.headers.authorization);
    expect(jwt.head).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(jwt.claims).toMatchObject({ iss: 'TEAM123456' });
    // The provider token is reused (Apple refuses renewals more often than every 20 minutes).
    await apns.send(message);
    const [second] = seen.splice(0);
    expect(second?.headers.authorization).toBe(first?.headers.authorization);
    apns.close();
  });

  it('forgets dead tokens, refuses malformed messages for good, retries the rest', async () => {
    const apns = new ApnsClient({
      key,
      keyId: 'KEY1234567',
      teamId: 'TEAM123456',
      topic: 'app.bargu',
      origin,
    });
    reply = { status: 410, body: { reason: 'Unregistered' } };
    await expect(apns.send(message)).resolves.toBe('unregistered');
    reply = { status: 400, body: { reason: 'BadDeviceToken' } };
    await expect(apns.send(message)).resolves.toBe('unregistered');
    reply = { status: 400, body: { reason: 'PayloadEmpty' } };
    await expect(apns.send(message)).rejects.toBeInstanceOf(ApnsRejected);
    reply = { status: 503 };
    const retry = apns.send(message);
    await expect(retry).rejects.toThrow('APNs 503');
    await expect(retry).rejects.not.toBeInstanceOf(ApnsRejected);
    seen.splice(0);
    apns.close();
  });
});

describe('what the worker sends', () => {
  const device = generateDeviceKeys(randomUuid());
  const target: PushTarget = {
    userId: randomUuid(),
    deviceId: device.deviceId,
    dhKey: device.dh.publicKey,
    platform: 'android',
    token: 't',
    locale: 'tr',
  };
  const circleId = randomUuid();

  it("seals the server's notices for the device: kind and circle, nothing else", () => {
    const sealed = sealedFor(
      { type: 'notice', userId: target.userId, notice: 'circleInvite', circleId },
      target,
      1_000,
    );
    expect(sealed).not.toBeNull();
    expect(sealed).not.toContain('circleInvite');
    expect(
      openPush({ recipient: device, sealed: sealed ?? '', senderIdentityKey: () => null }),
    ).toEqual({
      senderDeviceId: null,
      body: { kind: 'notice', notice: 'circleInvite', circleId, ts: 1_000 },
    });
  });

  it("carries a member's sealed box only to the device it was made for", () => {
    const job = { type: 'sealed', userId: target.userId, sealed: 'AQ-x' } as const;
    expect(sealedFor({ ...job, deviceId: target.deviceId }, target)).toBe('AQ-x');
    expect(sealedFor({ ...job, deviceId: randomUuid() }, target)).toBeNull();
  });
});
