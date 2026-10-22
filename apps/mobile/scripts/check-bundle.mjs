// Looks for developer tools in a built JavaScript bundle (apps/mobile/README.md "Mağaza sürümü").
//
// A production app must not carry the developer rows, the fake people on the map, the measurement
// overlay with its stall meter, the crypto benchmark, the component gallery or the test billing:
// index.ts loads them behind `process.env.EXPO_PUBLIC_DEV_TOOLS`, a constant when a release bundle
// is built, so Metro drops them. This script proves it on a real bundle:
//
//   pnpm check:bundle               exports twice (production, then with the flags) and checks both
//   pnpm check:bundle production    `expo export` WITHOUT the developer flags: every marker must be absent
//   pnpm check:bundle flags         `expo export` WITH the flags (a preview build): every marker must be present
//   node scripts/check-bundle.mjs --file <bundle> [absent|present]    a bundle that already exists
//                                   (scripts/build-android-local.sh pulls it out of a built bundle)
//
// The "flags" run is what makes an "absent" meaningful: it shows the markers really are in a bundle
// that has the tools, in the encoding this script looks for. Run it through the test lock
// (`pnpm check:bundle` does): `expo export` takes about a minute.
//
// The markers: the texts of the developer tools (src/i18n/locales/dev.*.json, so a new text is
// covered without touching this file) and a few strings from their code. A text that also stands in
// the shipped catalogue (or is too short to be unique) is not a marker: it would be found in a
// production bundle for a good reason.
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const locales = join(appDir, 'src', 'i18n', 'locales');

/** Strings from the developer tools' code that no other module has. */
const CODE_MARKERS = [
  // features/dev/measure/store.ts: where the background live counters are kept
  'measure:bglive:v1',
  // features/dev/crypto-benchmark.ts: fixed ids of its fake circle and devices
  '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  '0190f7a4-0000-7000-8000-00000000a11c',
  '0190f7a4-0000-7000-8000-000000000b0b',
];

/** A text shorter than this could be anywhere. */
const MIN_MARKER_LENGTH = 12;

function say(line) {
  process.stdout.write(`${line}\n`);
}

/** The bytes of a file this script was pointed at (its own folders, or its command line). */
function read(path) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- looking into the files it is given is this script's job
  return readFileSync(path);
}

/** Every string leaf of a parsed JSON document. */
function leaves(value) {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(leaves);
}

/** The longest part of a text that is not a `{{placeholder}}`. */
function longestFixedPart(text) {
  return text
    .split(/\{\{[^}]*\}\}/)
    .map((part) => part.trim())
    .reduce((longest, part) => (part.length > longest.length ? part : longest), '');
}

/** The developer texts that identify the tools, and the number left out. */
export function textMarkers() {
  const shipped = ['en.json', 'tr.json'].map((name) => read(join(locales, name)).toString('utf8'));
  const markers = new Set();
  let skipped = 0;
  for (const name of ['dev.en.json', 'dev.tr.json']) {
    const catalogue = JSON.parse(read(join(locales, name)).toString('utf8'));
    for (const text of leaves(catalogue)) {
      const part = longestFixedPart(text);
      const alsoShipped = shipped.some((file) => file.includes(part));
      if (part.length < MIN_MARKER_LENGTH || alsoShipped) skipped += 1;
      else markers.add(part);
    }
  }
  return { markers: [...markers], skipped };
}

/** The ways a string can stand in a bundle: plain bytes (JS), Hermes' one-byte or UTF-16 strings. */
function encodings(marker) {
  const forms = [Buffer.from(marker, 'utf8'), Buffer.from(marker, 'utf16le')];
  if ([...marker].every((char) => char.charCodeAt(0) < 128)) {
    forms.push(Buffer.from(marker, 'latin1'));
  }
  return forms;
}

/** Which markers the bundle holds. */
export function findMarkers(bundle, markers) {
  return markers.filter((marker) => encodings(marker).some((form) => bundle.includes(form)));
}

/** `expo export` for Android into a new folder; returns the folder. */
function exportBundle(flagsOn) {
  const out = mkdtempSync(join(tmpdir(), 'bargu-bundle-'));
  const expo = createRequire(import.meta.url).resolve('expo/bin/cli');
  // Empty, not deleted: Expo loads .env files, and a developer's own file must not change the result.
  const env = {
    ...process.env,
    EXPO_NO_TELEMETRY: '1',
    CI: '1',
    EXPO_PUBLIC_DEV_TOOLS: flagsOn ? '1' : '',
    EXPO_PUBLIC_BG_LIVE: flagsOn ? '1' : '',
  };
  const run = spawnSync(
    process.execPath,
    [expo, 'export', '--platform', 'android', '--clear', '--output-dir', out],
    { cwd: appDir, env, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (run.status !== 0) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`expo export failed (${String(run.status)})`);
  }
  return out;
}

/** The one JavaScript bundle `expo export` wrote. */
function bundleIn(folder) {
  const dir = join(folder, '_expo', 'static', 'js', 'android');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the folder this script just had `expo export` fill
  const files = readdirSync(dir).filter((name) => /\.(hbc|js)$/.test(name));
  if (files.length !== 1) {
    throw new Error(`expected one bundle in ${dir}, found ${String(files.length)}`);
  }
  return join(dir, files[0]);
}

/** Prints the verdict; true when it is what was expected. */
function report(label, bundle, markers, expectPresent) {
  const found = findMarkers(bundle, markers);
  const wrong = expectPresent ? markers.filter((marker) => !found.includes(marker)) : found;
  say(
    `${label}: ${String(markers.length)} markers, ${String(found.length)} in the bundle ` +
      `(wanted ${expectPresent ? 'all' : 'none'}): ${wrong.length === 0 ? 'ok' : 'FAILED'}`,
  );
  for (const marker of wrong)
    say(`  ${expectPresent ? 'missing' : 'found'}: ${JSON.stringify(marker)}`);
  return wrong.length === 0;
}

function main(args) {
  const { markers: texts, skipped } = textMarkers();
  const markers = [...CODE_MARKERS, ...texts];
  say(
    `check-bundle: ${String(markers.length)} markers (${String(texts.length)} developer texts, ` +
      `${String(skipped)} texts left out as not unique)`,
  );

  if (args[0] === '--file') {
    const file = args[1];
    if (file === undefined) {
      throw new Error('usage: check-bundle.mjs --file <bundle> [absent|present]');
    }
    if (args[2] !== undefined && args[2] !== 'absent' && args[2] !== 'present') {
      throw new Error(`unknown expectation "${args[2]}": absent or present`);
    }
    return report(file, read(file), markers, args[2] === 'present');
  }

  const modes = args[0] === undefined || args[0] === 'all' ? ['production', 'flags'] : [args[0]];
  let ok = true;
  for (const mode of modes) {
    if (mode !== 'production' && mode !== 'flags') {
      throw new Error(`unknown mode "${mode}": production, flags or all`);
    }
    const folder = exportBundle(mode === 'flags');
    try {
      ok = report(mode, read(bundleIn(folder)), markers, mode === 'flags') && ok;
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2)) ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `check-bundle: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
