// Checks the permissions of a built (merged) Android manifest against the app config.
//
//   node scripts/check-manifest.mjs <merged AndroidManifest.xml>
//
// Every permission in `android.blockedPermissions` (app.config.ts) must be gone from the manifest
// the build produced, and the permissions that are left are listed, so a reviewer (and the Play
// Console declaration) sees the real list. It also checks that Android backup is off: allowBackup
// "false" and Bargu's own two rule attributes (app.config.ts). scripts/build-android-local.sh runs
// it on the merged release manifest of a check bundle. Exit 1: a blocked permission is still
// there, or backup is not off.
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

/** The attributes of the `<application>` element, comments left out; null when there is none. */
export function applicationAttributes(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<application\b([^>]*)>/.exec(live)?.[1];
  if (tag === undefined) return null;
  return Object.fromEntries(
    [...tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
}

/**
 * What is wrong with the backup settings of a manifest (apps/mobile/app.config.ts, "Android backup
 * off"): allowBackup must be false, and the two rule attributes (Android 11 and older, Android 12+
 * with its device transfer) must be there and must be Bargu's own, not the second pair that
 * expo-secure-store's `configureAndroidBackup` writes.
 */
export function backupProblems(xml) {
  const attributes = applicationAttributes(xml);
  if (attributes === null) return ['no <application> element'];
  const problems = [];
  const allow = attributes['android:allowBackup'];
  if (allow !== 'false') problems.push(`android:allowBackup is ${allow ?? 'not set'}, not false`);
  for (const name of ['android:fullBackupContent', 'android:dataExtractionRules']) {
    const rules = attributes[name];
    if (rules === undefined) problems.push(`${name} is not set`);
    else if (rules.includes('secure_store'))
      problems.push(`${name} is ${rules}, not Bargu's rules`);
  }
  return problems;
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
  const xml = readFileSync(file, 'utf8');
  const permissions = permissionsOf(xml);
  const blocked = blockedPermissions();
  const stillThere = blocked.filter((name) => permissions.includes(name));
  say(`check-manifest: ${String(permissions.length)} permissions in the manifest:`);
  for (const name of permissions) say(`  ${name}`);
  say(
    `check-manifest: ${String(blocked.length)} blocked in the app config, ` +
      `${String(stillThere.length)} still in the manifest: ${stillThere.length === 0 ? 'ok' : 'FAILED'}`,
  );
  for (const name of stillThere) say(`  still there: ${name}`);

  const attributes = applicationAttributes(xml) ?? {};
  for (const name of ['allowBackup', 'fullBackupContent', 'dataExtractionRules']) {
    say(`  android:${name}="${attributes[`android:${name}`] ?? '(not set)'}"`);
  }
  const problems = backupProblems(xml);
  say(`check-manifest: backup is off: ${problems.length === 0 ? 'ok' : 'FAILED'}`);
  for (const problem of problems) say(`  ${problem}`);
  return stillThere.length === 0 && problems.length === 0;
}

try {
  process.exitCode = main(process.argv.slice(2)) ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `check-manifest: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
