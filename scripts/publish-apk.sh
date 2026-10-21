#!/usr/bin/env bash
# Puts a locally built APK (scripts/build-android-local.sh) on the staging server and prints its
# download link: https://<staging>/apk/bargu-<commit>-<random>.apk (nginx: infra/staging/nginx).
# The random part keeps links unguessable (the folder is not listed). Keeps the newest five.
# Warns when staging does not run this APK's server code yet (CI red, or the deploy still running).
#
#   scripts/publish-apk.sh ~/bargu-builds/bargu-<commit>.apk
set -euo pipefail

apk="${1:?usage: scripts/publish-apk.sh <file.apk>}"
host="${BARGU_SSH_HOST:-bargu-server}"
domain="${BARGU_API_DOMAIN:-api.46-62-162-70.sslip.io}"
dir=/srv/bargu-apk/public

[ -f "$apk" ] || { echo "publish-apk: no such file: $apk" >&2; exit 1; }
# Only APKs go on the public staging link. A store bundle (scripts/build-android-local.sh FORMAT=aab)
# is also a zip but belongs to the owner and Google Play, never to a web link.
case "$apk" in *.apk) ;; *) echo "publish-apk: not an .apk file (store bundles are never published here)" >&2; exit 1 ;; esac
case "$(head -c 2 "$apk")" in PK) ;; *) echo "publish-apk: not an APK (zip)" >&2; exit 1 ;; esac
if unzip -l "$apk" 2>/dev/null | grep -q 'BundleConfig.pb'; then
  echo "publish-apk: this is an app bundle renamed to .apk, not publishing it" >&2
  exit 1
fi

name="$(basename "$apk" .apk)-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n').apk"
scp -q "$apk" "$host:/tmp/$name"
# shellcheck disable=SC2029 # $dir and $name are expanded here on purpose (no user input).
ssh "$host" "install -m 0644 -o root -g root '/tmp/$name' '$dir/$name' && rm -f '/tmp/$name' \
  && ls -1t '$dir'/*.apk | tail -n +6 | xargs -r rm -f"

# Is the server this APK talks to as new as the APK? The staging image carries its commit
# (.github/workflows/deploy-staging.yml). Only server code matters: an older staging is fine when
# nothing under apps/api, packages or infra changed since.
repo="$(git rev-parse --show-toplevel)"
container="${BARGU_API_CONTAINER:-bargu-staging-api-1}"
apk_commit="$(basename "$apk" .apk | sed -n 's/^bargu-\([0-9a-f]\{7,40\}\)$/\1/p')"
# shellcheck disable=SC2029 # $container is expanded here on purpose (no user input).
staging="$(ssh "$host" "docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' '$container'" 2>/dev/null || true)"
warn() { echo "publish-apk: WARNING: $*" >&2; }
if [ -z "$apk_commit" ]; then
  warn "cannot tell the APK's commit from its name, staging not checked"
elif [ -z "$staging" ] || [ "$staging" = "<no value>" ]; then
  warn "staging's commit is unknown (image without a revision label), it may be older than this APK"
elif ! git -C "$repo" cat-file -e "$staging^{commit}" 2>/dev/null; then
  warn "staging runs $staging, which this clone does not have (git fetch), not checked"
elif git -C "$repo" merge-base --is-ancestor "$apk_commit" "$staging"; then
  :
elif git -C "$repo" diff --quiet "$staging" "$apk_commit" -- apps/api packages infra; then
  :
else
  warn "staging runs ${staging:0:7}, without this APK's server changes ($apk_commit): CI may be red or the deploy still running"
fi
echo "https://$domain/apk/$name"
