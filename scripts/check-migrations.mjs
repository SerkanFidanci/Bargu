// Migrations only add (docs/ADR/0034 §5b). While the closed test runs on the staging server, every
// push to main migrates the testers' database before the new release starts, so the running
// release must keep working on the migrated schema. A migration after BASELINE that drops,
// renames, narrows or deletes data says why it may, on a line of its own:
//   -- contract: <the expand migration it completes>; <the app version that no longer needs it>
// Otherwise this fails. Bodies of functions ($$ … $$) are code that runs later, not a change to the
// schema now, and are not looked into.
//   node scripts/check-migrations.mjs [migrations dir]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Migrations up to this number ran before the rule (0039, 2026-10-22). */
const BASELINE = 39;

const RISKY = [
  [/\bdrop\s+(table|column|type|function|view|schema|policy)\b/i, 'drops something'],
  [/\brename\b/i, 'renames something'],
  [/\balter\s+column\b[^;]*?\b(type|set\s+not\s+null)\b/i, 'narrows a column'],
  [/\b(delete\s+from|truncate)\b/i, 'deletes data'],
];

/** The SQL that runs now: no comments, no function bodies, no string contents. */
function statementsOf(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** What a migration does that the running release may not survive; empty when it only adds. */
function risksOf(sql) {
  if (/^\s*--\s*contract:\s*\S/m.test(sql)) return [];
  const now = statementsOf(sql);
  return RISKY.filter(([pattern]) => pattern.test(now)).map(([, what]) => what);
}

function main() {
  const folder =
    process.argv[2] ?? fileURLToPath(new URL('../apps/api/migrations', import.meta.url));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the migrations folder of this repo, or one given by a test
  const files = readdirSync(folder).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  const problems = [];
  for (const name of files) {
    if (Number(name.slice(0, 4)) <= BASELINE) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a migration file found just above
    const risks = risksOf(readFileSync(join(folder, name), 'utf8'));
    for (const risk of risks) problems.push(`${name}: ${risk}`);
  }
  if (problems.length > 0) {
    process.stderr.write(
      `check-migrations: a migration may only add while testers use the server (docs/ADR/0034 §5b):\n` +
        problems.map((problem) => `  ${problem}\n`).join('') +
        `  Split it (expand now, contract in a later release) or say why on a line\n` +
        `  "-- contract: <expand migration>; <app version that no longer needs it>".\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `check-migrations: ${String(files.length)} migrations, every new one only adds\n`,
  );
}

main();
