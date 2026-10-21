#!/usr/bin/env bash
# Tests for scripts/with-test-lock.sh. Run:  pnpm test:lock   or   bash scripts/with-test-lock.test.sh
#
# Every test uses its own lock folder (BARGU_TEST_LOCK_DIR) under a scratch folder, so it never
# touches the machine-wide lock a real test run may be holding. Takes about 30 seconds.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lock_script="$here/with-test-lock.sh"
work="$(mktemp -d)"
export BARGU_TEST_LOCK_POLL=0.1
passed=0
failed=0

cleanup() {
  local pid
  for pid in $(jobs -p); do kill "$pid" 2>/dev/null; done
  rm -rf "$work"
}
trap cleanup EXIT

ok() {
  passed=$((passed + 1))
  printf '  ok    %s\n' "$1"
}
bad() {
  failed=$((failed + 1))
  printf '  FAIL  %s\n' "$1"
}
check() { # check <description> <command...>: ok when the command succeeds
  local description="$1"
  shift
  if "$@"; then ok "$description"; else bad "$description"; fi
}
contains() { grep -q -- "$2" "$1" 2>/dev/null; }
lacks() { ! grep -q -- "$2" "$1" 2>/dev/null; }

# wait_for <seconds> <command...>: polls until the command succeeds.
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while ! "$@"; do
    [ "$SECONDS" -ge "$deadline" ] && return 1
    sleep 0.1
  done
}

new_case() { # new_case <name>: fresh scratch folder and lock path for one test
  case_dir="$work/$1"
  mkdir -p "$case_dir"
  export BARGU_TEST_LOCK_DIR="$case_dir/lock"
  unset BARGU_TEST_LOCK_HELD
}

# A pid that is certainly gone.
dead_pid() {
  local pid
  : &
  pid=$!
  wait "$pid"
  printf '%s' "$pid"
}

# plant_lock <pid> <started-epoch>: a lock directory as a holder would have left it.
plant_lock() {
  mkdir -p "$BARGU_TEST_LOCK_DIR"
  printf '%s\n' "$2" >"$BARGU_TEST_LOCK_DIR/started"
  printf '%s\n' '2026-01-01 00:00:00' >"$BARGU_TEST_LOCK_DIR/since"
  printf '%s\n' 'planted' >"$BARGU_TEST_LOCK_DIR/command"
  printf '%s\n' "$1" >"$BARGU_TEST_LOCK_DIR/pid"
}

lock_gone() { [ ! -e "$BARGU_TEST_LOCK_DIR" ]; }
lock_present() { [ -d "$BARGU_TEST_LOCK_DIR" ]; }

printf 'with-test-lock.sh\n'

# --- basics ---------------------------------------------------------------------------------------
new_case basics
bash "$lock_script" sh -c 'echo ran' >"$case_dir/out" 2>"$case_dir/err"
status=$?
check 'runs the command and returns its success' test "$status" -eq 0
check 'passes the command output through' contains "$case_dir/out" 'ran'
check 'releases the lock after success' lock_gone
check 'prints nothing when there is no wait' test ! -s "$case_dir/err"

bash "$lock_script" -- sh -c 'echo dashes' >"$case_dir/out" 2>&1
check '-- before the command is accepted' contains "$case_dir/out" 'dashes'

bash "$lock_script" >/dev/null 2>&1
check 'no command is a usage error (2)' test "$?" -eq 2

