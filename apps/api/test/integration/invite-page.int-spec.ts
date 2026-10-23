import {
  generatePhotoKey,
  generateToken,
  randomUuid,
  sealProfilePhoto,
  toBase64url,
} from '@bargu/crypto';
import type { GuardianCode, Invite } from '@bargu/schemas';
import type { Pool } from 'pg';
import type { Response } from 'light-my-request';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { inviteHostOf } from '../../src/config/env.js';
import { PG_POOL } from '../../src/infra/database/tokens.js';
import { INVITE_CARD_HEIGHT, INVITE_CARD_WIDTH } from '../../src/invite-page/invite-card.js';
import { createTestApp, type TestApp } from './support/app.js';
import { nextIp } from './support/client.js';
import { as, createCircle, person, type Person } from './support/people.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

/** What a messaging app's server, or a browser, sends: a plain GET, from some network. */
function get(
  url: string,
  options: { ip?: string; language?: string; method?: 'GET' | 'HEAD' } = {},
): Promise<Response> {
  return test.app.inject({
    method: options.method ?? 'GET',
    url,
    headers: options.language === undefined ? {} : { 'accept-language': options.language },
    remoteAddress: options.ip ?? nextIp(),
  });
}

/** Everything of an answer that must not tell tokens apart (the request id is per request). */
function whatIsSent(response: Response) {
  const headers = Object.entries(response.headers)
    .filter(([name]) => name !== 'x-request-id' && name !== 'date')
    .sort(([a], [b]) => a.localeCompare(b));
  return { status: response.statusCode, headers, body: response.body };
}

/** A real invitation from `owner`, in each state a link can be in. */
interface Links {
  live: string;
  unknown: string;
  expired: string;
  used: string;
  revoked: string;
}

const NAME = 'Zeynep Hanım Çelikoğlu';
const CIRCLE_NAME = 'Çelikoğlu Ailesi 4471';

let owner: Person;
let guest: Person;
let photoId: string;
let links: Links;
let circleId: string;

