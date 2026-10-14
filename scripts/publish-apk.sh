#!/usr/bin/env bash
# Puts a locally built APK (scripts/build-android-local.sh) on the staging server and prints its
# download link: https://<staging>/apk/bargu-<commit>-<random>.apk (nginx: infra/staging/nginx).
# The random part keeps links unguessable (the folder is not listed). Keeps the newest five.
#
#   scripts/publish-apk.sh ~/bargu-builds/bargu-<commit>.apk
set -euo pipefail

apk="${1:?usage: scripts/publish-apk.sh <file.apk>}"
host="${BARGU_SSH_HOST:-bargu-server}"
domain="${BARGU_API_DOMAIN:-api.46-62-162-70.sslip.io}"
dir=/srv/bargu-apk/public

[ -f "$apk" ] || { echo "publish-apk: no such file: $apk" >&2; exit 1; }
case "$(head -c 2 "$apk")" in PK) ;; *) echo "publish-apk: not an APK (zip)" >&2; exit 1 ;; esac

name="$(basename "$apk" .apk)-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n').apk"
scp -q "$apk" "$host:/tmp/$name"
# shellcheck disable=SC2029 # $dir and $name are expanded here on purpose (no user input).
ssh "$host" "install -m 0644 -o root -g root '/tmp/$name' '$dir/$name' && rm -f '/tmp/$name' \
  && ls -1t '$dir'/*.apk | tail -n +6 | xargs -r rm -f"
echo "https://$domain/apk/$name"
