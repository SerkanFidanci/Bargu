import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One's own history never leaves the phone (docs/ADR/0030 §6): the modules that hold it import
 * nothing that reaches a network, a notification or a log, so nothing of it can be sent by
 * mistake. Read as text, so a later import cannot slip in unseen.
 */
const HOLDERS = ['own-model.ts', 'own-trail.ts', 'own-files.ts'] as const;

/** What would let a trail leave: the API, the live connection, pushes, logs, analytics, sharing. */
const FORBIDDEN = [
  /auth\/api-client/,
  /auth\/auth-store/,
  /live\/live-session/,
  /\/notifications\//,
  /expo-notifications/,
  /expo-sharing/,
  /fetch\(/,
  /XMLHttpRequest/,
  /console\./,
  /logger/i,
  /sentry/i,
  /analytics/i,
];

function importsOf(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
}

describe('one own history stays on the phone (docs/ADR/0030 §6)', () => {
  it.each(HOLDERS)('%s imports nothing that reaches the network, a push or a log', (name) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files
    const source = readFileSync(join(__dirname, name), 'utf8');
    for (const pattern of FORBIDDEN) {
      expect(source).not.toMatch(pattern);
    }
    for (const path of importsOf(source)) {
      // Only its own parts, the shared schemas and the storage, the trail model and plain modules.
      expect(path).toMatch(
        /^(\.\/|\.\.\/trail-model|\.\.\/\.\.\/storage\/vault|\.\.\/\.\.\/location\/(sharing|send)|@bargu\/(schemas|crypto)|expo-secure-store|react-native-mmkv|zod)/,
      );
    }
  });
});
