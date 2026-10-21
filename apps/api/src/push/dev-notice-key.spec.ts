import { fromBase64url, generateToken, noticePublicKey, parseNoticeKeys } from '@bargu/crypto';
import { describe, expect, it } from 'vitest';

import { parseEnv } from '../config/env.js';
import { DEV_NOTICE_KID, withDevNoticeKey } from './dev-notice-key.js';

const key = (fill: string) => fill.repeat(43);
const local = [
  'NODE_ENV=development',
  'APP_ENV=development',
  'DATABASE_URL=postgres://u:p@127.0.0.1:5432/bargu',
  'REDIS_URL=redis://default:p@127.0.0.1:6379',
  `JWT_SIGNING_KEY=${key('a')}`,
  `OTP_KEY=${key('b')}`,
  `EMAIL_LOOKUP_KEY=${key('c')}`,
  `JOB_PAYLOAD_KEY=${key('d')}`,
  'SMTP_URL=smtp://127.0.0.1:1025',
  'MAIL_FROM=Bargu <no-reply@bargu.localhost>',
  'WEBAUTHN_RP_ID=localhost',
  'WEBAUTHN_ORIGINS=http://localhost:8081',
  '',
].join('\n');

/** The variables of a .env text, as the API reads them. */
const variables = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

describe('the development notice key (QA-28 B-1)', () => {
  it('is added to a local .env without one, and only its public half is printed', () => {
    const seed = generateToken();
    const { text, publicLine, added } = withDevNoticeKey(local, () => seed);
    expect(added).toBe(true);
    expect(text.startsWith(local)).toBe(true);
    const env = parseEnv(variables(text));
    expect(env.NOTICE_SIGNING_KID).toBe(DEV_NOTICE_KID);
    expect(env.NOTICE_SIGNING_KEY).toEqual(fromBase64url(seed));
    expect(publicLine).toBe(`dev-n1:${noticePublicKey(fromBase64url(seed))}`);
    expect(publicLine).not.toContain(seed);
    // What a development build makes of the line: exactly that key.
    expect([...parseNoticeKeys(publicLine).keys()]).toEqual(['dev-n1']);
  });

  it('keeps a key that is there, and says the same public line again', () => {
    const first = withDevNoticeKey(local);
    const again = withDevNoticeKey(first.text, () => {
      throw new Error('no new key wanted');
    });
    expect(again).toEqual({ text: first.text, publicLine: first.publicLine, added: false });
  });

  it('replaces a lone kid line, and copes with no final newline and Windows line ends', () => {
    const { text } = withDevNoticeKey('APP_ENV=development\nNOTICE_SIGNING_KID=old', generateToken);
    expect(text.match(/^NOTICE_SIGNING_KID=/gm)).toHaveLength(1);
    expect(text).toMatch(/^APP_ENV=development\nNOTICE_SIGNING_KEY=[A-Za-z0-9_-]{43}\n/);
    const windows = withDevNoticeKey('APP_ENV=development\r\n');
    expect(withDevNoticeKey(windows.text).added).toBe(false);
  });

  it('refuses a staging or production .env, and a key under another kid, without naming it', () => {
    const seed = generateToken();
    for (const text of [
      `${local}APP_ENV=staging\n`,
      'APP_ENV=production\n',
      `APP_ENV=development\nNOTICE_SIGNING_KEY=${seed}\nNOTICE_SIGNING_KID=stg-n1\n`,
      `APP_ENV=development\nNOTICE_SIGNING_KEY=${seed}\n`,
    ]) {
      let message = '';
      try {
        withDevNoticeKey(text);
      } catch (error) {
        message = error instanceof Error ? error.message : 'thrown';
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(seed);
    }
  });
});
