#!/usr/bin/env bash
# scripts/ci-linux.sh with ONE retry, and only for a load-type failure (the PM, 2026-10-22).
#   scripts/ci-linux-retry.sh <commit> <log file>
#
# Load-type: only mobile Jest files failed, every failing file ran 30 s or longer, and nothing else
# (format, check:chars, typecheck, lint, build, another package) failed. Such runs time out when the
# machine is busy and pass alone. A real failure is never retried. When it retries it prints
# "RETRY: <files>", and "FLAKY (failed twice under load): <files>" when the same file fails again,
# so a truly unstable test is not hidden: write it into docs/DURUM.md.
# CI_LINUX overrides the command (the tests use it).
set -u
commit="$1"
log="$2"
repo="$(git rev-parse --show-toplevel)"
ci_linux="${CI_LINUX:-$repo/scripts/ci-linux.sh}"

if bash "$ci_linux" "$commit" > "$log" 2>&1; then
  echo "ci-linux: $commit passed (first run)"
  exit 0
fi

failing_files() { grep -E 'FAIL ' "$1" | sed -E 's/.*FAIL +//' | sort -u; }

fails="$(failing_files "$log")"
# Not the summary "ci-linux: typecheck, lint, test or build failed", which every failure prints:
# a build, typecheck or lint task that failed names itself (@bargu/x#build: ERROR ...).
other="$(grep -E 'error TS|✖ [0-9]+ problem|Code style issues|ERR_PNPM|@bargu/(api|crypto|schemas)#test: +ERROR|#(build|typecheck|lint): +ERROR|check:chars failed|check:migrations failed|format failed' "$log" | head -3)"
load=yes
if [ -z "$fails" ] || [ -n "$other" ]; then load=no; fi
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in
    src/*) ;;
    *) load=no ;;
  esac
  secs="$(printf '%s\n' "$line" | sed -nE 's/.*\(([0-9]+)(\.[0-9]+)? s\).*/\1/p')"
  if [ -z "$secs" ] || [ "$secs" -lt 30 ]; then load=no; fi
done <<< "$fails"

if [ "$load" != yes ]; then
  echo "ci-linux: $commit FAILED (not load-type, no retry)"
  grep -E 'FAIL |error TS|✖|ERROR' "$log" | head -12
  exit 1
fi

echo "RETRY: load-type failure in: $(printf '%s\n' "$fails" | sed -E 's/ \(.*//' | tr '\n' ' ')"
cp "$log" "$log.first"
if bash "$ci_linux" "$commit" > "$log" 2>&1; then
  echo "ci-linux: $commit passed (second run, after a load-type failure)"
  exit 0
fi
echo "ci-linux: $commit FAILED twice"
first="$(printf '%s\n' "$fails" | sed -E 's/ \(.*//' | sort -u)"
again="$(failing_files "$log" | sed -E 's/ \(.*//' | sort -u)"
both="$(comm -12 <(printf '%s\n' "$first") <(printf '%s\n' "$again"))"
if [ -n "$both" ]; then echo "FLAKY (failed twice under load): $(printf '%s ' $both)"; fi
grep -E 'FAIL |error TS|✖|ERROR' "$log" | head -12
exit 1
