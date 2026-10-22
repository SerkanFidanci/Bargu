#!/usr/bin/env bash
# Builds Android artifacts on this machine, in Docker, when EAS's free builds have run out
# (docs/DURUM.md "Yerel Android derlemesi"). eas-cli's local build fetches the signing key from EAS
# with the developer's own Expo login (~/.expo/state.json, copied into the throwaway container,
# never anywhere else).
#
#   scripts/build-android-local.sh [commit]                     (default: HEAD; uncommitted changes are left out)
#   ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 scripts/build-android-local.sh [commit]
#   FORMAT=aab scripts/build-android-local.sh [commit]          (store-profile bundle, for CHECKING)
#   FORMAT=aab SIGN=eas scripts/build-android-local.sh [commit] (store bundle, signed with the upload key)
#
# FORMAT=apk (default): the preview APK, same result as an EAS preview build (it installs over EAS
# builds). Only today's phones (arm64-v8a) by default (the owner, 2026-10-21): the native code is
# compiled once instead of four times and the APK is smaller, so building and uploading are quicker.
# Old 32-bit phones and emulators need the ABIS above.
#
# FORMAT=aab: the production profile as an Android App Bundle (what Google Play takes). Two kinds:
#   - SIGN=check (default): built with Gradle straight from the prebuilt project and signed with the
#     project's DEBUG key, so Google Play refuses it on purpose. It answers "does the bundle build,
#     what target SDK does it carry, is a developer tool left in it" (scripts below) and needs no
#     credentials. It has no API address either (that lives in the EAS "production" environment), so
#     it is not meant to be run. Output: bargu-<commit>-check.aab. ABIS defaults to arm64-v8a.
#   - SIGN=eas: `eas build --local --profile production`: the upload key and the production
#     environment come from EAS, and the versionCode from EAS's one counter (appVersionSource
#     remote, autoIncrement), so cloud and local store builds can never repeat a code. This needs the
#     upload key to exist on EAS (docs/play-store/KONTROL-LISTESI.md K2, the owner's) and refuses to
#     bless the bundle unless the counter went up. ABIS defaults to all four ABIs, as in the cloud.
#     Output: bargu-<commit>.aab. Never put it on staging: scripts/publish-apk.sh refuses bundles.
#
# Needs Docker and, for push notifications, the Firebase file at apps/mobile/google-services.json
# (git-ignored; on EAS it is a secret file variable that local builds cannot read).
# Output: ~/bargu-builds/. scripts/publish-apk.sh puts an APK on the staging server.
set -euo pipefail
export MSYS_NO_PATHCONV=1

# React Native's community build image (JDK 17, Android SDK, NDK, CMake), pinned by digest.
IMAGE='reactnativecommunity/react-native-android:v21.1@sha256:d4b8ea0773d62096261cf0ed356004fe2c8292f5e5cdb260d11da953c8c84374'
EAS_CLI='eas-cli@24.12.1'
PNPM='pnpm@12.11.2'

format="${FORMAT:-apk}"
sign="${SIGN:-check}"
case "$format" in apk | aab) ;; *) echo "build-android-local: FORMAT must be apk or aab, not '$format'" >&2; exit 2 ;; esac
case "$sign" in check | eas) ;; *) echo "build-android-local: SIGN must be check or eas, not '$sign'" >&2; exit 2 ;; esac
if [ "$format" = apk ] && [ -n "${SIGN:-}" ]; then
  echo "build-android-local: SIGN only applies to FORMAT=aab" >&2
  exit 2
fi
# A store bundle must not silently drop phones: all four ABIs unless the developer says otherwise.
abis_default='arm64-v8a'
if [ "$format" = aab ] && [ "$sign" = eas ]; then abis_default='armeabi-v7a,arm64-v8a,x86,x86_64'; fi

