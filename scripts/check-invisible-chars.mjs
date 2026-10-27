#!/usr/bin/env node
// Fails when a source file contains invisible or bidi-control characters ("Trojan Source",
// CVE-2021-42574): they can make code read differently from how it runs, and a literal one in a
// test silently changes what the test checks. Write them as escapes instead.
//
// Usage: node scripts/check-invisible-chars.mjs [files...]   (no files: every tracked file)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Control characters other than tab, line feed and carriage return (a backspace hid two letters of
// a path in docs/DURUM.md, 2026-10-23; NUL bytes stood for "\0" in docs/PROTOCOL.md, 2026-10-27);
// soft hyphen; zero-width space/joiners, LRM, RLM; line/paragraph separators, bidi embeddings and
// overrides; word joiner, invisible operators, bidi isolates; byte order mark.
const INVISIBLE =
  // eslint-disable-next-line security/detect-unsafe-regex, no-control-regex -- one character class (linear); the control characters are what it looks for
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u{AD}\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/gu;
const BINARY = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?|riv|pmtiles|pbf|apk|aab|jar|keystore)$/i;
// Written by people and editors: a NUL in one is a mistake, not a sign of binary content.
const TEXT = /\.(md|ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|sh|sql|txt|conf|service|timer)$/i;

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

let found = 0;
for (const file of files) {
  if (BINARY.test(file)) continue;
  let text;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading the files it is given (tracked or staged paths) is this script's job
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted or unreadable: nothing to check
  }
  if (text.includes('\0') && !TEXT.test(file)) continue; // binary content
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(INVISIBLE)) {
      const code = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      process.stderr.write(`${file}:${index + 1}:${match.index + 1}  U+${code}\n`);
      found += 1;
    }
  });
}
if (found > 0) {
  process.stderr.write(
    `\n${found} invisible or bidi-control character(s): write them as escapes.\n`,
  );
  process.exit(1);
}
