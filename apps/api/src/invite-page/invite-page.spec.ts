import { sha256 } from '@bargu/crypto';
import { describe, expect, it } from 'vitest';

import { INVITE_CARD_HEIGHT, INVITE_CARD_PNG_BASE64, INVITE_CARD_WIDTH } from './invite-card.js';
import {
  INVITE_CARD_PATH,
  INVITE_PAGE_CSP,
  type InviteLanguage,
  pickInviteLanguage,
  renderInvitePage,
  renderInvitePages,
} from './invite-page.js';

const HOST = 'invite.bargu.test';
const LANGUAGES: readonly InviteLanguage[] = ['tr', 'en'];

describe('the invite page markup (docs/ADR/0009 Ek, 2026-10-22)', () => {
  it.each(LANGUAGES)('carries the Open Graph and Twitter card in %s', (language) => {
    const html = renderInvitePage(language, HOST);
    const image = `https://${HOST}${INVITE_CARD_PATH}`;
    for (const tag of [
      `<html lang="${language}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Bargu">',
      `<meta property="og:image" content="${image}">`,
      '<meta property="og:image:type" content="image/png">',
      `<meta property="og:image:width" content="${String(INVITE_CARD_WIDTH)}">`,
      `<meta property="og:image:height" content="${String(INVITE_CARD_HEIGHT)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:image" content="${image}">`,
      '<meta name="robots" content="noindex, nofollow">',
    ]) {
      expect(html).toContain(tag);
    }
    expect(html).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(html).toMatch(/<meta property="og:description" content="[^"]+">/);
  });

  it('is titled "Bargu\'ya davet" in Turkish (apostrophe escaped for the attribute)', () => {
    const html = renderInvitePage('tr', HOST);
    expect(html).toContain('<title>Bargu&#39;ya davet</title>');
    expect(html).toContain('Uygulamada aç');
    expect(html).toContain('Bargu yakında Google Play&#39;de.');
    expect(renderInvitePage('en', HOST)).toContain('<title>Invitation to Bargu</title>');
  });

  it.each(LANGUAGES)(
    'links to the same address, never to an APK or another site (%s)',
    (language) => {
      const html = renderInvitePage(language, HOST);
      // The one link is empty: it resolves to the page's own address, so the page never repeats the
      // token and every token gets the same bytes.
      expect([...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0])).toEqual([
        '<a class="open" href="">',
      ]);
      expect(html).not.toMatch(/\.apk/i);
      // The only addresses in the page are the card image's.
      const addresses = new Set(
        [...html.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((match) => match[0]),
      );
      expect([...addresses]).toEqual([`https://${HOST}${INVITE_CARD_PATH}`]);
    },
  );

  it.each(LANGUAGES)('has no script, form, frame or external resource (%s)', (language) => {
    const html = renderInvitePage(language, HOST);
    for (const forbidden of ['<script', '<form', '<iframe', '<img', '<link', '<base', ' src=']) {
      expect(html).not.toContain(forbidden);
    }
    // No event-handler attributes (onclick=, onload=, ...) and no inline style attributes.
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('allows exactly its own inline stylesheet by hash, and nothing else', () => {
    const html = renderInvitePage('tr', HOST);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style.length).toBeGreaterThan(100);
    const hash = Buffer.from(sha256(new TextEncoder().encode(style))).toString('base64');
    expect(INVITE_PAGE_CSP).toContain(`style-src 'sha256-${hash}'`);
    expect(INVITE_PAGE_CSP).toContain("default-src 'none'");
    expect(INVITE_PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(INVITE_PAGE_CSP).toContain("form-action 'none'");
    expect(INVITE_PAGE_CSP).toContain("base-uri 'none'");
    expect(INVITE_PAGE_CSP).not.toMatch(/unsafe|script-src|\*|https?:/);
  });

  it('is made from the host alone: the same input gives the same bytes', () => {
    const once = renderInvitePages(HOST);
    expect(renderInvitePages(HOST)).toEqual(once);
    expect(once.tr).not.toBe(once.en);
    expect(renderInvitePages('other.bargu.test').tr).not.toBe(once.tr);
  });

  it('escapes the host it is given (defence in depth, the host comes from configuration)', () => {
    const html = renderInvitePage('tr', 'a"><script>x</script>.test');
    expect(html).not.toContain('<script>');
    expect(html).toContain('a&quot;&gt;&lt;script&gt;x&lt;/script&gt;.test');
  });
});

describe('the language of the page', () => {
  it.each([
    [undefined, 'tr'],
    ['', 'tr'],
    ['tr', 'tr'],
    ['tr-TR,tr;q=0.9,en;q=0.8', 'tr'],
    ['en', 'en'],
    ['en-US,en;q=0.9', 'en'],
    ['en-GB, tr;q=0.5', 'en'],
    ['tr;q=0.4, en;q=0.9', 'en'],
    ['de-DE,de;q=0.9,en;q=0.8', 'en'],
    ['de-DE,fr;q=0.9', 'tr'],
    ['*', 'tr'],
    ['en;q=0, tr;q=0.1', 'tr'],
    ['en;q=abc', 'en'],
    ['en;q=1.2.3', 'tr'],
    ['EN-us', 'en'],
    [';;;,,,q=', 'tr'],
    ['x'.repeat(300) + ',en', 'tr'],
  ] as const)('%j gets %s', (header, language) => {
    expect(pickInviteLanguage(header)).toBe(language);
  });
});

describe('the card image', () => {
  const png = Buffer.from(INVITE_CARD_PNG_BASE64, 'base64');

  it('is a PNG of the size the tags say, small enough for every messaging app', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(INVITE_CARD_WIDTH);
    expect(png.readUInt32BE(20)).toBe(INVITE_CARD_HEIGHT);
    // WhatsApp and others skip images over a few hundred kilobytes.
    expect(png.length).toBeLessThan(150_000);
    expect(png.subarray(-12, -8).toString('hex')).toBe('00000000');
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });
});