repo="$(git rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --short=7 "${1:-HEAD}")"
# The repository's own git directory, not the checkout: in a git worktree the checkout's .git is a
# file pointing at a host path the container cannot see (QA 20 T-1). Cloning it gives every commit.
gitdir="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"
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
  -v "$(host_path "$gitdir"):/src.git:ro" \
  -v "$(host_path "$HOME/.expo"):/host-expo:ro" \
  -v "$(host_path "$out"):/out" \
  -v bargu-gradle-cache:/root/.gradle \
  -v bargu-pnpm-store:/root/.local/share/pnpm/store \
  "${firebase[@]}" \
  -e COMMIT="$commit" -e EAS_CLI="$EAS_CLI" -e PNPM="$PNPM" -e ABIS="${ABIS:-$abis_default}" \
  -e FORMAT="$format" -e SIGN="$sign" \
  -e EXPO_NO_TELEMETRY=1 -e CI=1 \
  -e GRADLE_USER_HOME=/root/.gradle -e npm_config_store_dir=/root/.local/share/pnpm/store \
  "$IMAGE" bash -euo pipefail -c '
    mkdir -p /root/.expo && cp /host-expo/state.json /root/.expo/state.json
    # Which CPUs to build for: user Gradle properties outrank those of the project, and are written
    # on every run (the Gradle volume outlives the container).
    props=/root/.gradle/gradle.properties
    { grep -v "^reactNativeArchitectures=" "$props" 2>/dev/null || true; echo "reactNativeArchitectures=$ABIS"; } > /tmp/gradle.properties
    mv /tmp/gradle.properties "$props"
    echo "build-android-local: $FORMAT ($SIGN), ABIs $ABIS"
    git config --global --add safe.directory "*"
    git clone -q /src.git /work && cd /work && git checkout -q "$COMMIT"
    npm install -g --silent "$PNPM"
    pnpm install --frozen-lockfile
    cd apps/mobile

    # The newest versionCode EAS knows for the production profile (empty: none yet, or unreadable).
    # The same remote counter numbers cloud and local store builds (eas.json: appVersionSource remote).
    remote_code() {
      npx --yes "$EAS_CLI" build:version:get --platform android --profile production --json --non-interactive 2>/dev/null \
        | tr -d "\n " | grep -o "\"versionCode\":\"\{0,1\}[0-9]*" | tr -dc "0-9" || true
    }

    if [ "$FORMAT" = apk ]; then
      npx --yes "$EAS_CLI" build --local --platform android --profile preview --non-interactive \
        --output "/out/bargu-$COMMIT.apk"
    elif [ "$SIGN" = eas ]; then
      before="$(remote_code)"
      echo "build-android-local: last versionCode on EAS: ${before:-none yet}"
      npx --yes "$EAS_CLI" build --local --platform android --profile production --non-interactive \
        --output "/out/bargu-$COMMIT.aab"
      # Play takes no versionCode twice, and none below one it already has (KONTROL-LISTESI K4).
      after="$(remote_code)"
      case "$after" in "" | *[!0-9]*)
        echo "build-android-local: REFUSED: cannot read the new versionCode from EAS, not blessing /out/bargu-$COMMIT.aab" >&2
        rm -f "/out/bargu-$COMMIT.aab"; exit 1 ;;
      esac
      if [ "$after" -le "${before:-0}" ]; then
        echo "build-android-local: REFUSED: versionCode is $after, not above the last one (${before:-0}); removing the bundle" >&2
        rm -f "/out/bargu-$COMMIT.aab"; exit 1
      fi
      echo "build-android-local: versionCode ${before:-none} -> $after"
    else
      # Check bundle: the prebuilt Android project, bundleRelease, the project debug key.
      pnpm --filter "@bargu/mobile^..." run build
      npx expo prebuild --platform android --no-install --clean
      (cd android && ./gradlew bundleRelease --no-daemon)
      aab=android/app/build/outputs/bundle/release/app-release.aab
      cp "$aab" "/out/bargu-$COMMIT-check.aab"
      # What the merged manifest says (Play wants target SDK 36 or higher: KONTROL-LISTESI K3).
      manifest="$(find android/app/build/intermediates -type f -name AndroidManifest.xml -path "*merged_manifest*" -path "*elease*" | head -n 1)"
      sdk="$(tr "\n" " " < "$manifest" | grep -o "<uses-sdk[^>]*>" | head -n 1)"
      target="$(printf "%s" "$sdk" | grep -o "targetSdkVersion=\"[0-9]*\"" | tr -dc "0-9")"
      echo "build-android-local: manifest: ${sdk:-no uses-sdk}"
      if [ -z "$target" ] || [ "$target" -lt 36 ]; then
        echo "build-android-local: REFUSED: target SDK is ${target:-unknown}, Google Play needs 36 or higher" >&2
        rm -f "/out/bargu-$COMMIT-check.aab"; exit 1
      fi
      echo "build-android-local: target SDK $target: ok"
      # The permissions the app config blocks must be gone from the manifest; the rest is listed
      # (apps/mobile/scripts/check-manifest.mjs, README "Android izinleri").
      if [ -f scripts/check-manifest.mjs ]; then
        if ! node scripts/check-manifest.mjs "$manifest"; then
          echo "build-android-local: REFUSED: a blocked permission is still in the manifest" >&2
          rm -f "/out/bargu-$COMMIT-check.aab"; exit 1
        fi
      else
        echo "build-android-local: this commit has no scripts/check-manifest.mjs, permissions not checked" >&2
      fi
      # No developer tool in the shipped JavaScript (apps/mobile/scripts/check-bundle.mjs).
      if [ -f scripts/check-bundle.mjs ]; then
        unzip -p "$aab" base/assets/index.android.bundle > /tmp/index.android.bundle
        if ! node scripts/check-bundle.mjs --file /tmp/index.android.bundle absent; then
          echo "build-android-local: REFUSED: the bundle carries developer tools" >&2
          rm -f "/out/bargu-$COMMIT-check.aab"; exit 1
        fi
      else
        echo "build-android-local: this commit has no scripts/check-bundle.mjs, developer tools not checked" >&2
      fi
    fi
  '
case "$format/$sign" in
  apk/*) echo "build-android-local: $out/bargu-$commit.apk" ;;
  aab/eas) echo "build-android-local: $out/bargu-$commit.aab (signed with the EAS upload key)" ;;
  aab/check)
    echo "build-android-local: $out/bargu-$commit-check.aab"
    echo "build-android-local: this is a CHECK bundle (debug key, no API address): Google Play will not take it." >&2
    echo "build-android-local: a store upload needs the upload key (K2): FORMAT=aab SIGN=eas" >&2
    ;;
esac