beforeAll(async () => {
  [owner, guest] = await Promise.all([person(test, NAME), person(test, 'Misafir Kişi')]);
  // A profile photo, as a real account has one.
  photoId = randomUuid();
  const sealed = sealProfilePhoto(
    generatePhotoKey(),
    photoId,
    new Uint8Array(2_000).map((_, index) => (index * 11) % 256),
  );
  const upload = await as(test, owner, 'PUT', '/v1/me/photo', {
    photoId,
    ciphertext: toBase64url(sealed),
  });
  expect(upload.statusCode).toBe(204);
  circleId = (await createCircle(test, owner, CIRCLE_NAME)).id;

  const invite = async (kind: 'friend' | 'circle'): Promise<Invite> => {
    const response = await as(
      test,
      owner,
      'POST',
      '/v1/invites',
      kind === 'friend' ? { kind } : { kind, circleId },
    );
    expect(response.statusCode).toBe(201);
    return response.json<Invite>();
  };
  const [live, expired, used, revoked] = await Promise.all([
    invite('circle'),
    invite('friend'),
    invite('friend'),
    invite('circle'),
  ]);
  await test.admin.query(
    `UPDATE app.invites SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [expired.id],
  );
  expect(
    (await as(test, guest, 'POST', '/v1/invites/accept', { token: used.token })).statusCode,
  ).toBe(200);
  expect((await as(test, owner, 'POST', `/v1/invites/${revoked.id}/revoke`)).statusCode).toBe(204);
  links = {
    live: live.token,
    unknown: generateToken(),
    expired: expired.token,
    used: used.token,
    revoked: revoked.token,
  };
});

const STATES = ['live', 'unknown', 'expired', 'used', 'revoked'] as const;

describe('the invite page: one answer for every token (docs/ADR/0009 Ek, 2026-10-22)', () => {
  it('sends the same status, headers and bytes for a live, unknown, expired, used and revoked token', async () => {
    for (const prefix of ['/i/', '/g/']) {
      const answers = await Promise.all(STATES.map((state) => get(`${prefix}${links[state]}`)));
      const [first, ...others] = answers.map(whatIsSent);
      expect(first?.status).toBe(200);
      expect(first?.body.length).toBeGreaterThan(500);
      for (const other of others) expect(other).toEqual(first);
    }
    // An invitation's page and a guardian request's are the same too: the path says nothing more.
    const invite = await get(`/i/${links.live}`);
    const guardian = await get(`/g/${links.live}`);
    expect(whatIsSent(guardian)).toEqual(whatIsSent(invite));
  });

  it('sends the same for a real guardian code and one that never existed', async () => {
    const child = await person(test, 'Deniz', '15-17');
    const code = (await as(test, child, 'POST', '/v1/guardians/code')).json<GuardianCode>();
    const real = await get(`/g/${code.token}`);
    const unknown = await get(`/g/${generateToken()}`);
    expect(real.statusCode).toBe(200);
    expect(whatIsSent(unknown)).toEqual(whatIsSent(real));
    expect(real.body).not.toContain(code.token);
  });

  it('looks nothing up: no query and no connection of the database pool', async () => {
    const pool = test.app.get<Pool>(PG_POOL);
    const queried = vi.spyOn(pool, 'query');
    const connected = vi.spyOn(pool, 'connect');
    try {
      for (const state of STATES) {
        expect((await get(`/i/${links[state]}`)).statusCode).toBe(200);
        expect((await get(`/g/${links[state]}`)).statusCode).toBe(200);
      }
      // The shared links' own addresses (the token is in the fragment) look nothing up either.
      expect((await get('/i')).statusCode).toBe(200);
      expect((await get('/g')).statusCode).toBe(200);
      expect(queried).not.toHaveBeenCalled();
      expect(connected).not.toHaveBeenCalled();
    } finally {
      queried.mockRestore();
      connected.mockRestore();
    }
  });

  it('takes about the same time for each (coarse: medians of interleaved requests)', async () => {
    const times = new Map<string, number[]>(STATES.map((state) => [state, []]));
    const timed = async (state: (typeof STATES)[number]): Promise<number> => {
      const started = performance.now();
      await get(`/i/${links[state]}`);
      return performance.now() - started;
    };
    for (let warmUp = 0; warmUp < 10; warmUp += 1) {
      for (const state of STATES) await timed(state);
    }
    // Interleaved, so a slow moment of the machine hits every state alike.
    for (let round = 0; round < 40; round += 1) {
      for (const state of STATES) times.get(state)?.push(await timed(state));
    }
    const medians = STATES.map((state) => {
      const sorted = [...(times.get(state) ?? [])].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
    });
    const [fastest, slowest] = [Math.min(...medians), Math.max(...medians)];
    // Loose on purpose (a shared machine): the real guarantee is the test above, which shows no
    // database is touched. This only catches a lookup that came back with a different cost.
    expect(slowest).toBeLessThan(fastest * 3 + 10);
  });

  it('holds nothing about a real invite: no name, photo, circle, count, avatar or token', async () => {
    const ownerProfile = await as(test, owner, 'GET', '/v1/me');
    expect(ownerProfile.statusCode).toBe(200);
    const pages = await Promise.all([
      get(`/i/${links.live}`),
      get(`/g/${links.live}`),
      get(`/i/${links.live}`, { language: 'en' }),
    ]);
    const image = await get('/invite/card.png');
    for (const response of [...pages, image]) {
      expect(response.statusCode).toBe(200);
      // Headers (Link, Location, cookies ...) and the body (not the image's bytes), any spelling.
      // Not the request id: a random UUID that held "4471" once (CI, f673470), nothing of the invite.
      const headers = Object.fromEntries(
        Object.entries(response.headers).filter(([name]) => name !== 'x-request-id'),
      );
      const everything = JSON.stringify(headers) + (response === image ? '' : response.body);
      const text = everything.toLowerCase();
      for (const secret of [
        links.live,
        owner.username,
        owner.userId,
        owner.email,
        guest.username,
        guest.userId,
        photoId,
        circleId,
        'zeynep',
        'çelikoğlu',
        'celikoglu',
        'ailesi',
        '4471',
        'misafir',
      ]) {
        expect(text, secret).not.toContain(secret.toLowerCase());
      }
    }
    // Only the generic things: the card, in the host's own address.
    const html = pages[0].body;
    expect(html).toContain(`content="https://${inviteHostOf(test.env)}/invite/card.png"`);
    // No count of people either ("3 üye", "5 members").
    expect(html).not.toMatch(/\d+\s*(kişi|üye|member|people)/i);
    expect(html).not.toContain('/v1/');
    expect(html).not.toContain('bargu://');
  });

  it('says what a cache and a crawler need to know', async () => {
    const response = await get(`/i/${links.live}`);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.headers.vary).toBe('accept-language');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.body).toContain('<meta name="robots" content="noindex, nofollow">');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/]+=*'/);
    expect(csp).not.toMatch(/script-src|unsafe|\*|https?:/);
    // Still the platform's usual hardening.
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers a HEAD request like the GET, without the body', async () => {
    const [head, full] = await Promise.all([
      get(`/i/${links.live}`, { method: 'HEAD' }),
      get(`/i/${links.live}`),
    ]);
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(whatIsSent(head).headers).toEqual(whatIsSent(full).headers);
  });

  it('is Turkish unless the browser prefers English', async () => {
    const turkish = await get(`/i/${links.live}`);
    expect(turkish.body).toContain('<html lang="tr">');
    expect(turkish.body).toContain('<title>Bargu&#39;ya davet</title>');
    expect(turkish.body).toContain(
      'Uygulama yüklüyse bağlantıya mesajlaşma uygulamasından yeniden dokun.',
    );
    expect(turkish.body).toContain('Bargu yakında Google Play&#39;de.');
    const english = await get(`/i/${links.live}`, { language: 'en-US,en;q=0.9,tr;q=0.5' });
    expect(english.body).toContain('<html lang="en">');
    expect(english.body).toContain('Invitation to Bargu');
    expect(english.body).toContain(
      'If the app is installed, tap the link again in your messaging app.',
    );
    // Language never depends on the token either.
    const unknownEnglish = await get(`/i/${links.unknown}`, { language: 'en-US,en;q=0.9' });
    expect(whatIsSent(unknownEnglish)).toEqual(whatIsSent(english));
  });

  it('offers no way to download the app from the page (links travel from hand to hand)', async () => {
    const { body } = await get(`/i/${links.live}`);
    expect(body).not.toMatch(/\.apk|\/apk\/|\/map\/|download|indir/i);
    // No link at all: the page tells what to do (tap the link again in the messaging app).
    expect(body).not.toMatch(/<a[\s>]|href=/);
  });

  it.each([
    ['too short', 'abc'],
    ['one character too long', `${generateToken()}A`],
    ['one character too short', generateToken().slice(1)],
    ['not base64url', `${generateToken().slice(1)}!`],
    ['padding', `${generateToken().slice(0, 42)}=`],
    ['a dot', `${generateToken().slice(1)}.`],
  ])('is a plain 404 for what is not token shaped: %s', async (_, text) => {
    for (const prefix of ['/i/', '/g/']) {
      const response = await get(`${prefix}${encodeURIComponent(text)}`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ statusCode: 404, error: 'NOT_FOUND', code: 'NOT_FOUND' });
      expect(response.body).not.toContain(text);
      // An error is the API's JSON, never cacheable as the page.
      expect(String(response.headers['content-type'])).toMatch(/^application\/json/);
      expect(response.headers['cache-control'] ?? '').not.toContain('max-age=300');
      expect(String(response.headers['content-security-policy'])).not.toMatch(/sha256/);
    }
  });

  it('is a 404 with an empty token, a trailing path, or on other methods', async () => {
    expect((await get('/i/')).statusCode).toBe(404);
    expect((await get(`/i/${links.live}/extra`)).statusCode).toBe(404);
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      for (const url of [`/i/${links.live}`, '/i', '/g']) {
        const response = await test.app.inject({ method, url });
        expect(response.statusCode).toBe(404);
      }
    }
  });

  it('keeps the query string out of the answer', async () => {
    const plain = await get(`/i/${links.live}`);
    const withQuery = await get(`/i/${links.live}?next=%3Cscript%3E&utm_source=x`);
    expect(whatIsSent(withQuery)).toEqual(whatIsSent(plain));
    expect(withQuery.body).not.toContain('utm_source');
  });

  it('counts each network apart, whatever the token (alternating tokens share one budget)', async () => {
    const busy = '203.0.113.50';
    const quiet = '203.0.113.51';
    // One network's budget is 300 an hour; the 301st is refused whether the token exists or not.
    // The page of a shared link (no token in the request) and of an earlier link share the budget.
    for (let hit = 0; hit < 300; hit += 1) {
      const state = STATES[hit % STATES.length] ?? 'live';
      const url = hit % 5 === 0 ? (hit % 10 === 0 ? '/i' : '/g') : `/i/${links[state]}`;
      const response = await get(url, { ip: busy });
      if (response.statusCode !== 200) throw new Error(`hit ${String(hit)}: ${response.body}`);
    }
    const refusedLive = await get(`/i/${links.live}`, { ip: busy });
    const refusedUnknown = await get(`/g/${links.unknown}`, { ip: busy });
    const refusedFragment = await get('/i', { ip: busy });
    for (const refused of [refusedLive, refusedUnknown, refusedFragment]) {
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(refused.headers['cache-control'] ?? '').not.toContain('max-age=300');
    }
    expect(refusedUnknown.body).toBe(refusedLive.body);
    expect(refusedFragment.body).toBe(refusedLive.body);
    // Another network is not held back, and the card image is not counted at all.
    expect((await get(`/i/${links.live}`, { ip: quiet })).statusCode).toBe(200);
    expect((await get('/invite/card.png', { ip: busy })).statusCode).toBe(200);
  });
});

describe('shared links keep the token in the fragment, never in the request (docs/ADR/0009 Ek 2)', () => {
  const host = () => inviteHostOf(test.env);

  it('makes the link of an invite and of a guardian code with the token after the #', async () => {
    const invite = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'friend' })
    ).json<Invite>();
    const circleInvite = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId })
    ).json<Invite>();
    const child = await person(test, 'Deniz', '15-17');
    const code = (await as(test, child, 'POST', '/v1/guardians/code')).json<GuardianCode>();

    expect(invite.link).toBe(`https://${host()}/i#${invite.token}`);
    expect(circleInvite.link).toBe(`https://${host()}/i#${circleInvite.token}`);
    expect(code.link).toBe(`https://${host()}/g#${code.token}`);

    for (const [shared, token, path] of [
      [invite.link, invite.token, '/i'],
      [circleInvite.link, circleInvite.token, '/i'],
      [code.link, code.token, '/g'],
    ] as const) {
      const url = new URL(shared);
      expect([url.protocol, url.host, url.pathname, url.search]).toEqual([
        'https:',
        host(),
        path,
        '',
      ]);
      expect(url.hash).toBe(`#${token}`);
      // What a browser or a preview crawler sends for it is everything before the #: no token.
      const request = `${url.pathname}${url.search}`;
      expect(request).not.toContain(token);
      const page = await get(request);
      expect(page.statusCode).toBe(200);
      expect(JSON.stringify(page.headers) + page.body).not.toContain(token);
    }
  });

  it('serves the same page for /i, /g and the earlier /i/<token>, in the same bytes', async () => {
    const earlier = await get(`/i/${links.live}`);
    const fragmentInvite = await get('/i');
    const fragmentGuardian = await get('/g');
    expect(fragmentInvite.statusCode).toBe(200);
    expect(whatIsSent(fragmentInvite)).toEqual(whatIsSent(earlier));
    expect(whatIsSent(fragmentGuardian)).toEqual(whatIsSent(earlier));
    // The same in English, and not changed by a query string.
    const english = await get('/i', { language: 'en' });
    expect(english.body).toContain('Invitation to Bargu');
    expect(whatIsSent(await get(`/i/${links.unknown}`, { language: 'en' }))).toEqual(
      whatIsSent(english),
    );
    expect(whatIsSent(await get('/g?utm_source=x&next=%3Cscript%3E'))).toEqual(whatIsSent(earlier));
  });

  it('has the page of a shared link say nothing about any token, and run no script to read it', async () => {
    const { body } = await get('/i');
    expect(body).not.toMatch(/<script|<a[\s>]|href=|location|hash|fragment/i);
    expect(body).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('answers a HEAD request like the GET', async () => {
    const [head, full] = await Promise.all([get('/i', { method: 'HEAD' }), get('/i')]);
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(whatIsSent(head).headers).toEqual(whatIsSent(full).headers);
  });

  it.each(['/ii', '/gg', '/I', '/G', '/i/', '/g/', '/i//', '/i/x/y', '/invite', '/i.html', '/i;x'])(
    'is a 404 for %s',
    async (path) => {
      expect((await get(path)).statusCode).toBe(404);
    },
  );
});

describe('the card image and Android App Links of the invite host', () => {
  it('serves one generic PNG that other sites may show', async () => {
    const response = await get('/invite/card.png');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const png = response.rawPayload;
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(INVITE_CARD_WIDTH);
    expect(png.readUInt32BE(20)).toBe(INVITE_CARD_HEIGHT);
    // The same bytes for everyone, whatever they ask with.
    const again = await get('/invite/card.png?token=' + links.live, { language: 'en' });
    expect(again.rawPayload.equals(png)).toBe(true);
  });

  it('vouches for the app on the same host, with the certificate of this environment', async () => {
    const response = await get('/.well-known/assetlinks.json');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.json()).toEqual([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: test.env.ANDROID_PACKAGE,
          sha256_cert_fingerprints: test.env.ANDROID_CERT_SHA256,
        },
      },
    ]);
    expect(test.env.ANDROID_CERT_SHA256).toEqual([Array(32).fill('AA').join(':')]);
  });
});