# --- parallel runs: the second waits, then runs --------------------------------------------------------
new_case parallel
log="$case_dir/log"
: >"$log"
bash "$lock_script" sh -c "echo A-start >>'$log'; sleep 3; echo A-end >>'$log'" >/dev/null 2>&1 &
first=$!
wait_for 15 contains "$log" 'A-start' || bad 'first run did not start'
BARGU_TEST_LOCK_MESSAGE_EVERY=2 bash "$lock_script" sh -c "echo B-start >>'$log'" >"$case_dir/b.out" 2>"$case_dir/b.err" &
second=$!
sleep 1
check 'the second run waits while the first holds the lock' lacks "$log" 'B-start'
check 'the lock directory exists while the first runs' lock_present
check 'the lock holds the holder pid' test -s "$BARGU_TEST_LOCK_DIR/pid"
check 'the lock holds the start time' test -s "$BARGU_TEST_LOCK_DIR/started"
wait "$first"
first_status=$?
wait "$second"
second_status=$?
check 'both runs succeed' test "$first_status$second_status" = '00'
check 'the second run starts only after the first ended' test "$(tr '\n' ' ' <"$log")" = 'A-start A-end B-start '
check 'waiting prints the "bekliyor" line with pid and time' grep -Eq 'bekliyor: başka bir test koşusu çalışıyor \(pid [0-9]+, [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8}\)' "$case_dir/b.err"
messages="$(grep -c 'bekliyor' "$case_dir/b.err")"
check 'the wait message is not repeated faster than the interval' test "$messages" -ge 1 -a "$messages" -le 2
check 'says when the lock is finally taken' contains "$case_dir/b.err" 'kilit alındı'
check 'the lock is gone after both' lock_gone

# --- stale locks ---------------------------------------------------------------------------------
new_case stale-pid
plant_lock "$(dead_pid)" "$(date +%s)"
bash "$lock_script" sh -c 'echo took-over' >"$case_dir/out" 2>"$case_dir/err"
check 'a lock whose pid is gone is taken over' contains "$case_dir/out" 'took-over'
check 'the takeover is announced' contains "$case_dir/err" 'kilit devralındı'
check 'the lock is released after the takeover' lock_gone

new_case stale-age
sleep 60 &
holder=$!
plant_lock "$holder" "$(($(date +%s) - 7300))"
bash "$lock_script" sh -c 'echo took-over-old' >"$case_dir/out" 2>"$case_dir/err"
check 'a lock older than 2 hours is taken over even if its pid lives' contains "$case_dir/out" 'took-over-old'
check 'the takeover is announced (age)' contains "$case_dir/err" 'kilit devralındı'
kill "$holder" 2>/dev/null

new_case stale-nopid
mkdir -p "$BARGU_TEST_LOCK_DIR" # a holder that died between mkdir and writing its pid
BARGU_TEST_LOCK_NOPID_GRACE=1 bash "$lock_script" sh -c 'echo took-over-empty' >"$case_dir/out" 2>"$case_dir/err"
check 'a lock that never got a pid is taken over after the grace time' contains "$case_dir/out" 'took-over-empty'

new_case fresh-live
sleep 60 &
holder=$!
plant_lock "$holder" "$(date +%s)"
bash "$lock_script" sh -c "echo C-ran >>'$case_dir/log'" >/dev/null 2>"$case_dir/err" &
waiter=$!
sleep 1.5
check 'a fresh lock of a live pid is not taken over' lacks "$case_dir/log" 'C-ran'
check 'and the waiter says who it waits for' contains "$case_dir/err" "pid $holder,"
kill "$holder" 2>/dev/null # the holder dies: its lock is now stale
wait "$waiter"
check 'the waiter runs once the holder is gone' contains "$case_dir/log" 'C-ran'
check 'and releases the lock' lock_gone

new_case two-takers
plant_lock "$(dead_pid)" "$(date +%s)"
log="$case_dir/log"
: >"$log"
takers=()
for name in one two three; do
  bash "$lock_script" sh -c "echo $name-start >>'$log'; sleep 0.5; echo $name-end >>'$log'" >/dev/null 2>&1 &
  takers+=($!)
done
wait "${takers[@]}"
check 'three waiters on one stale lock all run, never overlapping' \
  test "$(sed 's/-.*//' "$log" | uniq | wc -l | tr -d ' ')" = 3
check 'each start is followed by its own end' test "$(grep -c -- '-start' "$log")" = 3
check 'the lock is gone at the end' lock_gone

# --- release on failure and on signals --------------------------------------------------------------
new_case failure
bash "$lock_script" sh -c 'exit 7' >/dev/null 2>&1
check 'the command exit code is returned (7)' test "$?" -eq 7
check 'the lock is released after a failing command' lock_gone

