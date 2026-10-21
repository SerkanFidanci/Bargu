#!/usr/bin/env bash
# Runs a command while holding ONE machine-wide lock, so heavy test runs never overlap: several
# agents share this machine, and a Linux CI replica (scripts/ci-linux.sh), a full local mobile Jest
# run and a scratch Jest run at once made the heavy mobile screen tests take 37-80 s instead of
# 18 s and time out, which failed good commits.
#
#   scripts/with-test-lock.sh <command...>     run the command once the lock is free
#   scripts/with-test-lock.sh --print-lock-path
#
# The lock is the directory  <temp folder>/bargu-test.lock  (outside the repo, so every worktree
# shares it). `mkdir` is atomic: whoever creates the directory owns the lock; it holds the owner's
# pid, start time and command. On Windows (Git Bash) the temp folder comes from %TEMP%, which every
# launcher sets (TMPDIR only exists in Git Bash terminals), so a bash started from PowerShell and
# one started from a Git Bash window resolve the same folder. WSL's bash is a different machine view
# and is not supported: use Git Bash.
#
# A waiting run prints "bekliyor: ..." at once and then about once a minute. A lock is taken over
# (with a message) when its pid is gone or it is older than 2 hours. The lock is released when the
# command ends, fails, or the script gets Ctrl-C / SIGTERM / SIGHUP (bash runs the trap once the
# foreground command has ended: Ctrl-C reaches the whole process group, so the command ends too).
# Nested use is safe: a command started under the lock that asks for the lock again just runs.
#
# Overrides (the tests use them): BARGU_TEST_LOCK_DIR, BARGU_TEST_LOCK_POLL (seconds, default 1),
# BARGU_TEST_LOCK_MESSAGE_EVERY (60), BARGU_TEST_LOCK_STALE_AFTER (7200),
# BARGU_TEST_LOCK_NOPID_GRACE (10: how long a lock without a pid file counts as "being created").
set -u

POLL="${BARGU_TEST_LOCK_POLL:-1}"
MESSAGE_EVERY="${BARGU_TEST_LOCK_MESSAGE_EVERY:-60}"
STALE_AFTER="${BARGU_TEST_LOCK_STALE_AFTER:-7200}"
NOPID_GRACE="${BARGU_TEST_LOCK_NOPID_GRACE:-10}"

lock_base() {
  local base
  if command -v cygpath >/dev/null 2>&1; then
    base="${TEMP:-${TMP:-${TMPDIR:-}}}"
    if [ -n "$base" ]; then base="$(cygpath -u "$base")"; fi
  else
    base="${TMPDIR:-${TEMP:-${TMP:-}}}"
  fi
  printf '%s' "${base:-/tmp}"
}

base="$(lock_base)"
LOCK="${BARGU_TEST_LOCK_DIR:-${base%/}/bargu-test.lock}"
GUARD="$LOCK.takeover" # serialises the takeover of a stale lock: only one waiter removes it
OWNED=0
GUARD_OWNED=0

say() { printf '%s\n' "$*" >&2; }

# First line of a file, without a trailing CR; empty when the file is missing or unreadable.
read_first_line() {
  local line=''
  { IFS= read -r line <"$1"; } 2>/dev/null || true
  printf '%s' "${line%$'\r'}"
}

is_number() {
  case "$1" in '' | *[!0-9]*) return 1 ;; esac
  return 0
}

# kill -0 fails with EPERM for another user's process, so /proc is checked as well.
pid_alive() {
  is_number "$1" || return 1
  kill -0 "$1" 2>/dev/null && return 0
  [ -d "/proc/$1" ]
}

# $1 = holder pid ('' when the lock has none), $2 = seconds the lock has been seen without a pid.
# Prints why the lock is stale and returns 0, or returns 1 when its holder is (or may be) running.
stale_reason() {
  local pid="$1" without_pid="$2" started
  if [ -z "$pid" ]; then
    if [ "$without_pid" -ge "$NOPID_GRACE" ]; then
      printf 'kilit sahibi hiç yazılmamış'
      return 0
    fi
    return 1
  fi
  if [ "$pid" = "$$" ]; then
    printf 'pid %s bu çalışmanın kendisi, kilit eski bir çalışmadan kalmış' "$pid"
    return 0
  fi
  if ! pid_alive "$pid"; then
    printf 'pid %s artık çalışmıyor' "$pid"
    return 0
  fi
  started="$(read_first_line "$LOCK/started")"
  if is_number "$started" && [ $(($(date +%s) - started)) -ge "$STALE_AFTER" ]; then
    printf 'kilit %s saniyeden eski' "$STALE_AFTER"
    return 0
  fi
  return 1
}

