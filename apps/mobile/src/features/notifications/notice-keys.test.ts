import { readFileSync } from 'node:fs';

import { parseNoticeKeys, toBase64url } from '@bargu/crypto';
import { z } from 'zod';

import { sharedNoticeKeys } from './notice-keys';

/** The build profiles as eas.json gives them (the tests run in apps/mobile). */
const eas = z
  .object({
    build: z.record(
      z.string(),
      z.looseObject({ env: z.record(z.string(), z.string()).optional() }),
    ),
  })
  .parse(JSON.parse(readFileSync('eas.json', 'utf8')));
const raw = (profile: string) => eas.build[profile]?.env?.EXPO_PUBLIC_NOTICE_KEYS;
const kidsOf = (profile: string) => [...parseNoticeKeys(raw(profile)).keys()];

/**
 * QA-28 B-1, the PM's rule: each build trusts the server notice key of its own server only, so a
 * development key can never make a notice a preview or production phone takes, nor the reverse.
 */
describe('the server notice keys each build profile trusts', () => {
  it('development: only the local API’s development key', () => {
    expect(kidsOf('development')).toEqual(['dev-n1']);
  });

  it('preview: only staging’s key, and none at all while it is still the placeholder', () => {
    const value = raw('preview') ?? '';
    expect(value.startsWith('stg-n1:')).toBe(true);
    expect(kidsOf('preview')).toEqual(value.includes('PLACEHOLDER') ? [] : ['stg-n1']);
  });

  it('production: none (production gets its own key in Faz 10)', () => {
    expect(raw('production')).toBe('');
    expect(kidsOf('production')).toEqual([]);
  });

  it('never shares a key between profiles', () => {
    const keys = ['development', 'preview', 'production'].flatMap((profile) => [
      ...parseNoticeKeys(raw(profile)).values(),
    ]);
    expect(new Set(keys.map((key) => toBase64url(key))).size).toBe(keys.length);
  });

  it('hands the iOS extension the same keys, kid → base64url', () => {
    const key = parseNoticeKeys(raw('development'));
    expect(sharedNoticeKeys(key)).toEqual({ 'dev-n1': raw('development')?.split(':')[1] });
    expect(sharedNoticeKeys(new Map())).toEqual({});
  });
});
