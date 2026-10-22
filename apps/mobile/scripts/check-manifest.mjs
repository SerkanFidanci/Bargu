// Checks the permissions of a built (merged) Android manifest against the app config.
//
//   node scripts/check-manifest.mjs <merged AndroidManifest.xml>
//
// Every permission in `android.blockedPermissions` (app.config.ts) must be gone from the manifest
// the build produced, and the permissions that are left are listed, so a reviewer (and the Play
// Console declaration) sees the real list. scripts/build-android-local.sh runs it on the merged
// release manifest of a check bundle. Exit 1: a blocked permission is still there.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function say(line) {
  process.stdout.write(`${line}\n`);
}

/** The `uses-permission` names of a manifest, comments left out (they hold disabled lines). */
export function permissionsOf(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  return [...live.matchAll(/<uses-permission\b([^>]*)>/g)]
    .filter((match) => !/tools:node="remove"/.test(match[1]))
    .map((match) => /android:name="([^"]+)"/.exec(match[1])?.[1])
    .filter((name) => name !== undefined)
    .sort();
}

/** `android.blockedPermissions` as Expo resolves the app config. */
function blockedPermissions() {
  const expo = createRequire(import.meta.url).resolve('expo/bin/cli');
  const run = spawnSync(process.execPath, [expo, 'config', '--type', 'public', '--json'], {
    cwd: appDir,
    env: { ...process.env, EXPO_NO_TELEMETRY: '1', CI: '1' },
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`expo config failed: ${run.stderr}`);
  const config = JSON.parse(run.stdout);
  return config.android?.blockedPermissions ?? [];
}

function main(args) {
  const file = args[0];
  if (file === undefined) throw new Error('usage: check-manifest.mjs <merged AndroidManifest.xml>');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the manifest it is pointed at is this script's job
  const permissions = permissionsOf(readFileSync(file, 'utf8'));
  const blocked = blockedPermissions();
  const stillThere = blocked.filter((name) => permissions.includes(name));
  say(`check-manifest: ${String(permissions.length)} permissions in the manifest:`);
  for (const name of permissions) say(`  ${name}`);
  say(
    `check-manifest: ${String(blocked.length)} blocked in the app config, ` +
      `${String(stillThere.length)} still in the manifest: ${stillThere.length === 0 ? 'ok' : 'FAILED'}`,
  );
  for (const name of stillThere) say(`  still there: ${name}`);
  return stillThere.length === 0;
}

try {
  process.exitCode = main(process.argv.slice(2)) ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `check-manifest: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
