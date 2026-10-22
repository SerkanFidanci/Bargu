import { inviteIntentFilters } from '../../app.config';

const HOST = 'api.46-62-162-70.sslip.io';
const TOKEN = 'Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3_9-xYz0Ab3';

interface Datum {
  scheme?: string;
  host?: string;
  path?: string;
  pathPrefix?: string;
}

/**
 * Android's rule for one intent filter (IntentFilter.match): the scheme and host must be listed,
 * and the path must equal a `path` or start with a `pathPrefix`; the data elements of a filter
 * are merged. Only the URI's path is looked at: the query and the fragment never count.
 */
function filterOpens(data: Datum[], link: string): boolean {
  const url = new URL(link);
  const schemes = new Set(
    data.flatMap((datum) => (datum.scheme === undefined ? [] : [datum.scheme])),
  );
  const hosts = new Set(data.flatMap((datum) => (datum.host === undefined ? [] : [datum.host])));
  if (!schemes.has(url.protocol.slice(0, -1)) || !hosts.has(url.hostname)) return false;
  return data.some(
    (datum) =>
      datum.path === url.pathname ||
      (datum.pathPrefix !== undefined && url.pathname.startsWith(datum.pathPrefix)),
  );
}

function dataOf(host: string): Datum[] {
  const [filter, ...others] = inviteIntentFilters(host);
  expect(others).toEqual([]);
  expect(filter?.action).toBe('VIEW');
  expect(filter?.autoVerify).toBe(true);
  expect(filter?.category).toEqual(['BROWSABLE', 'DEFAULT']);
  return Array.isArray(filter?.data) ? filter.data : [];
}

describe('the Android intent filter of the invite links (docs/ADR/0009 Ek 2)', () => {
  it('opens the shared form (/i#token, /g#token) and the earlier path form (/i/token, /g/token)', () => {
    const data = dataOf(HOST);
    for (const link of [
      `https://${HOST}/i#${TOKEN}`,
      `https://${HOST}/g#${TOKEN}`,
      `https://${HOST}/i`,
      `https://${HOST}/g`,
      `https://${HOST}/i/${TOKEN}`,
      `https://${HOST}/g/${TOKEN}`,
    ]) {
      expect(filterOpens(data, link)).toBe(true);
    }
  });

  it('opens nothing else of the host, no other host and no http', () => {
    const data = dataOf(HOST);
    for (const link of [
      `https://${HOST}/`,
      `https://${HOST}/hesap`,
      `https://${HOST}/gizlilik`,
      `https://${HOST}/invite/card.png`,
      `https://${HOST}/ii`,
      `https://${HOST}/gg#${TOKEN}`,
      `https://${HOST}/I#${TOKEN}`,
      `https://${HOST}/.well-known/assetlinks.json`,
      `https://${HOST}/v1/me`,
      `https://${HOST}/apk/x.apk`,
      `https://evil.example/i#${TOKEN}`,
      `https://${HOST}.evil.example/i#${TOKEN}`,
      `https://www.${HOST}/i#${TOKEN}`,
      `http://${HOST}/i#${TOKEN}`,
    ]) {
      expect(filterOpens(data, link)).toBe(false);
    }
  });

  it('is built from the host in the config: one verified filter, every entry on https and that host', () => {
    const data = dataOf('invite.example.com');
    expect(data.length).toBeGreaterThan(0);
    for (const datum of data) {
      expect(datum.scheme).toBe('https');
      expect(datum.host).toBe('invite.example.com');
    }
    // The paths: the two exact ones and the two prefixes of the earlier form, nothing broader.
    expect(data.map((datum) => datum.path ?? `${datum.pathPrefix ?? ''}*`).sort()).toEqual([
      '/g',
      '/g/*',
      '/i',
      '/i/*',
    ]);
  });

  it('is nothing for a build without an invite host, and refuses a host that is no host', () => {
    expect(inviteIntentFilters(undefined)).toEqual([]);
    expect(inviteIntentFilters('')).toEqual([]);
    for (const bad of [
      'https://invite.example.com',
      'invite.example.com/i',
      'invite.example.com:443',
      'me@invite.example.com',
      'Invite.Example.com',
      'invite.example.com.',
      'localhost',
      '*.example.com',
    ]) {
      expect(() => inviteIntentFilters(bad)).toThrow('EXPO_PUBLIC_INVITE_HOST');
    }
  });
});
