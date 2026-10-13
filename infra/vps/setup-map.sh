#!/bin/sh
# Installs the self-hosted map files of Bargu staging (docs/ADR/0008). Run as root on the server:
#   sh setup-map.sh [--dry-run] [YYYYMMDD]
# 1. go-pmtiles CLI, pinned release, SHA-256 checked.
# 2. Turkey extract of the Protomaps daily basemap (one PMTiles file, read by the app with range
#    requests). Daily builds are kept for 7 days, so the date defaults to today (UTC).
# 3. Label fonts and icons from protomaps/basemaps-assets at a pinned commit (OFL / BSD licences).
# Additive: writes only /srv/bargu-map (outside /opt/bargu, which holds secrets and stays closed to
# nginx). nginx serves /srv/bargu-map/public at /map/ (infra/staging/nginx/bargu-staging.conf).
# Files are swapped in atomically when complete.
set -eu

PMTILES_VERSION=1.31.2
PMTILES_SHA256=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f
ASSETS_COMMIT=028c18f713baecad011301ff7a69acc39bcc2ae7
# Turkey with a small margin for the islands and border areas (west, south, east, north).
BBOX=25.6,35.7,44.9,42.2
MAXZOOM=15
ROOT=/srv/bargu-map

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then dry_run=true; shift; fi
build="${1:-$(date -u +%Y%m%d)}"
case "$build" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) echo "usage: sh setup-map.sh [--dry-run] [YYYYMMDD]" >&2; exit 64 ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  echo "setup-map: run as root" >&2
  exit 1
fi
if [ "$(uname -m)" != x86_64 ]; then
  echo "setup-map: only the x86_64 binary is pinned" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$ROOT/bin" "$ROOT/public/tiles"

# 1. CLI
archive="go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
curl -fsSL --proto '=https' -o "$tmp/$archive" \
  "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${archive}"
echo "${PMTILES_SHA256}  $tmp/$archive" | sha256sum -c -
tar -xzf "$tmp/$archive" -C "$tmp" pmtiles
install -m 0755 "$tmp/pmtiles" "$ROOT/bin/pmtiles"

# 2. Tiles
source_url="https://build.protomaps.com/${build}.pmtiles"
if $dry_run; then
  "$ROOT/bin/pmtiles" extract "$source_url" "$tmp/turkey.pmtiles" \
    --bbox="$BBOX" --maxzoom="$MAXZOOM" --dry-run
  exit 0
fi
part="$ROOT/public/tiles/turkey.pmtiles.part"
"$ROOT/bin/pmtiles" extract "$source_url" "$part" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM" --download-threads=4
"$ROOT/bin/pmtiles" verify "$part"
mv -f "$part" "$ROOT/public/tiles/turkey.pmtiles"
printf '%s\n' "$build" > "$ROOT/public/tiles/BUILD"

# 3. Fonts and sprites (only what the styles reference).
git clone --quiet --filter=blob:none --no-checkout \
  https://github.com/protomaps/basemaps-assets.git "$tmp/assets"
git -C "$tmp/assets" sparse-checkout set --no-cone \
  "/fonts/Noto Sans Regular/" "/fonts/Noto Sans Medium/" "/fonts/Noto Sans Italic/" \
  "/fonts/OFL.txt" "/sprites/v4/"
git -C "$tmp/assets" -c advice.detachedHead=false checkout --quiet "$ASSETS_COMMIT"
for dir in fonts sprites; do
  rm -rf "$ROOT/public/$dir.new"
  cp -R "$tmp/assets/$dir" "$ROOT/public/$dir.new"
  rm -rf "$ROOT/public/$dir.old"
  if [ -d "$ROOT/public/$dir" ]; then mv "$ROOT/public/$dir" "$ROOT/public/$dir.old"; fi
  mv "$ROOT/public/$dir.new" "$ROOT/public/$dir"
  rm -rf "$ROOT/public/$dir.old"
done

# nginx (www-data) reads; nothing is writable by it.
chmod -R a+rX,go-w "$ROOT/public"
du -sh "$ROOT/public/tiles/turkey.pmtiles" "$ROOT/public/fonts" "$ROOT/public/sprites"
echo "setup-map: build $build installed under $ROOT/public"
