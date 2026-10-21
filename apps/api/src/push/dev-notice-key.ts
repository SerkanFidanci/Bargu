// The development server notice key (QA-28 B-1, docs/ADR/0016 Ek): for a local API only, kept in
// its git-ignored .env. Development builds trust its public half (EXPO_PUBLIC_NOTICE_KEYS in
// eas.json and apps/mobile/.env); preview and production builds never do.
import { fromBase64url, generateToken, noticePublicKey } from '@bargu/crypto';

/** The id development builds know the local API's notice key by. */
export const DEV_NOTICE_KID = 'dev-n1';

const KEY_LINE = /^NOTICE_SIGNING_KEY=(.*)$/m;
const KID_LINE = /^NOTICE_SIGNING_KID=(.*)$/m;
const NOTICE_LINE = /^NOTICE_SIGNING_(?:KEY|KID)=/;
const SHARED_ENV = /^APP_ENV=\s*(?:staging|production)\s*$/m;

/** The public line for a seed: what a development build trusts. */
const publicLineOf = (seed: string) =>
  `${DEV_NOTICE_KID}:${noticePublicKey(fromBase64url(seed, 32))}`;

/**
 * A local .env with a development notice key added when it has none, and the public line for the
 * development build, `dev-n1:<base64url>`. A key already there is kept as it is. Refuses (throws,
 * never naming the key) a .env for staging or production, a key that is not 32 bytes, and a key
 * under another kid, which a development build would not trust.
 */
export function withDevNoticeKey(
  envText: string,
  newSeed: () => string = generateToken,
): { text: string; publicLine: string; added: boolean } {
  if (SHARED_ENV.test(envText)) {
    throw new Error('this .env is for staging or production: the development key stays local');
  }
  const seed = KEY_LINE.exec(envText)?.[1]?.trim() ?? '';
  if (seed !== '') {
    const kid = KID_LINE.exec(envText)?.[1]?.trim();
    if (kid !== DEV_NOTICE_KID) {
      throw new Error(`NOTICE_SIGNING_KID is not ${DEV_NOTICE_KID}: fix .env by hand`);
    }
    return { text: envText, publicLine: publicLineOf(seed), added: false };
  }
  const fresh = newSeed();
  const kept = envText
    .split('\n')
    .filter((line) => !NOTICE_LINE.test(line))
    .join('\n');
  const separator = kept === '' || kept.endsWith('\n') ? '' : '\n';
  return {
    text: `${kept}${separator}NOTICE_SIGNING_KEY=${fresh}\nNOTICE_SIGNING_KID=${DEV_NOTICE_KID}\n`,
    publicLine: publicLineOf(fresh),
    added: true,
  };
}
