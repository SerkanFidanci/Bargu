#!/usr/bin/env node
// Fails when a copy that one file keeps of another is out of date, so it can never drift unnoticed.
//
// There is one such copy: the owner runs ONE script on the staging server (`ssh bargu-server
// 'sh -s' < infra/staging/apply-pending.sh`), which cannot fetch a second file, so
// infra/staging/apply-pending.sh carries the text of infra/staging/notice-key.sh inside it.
// Whoever changes notice-key.sh must refresh that copy; this check says when they forgot.
//
// It runs the script's own check, `sh infra/staging/apply-pending.sh --check-notice-key`. Where
// there is no `sh` (a Windows shell without Git's tools) it compares the two texts itself, the
// same way. Run by `pnpm check:chars` (CI's "Format · Typecheck · Lint · Test · Build" job and
// scripts/ci-linux.sh both run that), `pnpm check:embedded`, and by the pre-commit hook when one
// of the two files is staged.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

// The copy sits in a function of apply-pending.sh, between these two lines.
const START = "  cat <<'NOTICE_KEY_SCRIPT_END'\n";
const END = 'NOTICE_KEY_SCRIPT_END\n}\n';

function compareByHand() {
  const script = readFileSync('infra/staging/apply-pending.sh', 'utf8');
  const original = readFileSync('infra/staging/notice-key.sh', 'utf8');
  const from = script.indexOf(START);
  const to = script.indexOf(END, from);
  if (from < 0 || to < 0) {
    process.stderr.write('apply-pending.sh: the embedded notice-key.sh was not found.\n');
    return false;
  }
  const embedded = script.slice(from + START.length, to);
  if (embedded === original) {
    process.stdout.write(
      'notice-key.sh copy is current: apply-pending.sh holds the same text as notice-key.sh.\n',
    );
    return true;
  }
  process.stderr.write(
    'The notice-key.sh copy inside infra/staging/apply-pending.sh DIFFERS from infra/staging/notice-key.sh.\n',
  );
  return false;
}

function check() {
  try {
    execFileSync('sh', ['infra/staging/apply-pending.sh', '--check-notice-key'], {
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return compareByHand(); // no sh here
    }
    return false; // the script said why (its message went to the terminal)
  }
}

if (!check()) {
  process.stderr.write(
    'Refresh the copy: put the text of infra/staging/notice-key.sh between the NOTICE_KEY_SCRIPT_END lines of notice_key_script() in infra/staging/apply-pending.sh.\n',
  );
  process.exit(1);
}