bash "$lock_script" definitely-not-a-command-xyz >/dev/null 2>&1
check 'an unknown command gives 127' test "$?" -eq 127
check 'the lock is released after an unknown command' lock_gone

new_case term-running
bash "$lock_script" sh -c "echo \$\$ >'$case_dir/child'; exec sleep 60" >/dev/null 2>&1 &
runner=$!
wait_for 15 test -s "$case_dir/child" || bad 'the command did not start'
check 'the lock is held while the command runs' lock_present
child="$(cat "$case_dir/child" 2>/dev/null)"
kill -TERM "$runner" "$child" 2>/dev/null # what a group-wide signal does: both get it
wait "$runner"
check 'SIGTERM ends the run with 143' test "$?" -eq 143
check 'the lock is released after SIGTERM' lock_gone

new_case hup-running
bash "$lock_script" sh -c "echo \$\$ >'$case_dir/child'; exec sleep 60" >/dev/null 2>&1 &
runner=$!
wait_for 15 test -s "$case_dir/child" || bad 'the command did not start'
child="$(cat "$case_dir/child" 2>/dev/null)"
kill -HUP "$runner" "$child" 2>/dev/null
wait "$runner"
check 'SIGHUP ends the run with 129' test "$?" -eq 129
check 'the lock is released after SIGHUP' lock_gone

# Ctrl-C: the terminal sends SIGINT to the whole process group. Simulated by the command signalling
# itself and its parent. Skipped when this shell was started with SIGINT ignored (a background job).
new_case int-running
if ! bash -c 'trap "echo handled" INT; kill -INT $$; sleep 0.3' | grep -q handled; then
  printf '  skip  SIGINT test: this environment starts shells with SIGINT ignored\n'
else
  bash "$lock_script" sh -c 'kill -INT $PPID; kill -INT $$; sleep 5' >/dev/null 2>&1
  check 'Ctrl-C ends the run with 130' test "$?" -eq 130
  check 'the lock is released after Ctrl-C' lock_gone
fi

new_case term-waiting
sleep 60 &
holder=$!
plant_lock "$holder" "$(date +%s)"
bash "$lock_script" sh -c 'echo never' >"$case_dir/out" 2>"$case_dir/err" &
waiter=$!
wait_for 15 contains "$case_dir/err" 'bekliyor' || bad 'the waiter did not report waiting'
kill -TERM "$waiter" 2>/dev/null
wait "$waiter"
check 'a waiting run ends with 143 on SIGTERM' test "$?" -eq 143
check 'a waiting run never runs its command' lacks "$case_dir/out" 'never'
check 'a waiting run leaves the other holder lock alone' lock_present
check 'and the holder pid in it is untouched' test "$(cat "$BARGU_TEST_LOCK_DIR/pid")" = "$holder"
kill "$holder" 2>/dev/null

# --- nesting and the default path ---------------------------------------------------------------------
new_case nested
timeout 20 bash "$lock_script" bash "$lock_script" sh -c 'echo inner' >"$case_dir/out" 2>"$case_dir/err"
check 'the lock asked for again inside the lock does not deadlock' contains "$case_dir/out" 'inner'
check 'and is released at the end' lock_gone

unset BARGU_TEST_LOCK_DIR
default_path="$(bash "$lock_script" --print-lock-path)"
case "$default_path" in
  */bargu-test.lock) ok "the default lock path ends in bargu-test.lock ($default_path)" ;;
  *) bad "the default lock path is $default_path" ;;
esac
if command -v cygpath >/dev/null 2>&1; then
  # Git Bash from a terminal has TMPDIR (unix form) and TEMP (Windows form); a bash started from
  # PowerShell has TEMP only. Both must land in the same folder.
  from_terminal="$(TMPDIR="$(cygpath -u "$TEMP")" bash "$lock_script" --print-lock-path)"
  from_powershell="$(env -u TMPDIR bash "$lock_script" --print-lock-path)"
  check 'TMPDIR and TEMP resolve the same lock folder on Windows' test "$from_terminal" = "$from_powershell"
fi

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
