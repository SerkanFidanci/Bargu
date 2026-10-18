#!/usr/bin/env bash
# Runs CI's "Format · Typecheck · Lint · Test · Build" job on Linux, in Docker, on a clean clone of
# a commit: what passes on Windows can fail on CI's Ubuntu (letter case, native modules that jest
# resolves differently; CI was red from cfe3c3b to bcf285d that way). Use it before pushing a commit
# that changes tests (docs/DURUM.md).
#
#   scripts/ci-linux.sh [commit]        (default: HEAD; uncommitted changes are left out)
#
# Same image and pnpm store volume as scripts/build-android-local.sh. Exits non-zero when any
# step fails and prints the failing lines.
set -euo pipefail
export MSYS_NO_PATHCONV=1

IMAGE='reactnativecommunity/react-native-android:v21.1@sha256:d4b8ea0773d62096261cf0ed356004fe2c8292f5e5cdb260d11da953c8c84374'
PNPM='pnpm@12.11.2'

repo="$(git rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --short=7 "${1:-HEAD}")"
# The repository's own git directory, not the checkout: in a git worktree the checkout's .git is a
# file pointing at a host path the container cannot see (QA 20 T-1). Cloning it gives every commit.
gitdir="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"

host_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

docker run --rm \
  -v "$(host_path "$gitdir"):/src.git:ro" \
  -v bargu-pnpm-store:/root/.local/share/pnpm/store \
  -e COMMIT="$commit" -e PNPM="$PNPM" \
  -e CI=true -e HUSKY=0 -e TURBO_TELEMETRY_DISABLED=1 -e EXPO_NO_TELEMETRY=1 \
  -e npm_config_store_dir=/root/.local/share/pnpm/store \
  "$IMAGE" bash -uo pipefail -c '
    git config --global --add safe.directory "*"
    git clone -q /src.git /work && cd /work && git checkout -q "$COMMIT" || exit 1
    npm install -g --silent "$PNPM" || exit 1
    pnpm install --frozen-lockfile > /tmp/install.log 2>&1 || { tail -30 /tmp/install.log; exit 1; }
    failed=0
    pnpm format:check > /tmp/format.log 2>&1 || { tail -20 /tmp/format.log; echo "ci-linux: format failed"; failed=1; }
    pnpm check:chars > /tmp/chars.log 2>&1 || { tail -20 /tmp/chars.log; echo "ci-linux: check:chars failed"; failed=1; }
    # The tests after the rest, not beside it: jest (a worker per core) and the typed lint at once
    # ran out of memory in a 16 GB Docker (exit 137), though each passes alone.
    turbo_ok=1
    pnpm exec turbo run typecheck lint build --continue --ui=stream > /tmp/turbo.log 2>&1 || turbo_ok=0
    pnpm exec turbo run test --continue --ui=stream >> /tmp/turbo.log 2>&1 || turbo_ok=0
    if [ "$turbo_ok" = 0 ]; then
      grep -nE "ERROR|FAIL|error TS|✖|●" /tmp/turbo.log | head -80
      echo "ci-linux: typecheck, lint, test or build failed"
      failed=1
    fi
    grep -E "Tests:|Test Files|Tasks:" /tmp/turbo.log
    exit "$failed"
  '
echo "ci-linux: $commit passed"