write_info() {
  # The pid goes last: a lock with a pid is complete, one without is still being created.
  printf '%s\n' "$(date +%s)" >"$LOCK/started"
  printf '%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" >"$LOCK/since"
  printf '%s\n' "$*" >"$LOCK/command"
  printf '%s\n' "$$" >"$LOCK/pid"
}

release() {
  if [ "$OWNED" = 1 ]; then
    OWNED=0
    # Remove only our own lock: after a takeover (2 hours) the directory is somebody else's.
    local holder
    holder="$(read_first_line "$LOCK/pid")"
    if [ -z "$holder" ] || [ "$holder" = "$$" ]; then rm -rf "$LOCK"; fi
  fi
  if [ "$GUARD_OWNED" = 1 ]; then
    GUARD_OWNED=0
    rmdir "$GUARD" 2>/dev/null || true
  fi
}

# Removes a stale lock. Under the guard the staleness is checked again, so two waiters cannot both
# decide "stale" and the second one delete the first one's fresh lock. Returns 0 when it is gone.
take_over() {
  local without_pid="$1" pid since reason
  if ! mkdir "$GUARD" 2>/dev/null; then
    # Another waiter is on it. A guard left behind by a killed waiter is removed after a minute.
    if [ -n "$(find "$GUARD" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then rmdir "$GUARD" 2>/dev/null || true; fi
    return 1
  fi
  GUARD_OWNED=1
  pid="$(read_first_line "$LOCK/pid")"
  since="$(read_first_line "$LOCK/since")"
  if [ ! -d "$LOCK" ]; then
    release
    return 0
  fi
  if reason="$(stale_reason "$pid" "$without_pid")"; then
    rm -rf "$LOCK" 2>/dev/null
    if [ -e "$LOCK" ]; then
      # Could not remove it (a file inside is open, no permission): wait like for a live lock.
      release
      return 1
    fi
    say "kilit devralındı: $reason (pid ${pid:-?}, ${since:-?})"
    release
    return 0
  fi
  release
  return 1
}

acquire() {
  local started_waiting=$SECONDS last_message=-1 without_pid_from=-1 mkdir_failures=0
  local pid since without_pid
  mkdir -p "$(dirname "$LOCK")" 2>/dev/null
  while :; do
    if mkdir "$LOCK" 2>/dev/null; then
      OWNED=1
      write_info "$@"
      if [ "$last_message" -ge 0 ]; then say "kilit alındı ($((SECONDS - started_waiting)) sn bekledi)"; fi
      return 0
    fi
    if [ ! -d "$LOCK" ]; then
      # Not "already exists": the folder is unwritable, or something else is in the way.
      mkdir_failures=$((mkdir_failures + 1))
      if [ "$mkdir_failures" -ge 5 ]; then
        say "kilit klasörü oluşturulamıyor: $LOCK"
        exit 1
      fi
      sleep "$POLL"
      continue
    fi
    mkdir_failures=0
    pid="$(read_first_line "$LOCK/pid")"
    if [ -n "$pid" ]; then
      without_pid_from=-1
    elif [ "$without_pid_from" -lt 0 ]; then
      without_pid_from=$SECONDS
    fi
    without_pid=0
    if [ "$without_pid_from" -ge 0 ]; then without_pid=$((SECONDS - without_pid_from)); fi
    if stale_reason "$pid" "$without_pid" >/dev/null && take_over "$without_pid"; then
      continue
    fi
    if [ "$last_message" -lt 0 ] || [ $((SECONDS - last_message)) -ge "$MESSAGE_EVERY" ]; then
      since="$(read_first_line "$LOCK/since")"
      say "bekliyor: başka bir test koşusu çalışıyor (pid ${pid:-?}, ${since:-?})"
      last_message=$SECONDS
    fi
    sleep "$POLL"
  done
}

if [ "${1:-}" = '--print-lock-path' ]; then
  printf '%s\n' "$LOCK"
  exit 0
fi
if [ "${1:-}" = '--' ]; then shift; fi
if [ "$#" -eq 0 ]; then
  say 'usage: scripts/with-test-lock.sh <command...>   (or --print-lock-path)'
  exit 2
fi

# Started by a command that already holds the lock (ci-linux.sh under test:mobile:locked, say):
# waiting for it would wait for ourselves forever.
if [ -n "${BARGU_TEST_LOCK_HELD:-}" ] &&
  [ "$(read_first_line "$LOCK/pid")" = "$BARGU_TEST_LOCK_HELD" ] &&
  pid_alive "$BARGU_TEST_LOCK_HELD"; then
  exec "$@"
fi

trap release EXIT
trap 'release; exit 130' INT
trap 'release; exit 143' TERM
trap 'release; exit 129' HUP

acquire "$@"
export BARGU_TEST_LOCK_HELD="$$"
"$@"
status=$?
release
exit "$status"
