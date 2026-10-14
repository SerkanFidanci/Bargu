import { describe, expect, it, vi } from 'vitest';

import { FcmClient, FcmRejected } from './fcm.js';
import { PUSH_KINDS, pushText } from './push-texts.js';

/** A throwaway RSA key in PEM (WebCrypto: test files stay off node:crypto too). */
async function testPrivateKeyPem(): Promise<string> {
  const keys = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey));
  return `-----BEGIN PRIVATE KEY-----
${pkcs8.toString('base64')}
-----END PRIVATE KEY-----
`;
}

const account = {
  client_email: 'push@bargu-test.iam.gserviceaccount.com',
  private_key: await testPrivateKeyPem(),
  project_id: 'bargu-test',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(send: (body: unknown) => Response) {
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return Promise.resolve(json(200, { access_token: 'google-token', expires_in: 3600 }));
    }
    return Promise.resolve(send(JSON.parse(init.body as string)));
  });
  return { fcm: new FcmClient(account, fetchMock as unknown as typeof fetch), fetchMock };
}

const message = {
  token: 'device-token',
  ...pushText('circleInvite', 'tr'),
  data: { kind: 'circleInvite', circleId: '0190a8a0-0000-7000-8000-0000000000c1' },
  tag: 'circleInvite:0190a8a0-0000-7000-8000-0000000000c1',
};

describe('FcmClient', () => {
  it('sends a high-priority notification on the friends channel, authorised as our account', async () => {
    let sent: unknown;
    const { fcm, fetchMock } = client((body) => {
      sent = body;
      return json(200, { name: 'projects/bargu-test/messages/1' });
    });
    await expect(fcm.send(message)).resolves.toBe('sent');
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/bargu-test/messages:send');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer google-token');
    expect(sent).toEqual({
      message: {
        token: 'device-token',
        notification: { title: 'Bargu', body: 'Bir çembere davet edildin' },
        data: message.data,
        android: {
          priority: 'HIGH',
          notification: { channel_id: 'social', tag: message.tag },
        },
      },
    });
    // The Google access token is reused, not fetched per message.
    await fcm.send(message);
    expect(fetchMock.mock.calls.filter(([u]) => u.includes('oauth2'))).toHaveLength(1);
  });

  it('reports a dead token, refuses a malformed message for good, and retries the rest', async () => {
    await expect(
      client(() =>
        json(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }),
      ).fcm.send(message),
    ).resolves.toBe('unregistered');
    await expect(
      client(() => json(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } })).fcm.send(
        message,
      ),
    ).rejects.toBeInstanceOf(FcmRejected);
    const retry = client(() => json(503, {})).fcm.send(message);
    await expect(retry).rejects.toThrow('FCM 503');
    await expect(retry).rejects.not.toBeInstanceOf(FcmRejected);
  });
});

describe('push texts', () => {
  it('say what happened, never who or where', () => {
    for (const kind of PUSH_KINDS) {
      for (const locale of ['tr', 'en'] as const) {
        const { title, body } = pushText(kind, locale);
        expect(title).toBe('Bargu');
        expect(body).not.toMatch(/\{\{|\}\}|%s/);
        expect(body.length).toBeGreaterThan(5);
      }
    }
  });
});
