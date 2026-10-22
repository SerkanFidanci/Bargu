#!/usr/bin/env bash
# Tests for scripts/ci-linux-retry.sh with a fake ci-linux (no Docker):
#   bash scripts/ci-linux-retry.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass=0
fail=0

# A fake ci-linux that plays the outputs in $work/plan, one line per run: "ok", or a file whose
# content is printed before failing.
cat > "$work/fake.sh" <<'EOF'
#!/usr/bin/env bash
dir="$(dirname "$0")"
n=$(cat "$dir/count" 2>/dev/null || echo 0)
n=$((n + 1)); echo "$n" > "$dir/count"
step=$(sed -n "${n}p" "$dir/plan")
if [ "$step" = ok ]; then echo "ci-linux: $1 passed"; exit 0; fi
cat "$dir/$step"; exit 1
EOF

printf '%s\n' '@bargu/mobile:test: FAIL src/features/home/idle-frames.test.tsx (86.22 s)' 'ci-linux: typecheck, lint, test or build failed' > "$work/load"
printf '%s\n' '@bargu/mobile:test: FAIL src/features/home/idle-frames.test.tsx (12.10 s)' > "$work/real"
printf '%s\n' 'src/app.ts(1,1): error TS2322: nope' '@bargu/mobile:test: FAIL src/a.test.tsx (40.00 s)' > "$work/tsc"
printf '%s\n' '@bargu/mobile#build: ERROR  command exited (1)' '@bargu/mobile:test: FAIL src/a.test.tsx (40.00 s)' 'ci-linux: typecheck, lint, test or build failed' > "$work/build"

check() { # name, plan..., expected exit, expected text
  local name="$1" expect_code="$2" expect_text="$3"; shift 3
  printf '%s\n' "$@" > "$work/plan"; rm -f "$work/count"
  out="$(CI_LINUX="$work/fake.sh" bash "$here/ci-linux-retry.sh" abc1234 "$work/log" 2>&1)"; code=$?
  runs=$(cat "$work/count")
  if [ "$code" = "$expect_code" ] && printf '%s' "$out" | grep -qF -- "$expect_text"; then
    pass=$((pass + 1)); echo "ok   $name (runs: $runs)"
  else
    fail=$((fail + 1)); echo "FAIL $name: exit $code, runs $runs"; printf '%s\n' "$out"
  fi
}

check 'passes first time, no retry' 0 'passed (first run)' ok
check 'load-type failure is retried once' 0 'RETRY: load-type failure in: src/features/home/idle-frames.test.tsx' load ok
check 'a short failure is not retried' 1 'not load-type, no retry' real ok
check 'a typecheck error is never retried' 1 'not load-type, no retry' tsc ok
check 'a failed build task is never retried' 1 'not load-type, no retry' build ok
check 'the same file twice is flagged flaky' 1 'FLAKY (failed twice under load): src/features/home/idle-frames.test.tsx' load load

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
