#!/usr/bin/env bash
# Builds the Android preview APK on this machine, in Docker, when EAS's free builds have run out
# (docs/DURUM.md "Yerel Android derlemesi"). Same result as an EAS preview build: eas-cli's local
# build fetches the signing key from EAS with the developer's own Expo login (~/.expo/state.json,
# copied into the throwaway container, never anywhere else), so the APK installs over EAS builds.
#
#   scripts/build-android-local.sh [commit]        (default: HEAD; uncommitted changes are left out)
#
# Needs Docker and, for push notifications, the Firebase file at apps/mobile/google-services.json
# (git-ignored; on EAS it is a secret file variable that local builds cannot read).
# Output: ~/bargu-builds/bargu-<commit>.apk. scripts/publish-apk.sh puts it on the staging server.
set -euo pipefail
export MSYS_NO_PATHCONV=1

# React Native's community build image (JDK 17, Android SDK, NDK, CMake), pinned by digest.
IMAGE='reactnativecommunity/react-native-android:v21.1@sha256:d4b8ea0773d62096261cf0ed356004fe2c8292f5e5cdb260d11da953c8c84374'
EAS_CLI='eas-cli@24.12.1'
PNPM='pnpm@12.11.2'

repo="$(git rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --short=7 "${1:-HEAD}")"
out="$HOME/bargu-builds"
mkdir -p "$out"

host_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

firebase=()
if [ -f "$repo/apps/mobile/google-services.json" ]; then
  firebase=(-v "$(host_path "$repo/apps/mobile/google-services.json"):/secrets/google-services.json:ro" -e GOOGLE_SERVICES_JSON=/secrets/google-services.json)
else
  echo "build-android-local: no apps/mobile/google-services.json, push notifications will be off" >&2
fi

docker run --rm \
  -v "$(host_path "$repo"):/src:ro" \
  -v "$(host_path "$HOME/.expo"):/host-expo:ro" \
  -v "$(host_path "$out"):/out" \
  -v bargu-gradle-cache:/root/.gradle \
  -v bargu-pnpm-store:/root/.local/share/pnpm/store \
  "${firebase[@]}" \
  -e COMMIT="$commit" -e EAS_CLI="$EAS_CLI" -e PNPM="$PNPM" \
  -e EXPO_NO_TELEMETRY=1 -e CI=1 \
  -e GRADLE_USER_HOME=/root/.gradle -e npm_config_store_dir=/root/.local/share/pnpm/store \
  "$IMAGE" bash -euo pipefail -c '
    mkdir -p /root/.expo && cp /host-expo/state.json /root/.expo/state.json
    git config --global --add safe.directory "*"
    git clone -q /src /work && cd /work && git checkout -q "$COMMIT"
    npm install -g --silent "$PNPM"
    pnpm install --frozen-lockfile
    cd apps/mobile
    npx --yes "$EAS_CLI" build --local --platform android --profile preview --non-interactive \
      --output "/out/bargu-$COMMIT.apk"
  '
echo "build-android-local: $out/bargu-$commit.apk"
