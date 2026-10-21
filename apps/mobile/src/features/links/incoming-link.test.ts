import { redirectSystemPath } from '../../app/+native-intent';
import { HOME, incomingPath, MAX_LINK_LENGTH } from './incoming-link';

/** A token of the server's form: 32 random bytes, base64url without padding (43 characters). */
const TOKEN = 'Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3';

describe('links from outside the app (Faz 10 scan note 1)', () => {
  it("open Bargu's own invite and guardian links", () => {
    expect(incomingPath(`bargu://i/${TOKEN}`)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(`bargu://g/${TOKEN}`)).toBe(`/g/${TOKEN}`);
    expect(incomingPath(`BARGU://i/${TOKEN}/`)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(`/i/${TOKEN}`)).toBe(`/i/${TOKEN}`);
    expect(incomingPath('bargu://')).toBe(HOME);
  });

  it('send a malformed or heavily percent-encoded link to the map, quickly', () => {
    // The kind that could make decode-uri-component 0.2.2 work for very long.
    const heavy = `bargu://i/${'%C2%B5%E0%A4%A'.repeat(15)}`;
    const broken = 'bargu://i/%E0%A4%A';
    const started = Date.now();
    expect(incomingPath(heavy)).toBe(HOME);
    expect(incomingPath(broken)).toBe(HOME);
    expect(incomingPath(`bargu://i/${TOKEN}?next=%ff%fe`)).toBe(HOME);
    expect(incomingPath(`bargu://i/${TOKEN}#%`)).toBe(HOME);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('send anything too long, another scheme or an unknown screen to the map', () => {
    expect(incomingPath(`bargu://i/${'A'.repeat(MAX_LINK_LENGTH)}`)).toBe(HOME);
    expect(incomingPath(`https://evil.example/i/${TOKEN}`)).toBe(HOME);
    expect(incomingPath(`javascript://i/${TOKEN}`)).toBe(HOME);
    expect(incomingPath('bargu://security')).toBe(HOME);
    expect(incomingPath('bargu://_dev/billing')).toBe(HOME);
    expect(incomingPath(`bargu://i/${TOKEN}/accept`)).toBe(HOME);
    expect(incomingPath('bargu://i/short')).toBe(HOME);
    expect(incomingPath(`bargu://i/..\\${TOKEN}`)).toBe(HOME);
    expect(incomingPath(`bargu://i/ ${TOKEN}`)).toBe(HOME);
  });

  it('never throws to the router, whatever comes', () => {
    for (const path of ['', '%', '\u0000', 'bargu://i/%%%%', 'x'.repeat(100_000)]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(HOME);
    }
  });
});

/** The invite host of a preview build (eas.json): where invite links open as Android App Links. */
const HOST = 'api.46-62-162-70.sslip.io';
const link = (path: string) => `https://${HOST}${path}`;
const chars = (...codes: number[]) => String.fromCodePoint(...codes);

describe("https links of the invite page's own host (Android App Links, docs/ADR/0009 Ek)", () => {
  it('open the same screens as bargu://', () => {
    expect(incomingPath(link(`/i/${TOKEN}`), HOST)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(link(`/g/${TOKEN}`), HOST)).toBe(`/g/${TOKEN}`);
    // Scheme and host are case-insensitive in a URL; the path and the token are not touched.
    expect(incomingPath(`HTTPS://${HOST.toUpperCase()}/i/${TOKEN}`, HOST)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(link(`/I/${TOKEN}`), HOST)).toBe(HOME);
    // The same host's other addresses open nothing.
    for (const path of [
      '',
      '/',
      '/hesap',
      '/gizlilik',
      '/invite/card.png',
      '/apk/x.apk',
      '/v1/me',
    ]) {
      expect(incomingPath(link(path), HOST)).toBe(HOME);
    }
    expect(incomingPath(link('/.well-known/assetlinks.json'), HOST)).toBe(HOME);
  });

  it('send any other host to the map: other sites, lookalikes, user info, ports', () => {
    const lookalikes = [
      `https://evil.example/i/${TOKEN}`,
      `https://example.com/i/${TOKEN}`,
      // The real host as a prefix, a suffix, a subdomain, a parent, with a dot or a dash changed.
      `https://${HOST}.evil.example/i/${TOKEN}`,
      `https://evil.example.${HOST}/i/${TOKEN}`,
      `https://x${HOST}/i/${TOKEN}`,
      `https://${HOST}x/i/${TOKEN}`,
      `https://www.${HOST}/i/${TOKEN}`,
      `https://sslip.io/i/${TOKEN}`,
      `https://${HOST}./i/${TOKEN}`,
      `https://.${HOST}/i/${TOKEN}`,
      `https://${HOST.replace('.io', '-io')}/i/${TOKEN}`,
      // The real host inside someone else's address.
      `https://evil.example/${HOST}/i/${TOKEN}`,
      `https://evil.example/@${HOST}/i/${TOKEN}`,
      // User info: either side of the @ may fool a reader, so neither opens.
      `https://${HOST}@evil.example/i/${TOKEN}`,
      `https://evil.example@${HOST}/i/${TOKEN}`,
      `https://user:pass@${HOST}/i/${TOKEN}`,
      `https://:@${HOST}/i/${TOKEN}`,
      `https://${HOST}:evil@${HOST}/i/${TOKEN}`,
      // Ports, even the default one.
      `https://${HOST}:443/i/${TOKEN}`,
      `https://${HOST}:8443/i/${TOKEN}`,
      `https://${HOST}:/i/${TOKEN}`,
      // IP addresses and no host at all.
      `https://127.0.0.1/i/${TOKEN}`,
      `https://[::1]/i/${TOKEN}`,
      `https://localhost/i/${TOKEN}`,
      `https:///i/${TOKEN}`,
      `https:/${HOST}/i/${TOKEN}`,
      `https:${HOST}/i/${TOKEN}`,
      `//${HOST}/i/${TOKEN}`,
    ];
    for (const lookalike of lookalikes) expect(incomingPath(lookalike, HOST)).toBe(HOME);
  });

  it('send other schemes to the map: http, ftp, intent, custom', () => {
    for (const scheme of [
      'http',
      'ftp',
      'file',
      'intent',
      'wss',
      'javascript',
      'data',
      'bargu-x',
    ]) {
      expect(incomingPath(`${scheme}://${HOST}/i/${TOKEN}`, HOST)).toBe(HOME);
    }
    // A scheme that only looks like https.
    for (const scheme of ['https+x', 'xhttps', 'https.', 'httpss', 'ttps']) {
      expect(incomingPath(`${scheme}://${HOST}/i/${TOKEN}`, HOST)).toBe(HOME);
    }
  });

  it('send any path that is not exactly /i/<token> or /g/<token> to the map', () => {
    const paths = [
      `/i/${TOKEN}/`, // not even a trailing slash (the page itself is a 404 there)
      `/i/${TOKEN}//`,
      `/i/${TOKEN}/accept`,
      `/i/${TOKEN}/..`,
      `//i/${TOKEN}`,
      `/i//${TOKEN}`,
      `/./i/${TOKEN}`,
      `/i/./${TOKEN}`,
      `/../i/${TOKEN}`,
      `/i/../g/${TOKEN}`,
      `/x/../i/${TOKEN}`,
      `/g/i/${TOKEN}`,
      `/i/${TOKEN.slice(1)}`,
      `/i/${TOKEN}A`,
      `/i/${TOKEN.slice(0, 42)}=`,
      `/i/${TOKEN.slice(0, 42)}.`,
      `/i/${TOKEN.slice(0, 42)}:`,
      `/i/${TOKEN.slice(0, 42)}@`,
      `/i/${TOKEN.slice(0, 42)}\0`,
      `/security/${TOKEN}`,
      '/_dev/billing',
      '/i',
      '/i/',
      `i/${TOKEN}`,
    ];
    for (const path of paths) expect(incomingPath(link(path), HOST)).toBe(HOME);
  });

  it('send queries, fragments, encodings, backslashes and whitespace to the map', () => {
    const links = [
      link(`/i/${TOKEN}?utm_source=x`),
      link(`/i/${TOKEN}?`),
      link(`/i/${TOKEN}#top`),
      link(`/i/${TOKEN}#`),
      link(`/i/%41${TOKEN.slice(1)}`),
      link(`/%69/${TOKEN}`),
      link(`/i%2F${TOKEN}`),
      `https://${HOST}%2Fi/${TOKEN}`,
      `https://${HOST}%00/i/${TOKEN}`,
      `https://%61pi.46-62-162-70.sslip.io/i/${TOKEN}`,
      link(`/i/${TOKEN}%0a`),
      `https://${HOST}\\i\\${TOKEN}`,
      link(`/i\\${TOKEN}`),
      `https://${HOST}\\@evil.example/i/${TOKEN}`,
      ` ${link(`/i/${TOKEN}`)}`,
      `${link(`/i/${TOKEN}`)} `,
      `${link(`/i/${TOKEN}`)}\n`,
      link(`/i/ ${TOKEN}`),
      `https://${HOST} /i/${TOKEN}`,
      `https://${HOST}\t/i/${TOKEN}`,
      `https://${HOST}${chars(0xa0)}/i/${TOKEN}`,
    ];
    for (const hostile of links) expect(incomingPath(hostile, HOST)).toBe(HOME);
    // Heavy percent-encoding stays quick here too (what the router's decoder must never see).
    const heavy = link(`/i/${'%C2%B5%E0%A4%A'.repeat(15)}`);
    const started = Date.now();
    expect(incomingPath(heavy, HOST)).toBe(HOME);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('send look-alike characters (other alphabets, wide dots and slashes, case folding) to the map', () => {
    // Cyrillic a, fullwidth full stop and solidus, ideographic full stop, a non-breaking hyphen
    // and a zero-width space in the host; the Kelvin sign (lower-cases to ASCII k) and the Turkish
    // dotted I (lower-cases to i and a dot) where a host has a k or an i.
    const variants = [
      HOST.replace('.', chars(0xff0e)),
      HOST.replace('a', chars(0x0430)),
      HOST.replace('.', chars(0x3002)),
      HOST.replace('-', chars(0x2011)),
      `${HOST.slice(0, 3)}${chars(0x200b)}${HOST.slice(3)}`,
    ];
    for (const host of variants)
      expect(incomingPath(`https://${host}/i/${TOKEN}`, HOST)).toBe(HOME);
    expect(incomingPath(`https://${HOST}${chars(0xff0f)}i${chars(0xff0f)}${TOKEN}`, HOST)).toBe(
      HOME,
    );
    // Folding the case of the whole link would turn the Kelvin sign into k: only A-Z is folded.
    const kHost = 'kfoo.example.com';
    expect(incomingPath(`https://${chars(0x212a)}foo.example.com/i/${TOKEN}`, kHost)).toBe(HOME);
    expect(incomingPath(`https://KFOO.example.com/i/${TOKEN}`, kHost)).toBe(`/i/${TOKEN}`);
    expect(incomingPath(`https://${chars(0x0130)}.example.com/i/${TOKEN}`, 'i.example.com')).toBe(
      HOME,
    );
    // Tokens with look-alike characters are no tokens.
    expect(incomingPath(link(`/i/${TOKEN.slice(1)}${chars(0x0430)}`), HOST)).toBe(HOME);
    expect(incomingPath(link(`/i/${TOKEN.slice(1)}${chars(0xff21)}`), HOST)).toBe(HOME);
  });

  it('send everything to the map when this build has no invite host (production for now)', () => {
    expect(incomingPath(link(`/i/${TOKEN}`), undefined)).toBe(HOME);
    expect(incomingPath(link(`/g/${TOKEN}`), undefined)).toBe(HOME);
    // bargu:// still works without one.
    expect(incomingPath(`bargu://i/${TOKEN}`, undefined)).toBe(`/i/${TOKEN}`);
  });

  it('treat a too long link as nothing, whatever the host', () => {
    expect(incomingPath(link(`/i/${TOKEN}`).padEnd(MAX_LINK_LENGTH + 1, 'a'), HOST)).toBe(HOME);
    expect(incomingPath(`https://${'a'.repeat(MAX_LINK_LENGTH)}.${HOST}/i/${TOKEN}`, HOST)).toBe(
      HOME,
    );
  });
});
