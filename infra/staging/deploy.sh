#!/bin/sh
# Staging deploy entry point. Runs as the `deploy` user through an SSH forced command:
#   restrict,command="/usr/local/bin/bargu-deploy" ssh-ed25519 AAAA... github-actions
# so the CI key can do exactly one thing: roll the API to an image digest. Installed root-owned
# (0755) at /usr/local/bin/bargu-deploy so the deploy user cannot modify it.
#
# Input:  SSH_ORIGINAL_COMMAND = "deploy ghcr.io/<owner>/bargu-api@sha256:<digest>"
#         stdin                = short-lived registry token (GITHUB_TOKEN of the workflow run)
set -eu
umask 077

STACK_DIR=/opt/bargu/staging
REF_PATTERN='^ghcr\.io/[a-z0-9][a-z0-9-]{0,38}/bargu-api@sha256:[a-f0-9]{64}$'

command_line="${SSH_ORIGINAL_COMMAND:-}"
case "$command_line" in
  "deploy "*) image_ref="${command_line#deploy }" ;;
  *)
    echo "usage: deploy ghcr.io/<owner>/bargu-api@sha256:<digest>" >&2
    exit 64
    ;;
esac
if ! printf '%s' "$image_ref" | grep -Eq "$REF_PATTERN"; then
  echo "deploy: rejected image reference" >&2
  exit 65
fi

cd "$STACK_DIR"

# Registry credentials live in a throwaway config dir and disappear with this process.
DOCKER_CONFIG="$(mktemp -d)"
export DOCKER_CONFIG
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
docker login ghcr.io --username deploy --password-stdin >/dev/null

previous_ref=""
if [ -f image.env ]; then
  previous_ref="$(sed -n 's/^API_IMAGE=//p' image.env)"
fi

compose() {
  docker compose --env-file .env --env-file image.env "$@"
}

# Runs compose against the image being deployed, without recording it yet: `env` scopes the
# override to this one command (a plain assignment before a shell function may persist).
compose_new() {
  env API_IMAGE="$image_ref" docker compose --env-file .env --env-file image.env "$@"
}

# The new image is pulled and migrated before it is recorded, so a failed pull or migration leaves
# image.env and the running release untouched.
if ! compose_new pull --quiet api; then
  echo "deploy: could not pull ${image_ref}" >&2
  exit 1
fi

# A backup before every migration (docs/ADR/0034 §5b): without one nothing is migrated. On a new
# server, start postgres once by hand first (`docker compose ... up -d postgres`).
if ! /usr/local/bin/bargu-backup pre-deploy; then
  echo "deploy: no backup before the migration; the running release is untouched" >&2
  exit 1
fi

# Schema first. Migrations only add (expand/contract, checked in CI by scripts/check-migrations.mjs),
# so the running release keeps working on the migrated schema.
if ! compose_new run --rm migrate; then
  echo "deploy: migration failed; the running release is untouched" >&2
  exit 1
fi

printf 'API_IMAGE=%s\n' "$image_ref" > image.env
if compose up -d --wait --wait-timeout 120; then
  echo "deploy: staging is running ${image_ref}"
  docker image prune --force --filter "until=168h" >/dev/null
  exit 0
fi

echo "deploy: new release failed its health check" >&2
compose logs --tail 50 api worker >&2 || true
if [ -n "$previous_ref" ]; then
  echo "deploy: rolling back to ${previous_ref}" >&2
  printf 'API_IMAGE=%s\n' "$previous_ref" > image.env
  compose up -d --wait --wait-timeout 120 || true
fi
exit 1
