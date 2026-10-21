// `pnpm --filter @bargu/api notice-key:dev` (after `pnpm --filter @bargu/api build`): gives the
// local API a development notice key in apps/api/.env and prints only its public line, for
// EXPO_PUBLIC_NOTICE_KEYS in eas.json's development profile and apps/mobile/.env (QA-28 B-1).
// Writes nothing unless git ignores that .env; never prints or logs the key itself.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { withDevNoticeKey } from './dev-notice-key.js';

function fail(message: string): never {
  process.stderr.write(`notice-key:dev: ${message}\n`);
  process.exit(1);
}

function ignoredByGit(): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '.env'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync('.env'))
  fail('no .env here: run it in apps/api, after copying .env.example to .env');
if (!ignoredByGit())
  fail('git does not ignore this .env, so the key could be committed: nothing written');

let result: ReturnType<typeof withDevNoticeKey>;
try {
  result = withDevNoticeKey(readFileSync('.env', 'utf8'));
} catch (error) {
  fail(error instanceof Error ? error.message : 'unreadable .env');
}
if (result.added) writeFileSync('.env', result.text, { mode: 0o600 });
process.stdout.write(`${result.publicLine}\n`);
