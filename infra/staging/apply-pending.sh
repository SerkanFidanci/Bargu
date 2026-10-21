#!/bin/sh
# Applies the changes that are waiting on the Bargu staging server, in one go. The coding session
# may not change the shared server, so the owner runs this from their own terminal (as root on the
# server). First the dry run, which only lists what would happen, then the real run:
#
#   ssh bargu-server 'sh -s -- --dry-run' < infra/staging/apply-pending.sh
#   ssh bargu-server 'sh -s' < infra/staging/apply-pending.sh
#
# Options (after `sh -s --`):
#   --dry-run          only list what would happen
#   --min-level N      MIN_CLIENT_LEVEL to set, an integer from 3 to 9 (default 4, the app's
#                      CLIENT_LEVEL); later e.g. `sh -s -- --min-level 5 --dry-run`, then without
#                      --dry-run: every other step then says "zaten yapılmış"
#   --allow-lower      lowering the level (reopening old apps) is refused unless this is given
#   --check-notice-key (run from the repo, as a file) is the copy of notice-key.sh in here still
#                      the same as infra/staging/notice-key.sh?
#
# What it does (each step is announced in Turkish first, and says "zaten yapılmış" when there is
# nothing left to do; running it twice changes nothing the second time):
#   0. warns first (the very first line): the phones must have the new APK before this runs
#   1. timestamped backup of .env and compose.yml (only when one of them is about to change)
#   2. .env: MIN_CLIENT_LEVEL=N (4: slice 3c raised the app's CLIENT_LEVEL to 4)
#   3. compose.yml: the three WATCH_PUSH lines after BILLING_TEST (as in infra/staging/compose.yml)
#   4. the server's notice signing key (infra/staging/notice-key.sh, embedded below because the
#      owner runs ONE script): key in .env, its two lines in compose.yml, the public half in
#      /opt/bargu/staging/notice-public-key.txt; the private key is never printed
#   5. owner and modes: deploy:deploy, .env 0600, compose.yml 0640
#   6. world.pmtiles: the low-detail world map (Protomaps build, zoom 0-6) next to turkey.pmtiles
#   7. nginx: no long cache for 404s under /map/ (a phone that asks before world.pmtiles exists
#      must not be told to keep the 404 for a day; 200, 206 and 304 keep the long cache): two
#      small edits in the installed Bargu site file, nginx -t on the WHOLE configuration, then a
#      reload (never a restart: this nginx also serves other sites)
#   8. docker compose up -d --wait worker api (only when they do not run the new settings yet,
#      the new signing key included)
#   9. final check: MIN_CLIENT_LEVEL, WATCH_PUSH* and the key id inside the api container,
#      /health/live, the world.pmtiles size, the public key line and whether a service log shows
#      it, and the Cache-Control of a 404 under /map/
#
# Rules it keeps:
#   - It writes only under /opt/bargu/staging and /srv/bargu-map, plus one exact file, the installed
#     Bargu nginx site (/etc/nginx/sites-available/bargu-staging, written by safe_put only; its
#     backup goes to /opt/bargu/staging). Every write goes through guard(), which refuses (stops
#     with a Turkish message) any other path after resolving ".." and symlinks. Nothing of the
#     other project on the server (rastamen), and no other nginx file, is touched.
#   - It never prints secrets: .env is only edited, never shown; the container check shows nothing
#     but MIN_CLIENT_LEVEL, WATCH_PUSH* and NOTICE_SIGNING_KID (a key id, not a secret) lines; of
#     the notice key only its public half is ever shown.
#   - The notice key step runs the embedded notice-key.sh in a subshell, so ITS writes go through
#     the same guard() and safe_* writers (QA-30 L-3; notice-key.sh has no guard of its own and
#     refuses a real run without them). Before calling it the script also refuses, with a clearer
#     message, when a path it writes is a symlink, and it keeps only the child's own
#     "notice-key: ..." lines (and the guard's refusals).
#   - Every backup that holds secrets (the .env ones, ours and notice-key.sh's) is 0600 and owned
#     by deploy (QA-30 L-2).
#   - --dry-run changes nothing: no backup, no write, no download, no restart.
#   - If the new files do not pass `docker compose config`, or the services do not come up, the
#     backups are put back; so is the nginx site file if `nginx -t` fails (no reload then).
# The whole script is wrapped in main() and every command reads /dev/null, so `sh -s` (which reads
# this file from stdin) cannot have a command swallow the rest of the script.
# POSIX sh (dash on the server), but it uses GNU stat, chown --reference, date -d and timeout:
# the server is Ubuntu. Checked with shellcheck and run against a fake server in an Ubuntu 24.04
# container (a dry run, a real run, a second run, failures; see the commit message).
set -eu
umask 077

STACK_DIR=/opt/bargu/staging
MAP_ROOT=/srv/bargu-map
ENV_FILE="$STACK_DIR/.env"
COMPOSE_FILE="$STACK_DIR/compose.yml"
TILES_DIR="$MAP_ROOT/public/tiles"
WORLD_FILE="$TILES_DIR/world.pmtiles"
WORLD_PART="$WORLD_FILE.part"
PMTILES="$MAP_ROOT/bin/pmtiles"
# The Bargu site of the host's nginx, as infra/vps/setup-nginx.sh installs it (the file in
# sites-available; sites-enabled holds a link to it). The one path outside the two folders above
# that may be written, matched exactly.
NGINX_SITE=/etc/nginx/sites-available/bargu-staging
NGINX_SITE_LINK=/etc/nginx/sites-enabled/bargu-staging
# Work file and backups of the nginx edit live in the stack folder, not in /etc/nginx.
NGINX_NEW="$STACK_DIR/bargu-staging.nginx.new"
NGINX_BAK="$STACK_DIR/bargu-staging.nginx.bak"

# The key notice-key.sh makes (its public half, for the app build, is written next to .env).
NOTICE_PUBLIC="$STACK_DIR/notice-public-key.txt"

WANT_LEVEL=4 # --min-level N changes it (3 to 9)
WORLD_MAXZOOM=6
WORLD_FRESH_MINUTES=10080 # 7 days
OWNER=deploy:deploy

DRY_RUN=false
ALLOW_LOWER=false
CHECK_EMBED=false
STARTED=false
BACKUP_STAMP=""
NEED_ENV=false
NEED_COMPOSE=false
NEED_NOTICE=false
MAP_FAILED=false
NGINX_FAILED=false
NOTICE_FAILED=false
NOTICE_CHANGED=false
CHECK_FAILED=false
ALLOW_SITE=false

# ---- output -----------------------------------------------------------------------------------

say() { printf '%s\n' "$*"; }
step() { printf '\n[%s] %s\n' "$1" "$2"; }
note() { printf '    %s\n' "$*"; }
problem() {
  printf '    SORUN: %s\n' "$*"
}

# ---- path guard (start) -----------------------------------------------------------------------

die() {
  printf '\nHATA: %s\n' "$*" >&2
  exit 1
}

# Resolves "." and ".." in an absolute path without touching the disk; the result is in NORM.
normalize() {
  NORM=""
  old_ifs=$IFS
  IFS=/
  set -f
  for part in $1; do
    case "$part" in
      "" | .) ;;
      ..) NORM=${NORM%/*} ;;
      *) NORM="$NORM/$part" ;;
    esac
  done
  set +f
  IFS=$old_ifs
  if [ -z "$NORM" ]; then NORM=/; fi
}

# The only door to the disk: every path the script writes goes through here first. It stops the
# whole script unless the path (with ".." resolved, the folder it sits in with symlinks resolved,
# and the file itself not a symlink) lies inside /opt/bargu/staging or /srv/bargu-map. The one
# exception to the folders is the installed
# Bargu nginx site: that exact path (no prefix, no pattern, nothing else under /etc/nginx), and
# only while ALLOW_SITE is set, which safe_put does for the length of one call. The checked path
# is left in GUARDED.
guard() {
  if $DRY_RUN; then
    die "İç hata: kuru çalıştırmada yazma isteği geldi, durduruldu: $1"
  fi
  case "$1" in
    /*) ;;
    *) die "Güvenlik: yol / ile başlamıyor, hiçbir şey yazılmadı: $1" ;;
  esac
  normalize "$1"
  # The target ITSELF must not be a symlink (a dangling one counts): a write or a chown/chmod
  # through it lands wherever it points, outside the two folders. The folder it sits in is checked
  # below. Every writer reaches the disk through here, so this covers them all.
  if [ -L "$NORM" ]; then die "Güvenlik: $NORM bir kısayol (symlink), hiçbir şey yazılmadı."; fi
  if [ "$NORM" = "$NGINX_SITE" ] && $ALLOW_SITE; then
    GUARDED=$NORM
    return 0
  fi
  case "$NORM" in
    "$STACK_DIR"/?* | "$MAP_ROOT"/?*) ;;
    *) die "Güvenlik: $NORM yolu $STACK_DIR ve $MAP_ROOT dışında, hiçbir şey yazılmadı." ;;
  esac
  guard_dir=${NORM%/*}
  if [ -d "$guard_dir" ]; then
    real_dir=$(cd "$guard_dir" && pwd -P)
    real_stack=$(cd "$STACK_DIR" 2>/dev/null && pwd -P || printf '%s' "$STACK_DIR")
    real_map=$(cd "$MAP_ROOT" 2>/dev/null && pwd -P || printf '%s' "$MAP_ROOT")
    case "$real_dir/" in
      "$real_stack"/* | "$real_map"/*) ;;
      *) die "Güvenlik: $NORM bir kısayol (symlink) üzerinden $STACK_DIR ve $MAP_ROOT dışına çıkıyor, hiçbir şey yazılmadı." ;;
    esac
  fi
  GUARDED=$NORM
}

# ---- path guard (end) -------------------------------------------------------------------------

# The writers. Nothing else in this script writes to the disk.
safe_cp() { # src dst: a copy that keeps owner, mode and times (the backups, the undo)
  guard "$2"
  cp -p "$1" "$GUARDED"
}
safe_put() { # src dst: new content for the nginx site file; the only writer the guard lets reach it
  ALLOW_SITE=true
  guard "$2"
  ALLOW_SITE=false
  cp "$1" "$GUARDED"
}
safe_mv() { # from to: an atomic replace inside one folder
  guard "$1"
  mv_from=$GUARDED
  guard "$2"
  mv -f "$mv_from" "$GUARDED"
}
safe_rm() { # path
  guard "$1"
  rm -f "$GUARDED"
}
safe_perms() { # owner mode path
  guard "$3"
  chown "$1" "$GUARDED"
  chmod "$2" "$GUARDED"
}
safe_like() { # reference new: gives the new file the owner and mode of the old one
  guard "$2"
  chown --reference="$1" "$GUARDED"
  chmod --reference="$1" "$GUARDED"
}
safe_awk_to() { # out awk-arguments...: awk's output goes to a new file
  awk_out=$1
  shift
  guard "$awk_out"
  awk "$@" >"$GUARDED"
}

# ---- reading ----------------------------------------------------------------------------------

# docker compose as the deploy script runs it (same files, same project). Reads nothing from stdin.
compose() {
  (cd "$STACK_DIR" && docker compose --env-file .env --env-file image.env "$@" </dev/null)
}

# The lines of a container's environment we may show; every other line is dropped here. The key id
# of the notice key (NOTICE_SIGNING_KID) is no secret; the key itself (..._KEY) is never matched.
show_env() { # container-id
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" </dev/null |
    grep -E '^(MIN_CLIENT_LEVEL|WATCH_PUSH[A-Z_]*|NOTICE_SIGNING_KID)=' || true
}

size_text() { # file
  bytes=$(wc -c <"$1")
  awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b / 1048576 }'
}

env_level_now() { # the current value, shown only when it is a plain number
  level=$(sed -n 's/^MIN_CLIENT_LEVEL=//p' "$ENV_FILE" | tail -n 1)
  case "$level" in
    "") printf 'yok' ;;
    *[!0-9]*) printf 'sayı değil' ;;
    *) printf '%s' "$level" ;;
  esac
}

env_is_done() {
  [ "$(grep -c '^MIN_CLIENT_LEVEL=' "$ENV_FILE" || true)" = 1 ] &&
    grep -qxF "MIN_CLIENT_LEVEL=$WANT_LEVEL" "$ENV_FILE"
}

compose_is_done() {
  grep -qF 'WATCH_PUSH:' "$COMPOSE_FILE"
}

perms_ok() { # file mode
  [ "$(stat -c '%U:%G %a' "$1")" = "$OWNER $2" ]
}

nginx_is_done() {
  grep -qF 'bargu_map_cache_control' "$NGINX_SITE"
}

# The domain the Bargu site answers for (its first server_name).
nginx_domain() {
  sed -n 's/^[[:space:]]*server_name[[:space:]]\{1,\}\([^ ;]\{1,\}\);.*/\1/p' "$NGINX_SITE" | head -n 1
}

# nginx -t checks the WHOLE nginx configuration (every site), not only ours; its answer is kept in
# NGINX_OUT (file names and directives, no secrets).
nginx_check() {
  if NGINX_OUT=$(nginx -t 2>&1 </dev/null); then return 0; fi
  return 1
}

nginx_show_out() { # the first lines of what nginx -t said
  printf '%s\n' "$NGINX_OUT" | head -n 5 | while read -r out_line; do note "  $out_line"; done
}

world_is_fresh() {
  [ -f "$WORLD_FILE" ] && [ -n "$(find "$WORLD_FILE" -mmin "-$WORLD_FRESH_MINUTES" 2>/dev/null)" ]
}

# The notice key as .env, compose.yml and the public file have it. Only presence is tested here;
# the value of NOTICE_SIGNING_KEY is never read into the script.
notice_has_key() {
  grep -q '^NOTICE_SIGNING_KEY=.' "$ENV_FILE" && grep -q '^NOTICE_SIGNING_KID=.' "$ENV_FILE"
}
notice_compose_ok() {
  grep -q '^  NOTICE_SIGNING_KEY:' "$COMPOSE_FILE"
}
notice_public_ok() { # the public file is there and is `kid:43 base64url characters`
  [ -s "$NOTICE_PUBLIC" ] && head -n 1 "$NOTICE_PUBLIC" | grep -Eq '^[A-Za-z0-9._-]{1,40}:[A-Za-z0-9_-]{43}$'
}
notice_kid() { # the key id (public)
  sed -n 's/^NOTICE_SIGNING_KID=//p' "$ENV_FILE" | tail -n 1
}

# Does this service already run with the new settings (the notice key included, once there is one)?
runtime_ok() { # service
  cid=$(compose ps -q "$1" 2>/dev/null || true)
  [ -n "$cid" ] || return 1
  lines=$(show_env "$cid")
  printf '%s\n' "$lines" | grep -qxF "MIN_CLIENT_LEVEL=$WANT_LEVEL" || return 1
  printf '%s\n' "$lines" | grep -q '^WATCH_PUSH=' || return 1
  if notice_has_key; then
    want_kid=$(notice_kid)
    printf '%s\n' "$lines" | grep -qxF "NOTICE_SIGNING_KID=$want_kid" || return 1
  fi
}

# ---- cleaning up ------------------------------------------------------------------------------

cleanup() {
  code=$?
  trap - EXIT
  if $STARTED && ! $DRY_RUN; then
    for leftover in "$ENV_FILE.new.$$" "$COMPOSE_FILE.new.$$" "$NGINX_NEW.$$" "$NOTICE_PUBLIC.tmp" "$WORLD_PART"; do
      if [ -e "$leftover" ]; then safe_rm "$leftover"; fi
    done
  fi
  exit "$code"
}

# Puts the backups of this run back (if there are any) and stops.
undo_and_die() { # message
  if [ -n "$BACKUP_STAMP" ]; then
    safe_cp "$ENV_FILE.bak-$BACKUP_STAMP" "$ENV_FILE"
    safe_cp "$COMPOSE_FILE.bak-$BACKUP_STAMP" "$COMPOSE_FILE"
    say "    Yedekler geri yüklendi (.bak-$BACKUP_STAMP)."
    # The key that was put back out of .env must not stay announced in the public file.
    if $NOTICE_CHANGED && ! notice_has_key; then safe_rm "$NOTICE_PUBLIC"; fi
  fi
  die "$1"
}

# ---- steps ------------------------------------------------------------------------------------

preflight() {
  if [ "$(id -u)" -ne 0 ]; then die "Bu script root olarak çalışmalı."; fi
  if [ ! -f "$ENV_FILE" ]; then die "$ENV_FILE yok; bu sunucu değil gibi görünüyor, hiçbir şey yapılmadı."; fi
  if [ ! -f "$COMPOSE_FILE" ]; then die "$COMPOSE_FILE yok; hiçbir şey yapılmadı."; fi
  if [ ! -f "$STACK_DIR/image.env" ]; then die "$STACK_DIR/image.env yok; hiçbir şey yapılmadı."; fi
  if ! command -v docker >/dev/null 2>&1; then die "docker bulunamadı; hiçbir şey yapılmadı."; fi
  if ! id deploy >/dev/null 2>&1; then die "'deploy' kullanıcısı yok; hiçbir şey yapılmadı."; fi
  # The files the script rewrites or chowns must be real files: .env, compose.yml and the nginx
  # site file. guard() refuses a link anyway; this says so now, before any backup, edit or restart
  # (the nginx step comes late: without this the run would back up, set the level and the key and
  # restart the services, and only then stop at the site file).
  for plain in "$ENV_FILE" "$COMPOSE_FILE" "$NGINX_SITE"; do
    if [ -L "$plain" ]; then
      die "Güvenlik: $plain bir kısayol (symlink); script yalnızca gerçek dosyaya yazar, hiçbir şey değiştirilmedi."
    fi
  done

  # A lower level reopens old app versions: never silently.
  now=$(env_level_now)
  case "$now" in
    yok | "sayı değil") ;;
    *)
      if [ "$WANT_LEVEL" -lt "$now" ] && ! $ALLOW_LOWER; then
        die "MIN_CLIENT_LEVEL şu an $now, istenen $WANT_LEVEL bundan düşük: bu, eski uygulama sürümlerini yeniden açar ve sessizce yapılmaz. Bilerek istiyorsan --allow-lower ekle. Hiçbir şey değiştirilmedi."
      fi
      ;;
  esac

  if env_is_done; then NEED_ENV=false; else NEED_ENV=true; fi
  if notice_has_key && notice_compose_ok && notice_public_ok; then NEED_NOTICE=false; else NEED_NOTICE=true; fi
  if compose_is_done; then
    NEED_COMPOSE=false
  else
    NEED_COMPOSE=true
    # The three lines go right after the stack-wide BILLING_TEST line (two spaces); the migrate
    # service has another one (six spaces) that must stay as it is.
    anchors=$(grep -c '^  BILLING_TEST: ' "$COMPOSE_FILE" || true)
    if [ "$anchors" != 1 ]; then
      die "compose.yml içinde '  BILLING_TEST: ' ile başlayan satır $anchors tane (1 olmalı); dosya beklenenden farklı, hiçbir şey değiştirilmedi."
    fi
  fi
}

step_backup() {
  step "1/9" "Yedek: .env ve compose.yml, değişmeden önce tarih damgalı kopya"
  if ! $NEED_ENV && ! $NEED_COMPOSE && ! $NEED_NOTICE; then
    note "zaten yapılmış: değiştirilecek bir şey yok, yeni yedek alınmadı"
    return 0
  fi
  stamp=$(date +%Y%m%d%H%M%S)
  if $DRY_RUN; then
    note "yapılacak: $ENV_FILE.bak-$stamp ve $COMPOSE_FILE.bak-$stamp oluşturulacak (eski yedeklere dokunulmaz)"
    return 0
  fi
  BACKUP_STAMP=$stamp
  safe_cp "$ENV_FILE" "$ENV_FILE.bak-$BACKUP_STAMP"
  safe_cp "$COMPOSE_FILE" "$COMPOSE_FILE.bak-$BACKUP_STAMP"
  # The .env copy holds the same secrets as the .env: private, whatever the original's mode was.
  safe_perms "$OWNER" 0600 "$ENV_FILE.bak-$BACKUP_STAMP"
  safe_perms "$OWNER" 0640 "$COMPOSE_FILE.bak-$BACKUP_STAMP"
  note "yapıldı: .env.bak-$BACKUP_STAMP ve compose.yml.bak-$BACKUP_STAMP ($STACK_DIR içinde)"
}

step_env() {
  step "2/9" ".env: MIN_CLIENT_LEVEL=$WANT_LEVEL (seviye $WANT_LEVEL'den eski uygulama sürümleri güncelleme ister)"
  if ! $NEED_ENV; then
    note "zaten yapılmış: MIN_CLIENT_LEVEL=$WANT_LEVEL"
    return 0
  fi
  before=$(env_level_now)
  lowering=""
  case "$before" in
    yok | "sayı değil") ;;
    *) if [ "$WANT_LEVEL" -lt "$before" ]; then lowering=" (--allow-lower: seviye DÜŞÜRÜLÜYOR, eski sürümler yeniden açılır)"; fi ;;
  esac
  if $DRY_RUN; then
    note "yapılacak: değer şu an '$before', $WANT_LEVEL yapılacak$lowering (satır varsa değiştirilir, yoksa eklenir; başka satıra dokunulmaz)"
    return 0
  fi
  tmp="$ENV_FILE.new.$$"
  safe_awk_to "$tmp" -v line="MIN_CLIENT_LEVEL=$WANT_LEVEL" '
    /^MIN_CLIENT_LEVEL=/ { if (!seen) { print line; seen = 1 } next }
    { print }
    END { if (!seen) print line }
  ' "$ENV_FILE"
  if [ "$(grep -c '^MIN_CLIENT_LEVEL=' "$tmp" || true)" != 1 ] || ! grep -qxF "MIN_CLIENT_LEVEL=$WANT_LEVEL" "$tmp"; then
    die "Yeni .env beklenen gibi çıkmadı; eski dosya olduğu gibi duruyor."
  fi
  safe_like "$ENV_FILE" "$tmp"
  safe_mv "$tmp" "$ENV_FILE"
  note "yapıldı: MIN_CLIENT_LEVEL=$WANT_LEVEL (önceki değer: $before)$lowering"
}

step_compose() {
  step "3/9" "compose.yml: WATCH_PUSH üç satırı (arka plan canlı modu), BILLING_TEST satırından sonra"
  if ! $NEED_COMPOSE; then
    note "zaten yapılmış: WATCH_PUSH satırları compose.yml içinde var"
    return 0
  fi
  if $DRY_RUN; then
    note "yapılacak: WATCH_PUSH, WATCH_PUSH_MIN_SECONDS ve WATCH_PUSH_PER_HOUR satırları eklenecek, sonra 'docker compose config' ile doğrulanacak"
    return 0
  fi
  tmp="$COMPOSE_FILE.new.$$"
  # shellcheck disable=SC2016 # the ${...} below is compose.yml text, not for the shell to expand
  safe_awk_to "$tmp" '
    { print }
    index($0, "  BILLING_TEST: ") == 1 {
      print "  WATCH_PUSH: ${WATCH_PUSH:-on}"
      print "  WATCH_PUSH_MIN_SECONDS: ${WATCH_PUSH_MIN_SECONDS:-90}"
      print "  WATCH_PUSH_PER_HOUR: ${WATCH_PUSH_PER_HOUR:-20}"
    }
  ' "$COMPOSE_FILE"
  old_lines=$(wc -l <"$COMPOSE_FILE")
  new_lines=$(wc -l <"$tmp")
  if [ "$new_lines" -ne $((old_lines + 3)) ] || ! grep -qF 'WATCH_PUSH:' "$tmp"; then
    die "Yeni compose.yml beklenen gibi çıkmadı; eski dosya olduğu gibi duruyor."
  fi
  safe_like "$COMPOSE_FILE" "$tmp"
  safe_mv "$tmp" "$COMPOSE_FILE"
  note "yapıldı: 3 satır eklendi"
}

# Both edited files must still make a valid stack; otherwise the backups go back.
step_validate() {
  if $DRY_RUN || [ -z "$BACKUP_STAMP" ]; then return 0; fi
  if compose config -q >/dev/null 2>&1; then
    note "doğrulandı: 'docker compose config' hatasız"
  else
    note "Ayrıntı için: cd $STACK_DIR && docker compose --env-file .env --env-file image.env config -q"
    undo_and_die "Yeni ayarlarla 'docker compose config' hata verdi."
  fi
}

# infra/staging/notice-key.sh, byte for byte. It is here because the owner runs ONE script, which
# cannot fetch a second file; `sh apply-pending.sh --check-notice-key` (run from the repo) says
# whether this copy still equals the file. It runs in a subshell of this script (see
# run_notice_key), so it uses this script's guard() and safe_* writers.
notice_key_script() {
  cat <<'NOTICE_KEY_SCRIPT_END'
#!/bin/sh
# Staging's server notice signing key (QA-28 B-1, docs/ADR/0016 Ek), made ON the server, once.
# Run as root by apply-pending.sh, which holds the write guard (QA-30 L-3); safe to run again (a key
# that is there is kept as it is).
#
#   (from apply-pending.sh)      adds NOTICE_SIGNING_KEY and NOTICE_SIGNING_KID=stg-n1 to .env when
#                                the key is missing, and writes the public key for the app build
#   sh notice-key.sh --dry-run   says what it would do and writes nothing (also fine alone)
#
# Every write goes through guard() and the safe_* writers that apply-pending.sh defines before it
# runs this text (they refuse any path outside /opt/bargu/staging, and a target that is itself a
# symlink). This file has no guard of its own: run alone, a real run is refused before it writes
# anything.
#
# The 32-byte seed comes from openssl's random generator. It lives only in this shell's memory and
# in .env (0600, deploy:deploy, after a backup that is 0600 too, QA-30 L-2), and is never printed,
# logged or put on a command line (printf is a shell builtin). Only the public half leaves, as
# `stg-n1:<base64url>`, in notice-public-key.txt (0644) for EXPO_PUBLIC_NOTICE_KEYS in
# apps/mobile/eas.json. Writes only under /opt/bargu/staging. The API and the worker read the key on
# their next start (restarting them is the caller's); the worker's start log then shows the same
# public key line.
set -eu
umask 077

STACK_DIR=/opt/bargu/staging
ENV_FILE="$STACK_DIR/.env"
COMPOSE_FILE="$STACK_DIR/compose.yml"
PUBLIC_FILE="$STACK_DIR/notice-public-key.txt"
KID=stg-n1
# DER of an Ed25519 public key (RFC 8410, SubjectPublicKeyInfo) before its 32 bytes.
PUBLIC_PREFIX=302a300506032b6570032100

say() { printf 'notice-key: %s\n' "$*"; }
fail() {
  printf 'notice-key: %s\n' "$*" >&2
  exit 1
}

dry_run=0
case "${1:-}" in
  --dry-run) dry_run=1 ;;
  '') ;;
  *)
    echo "kullanım: notice-key.sh [--dry-run]" >&2
    exit 64
    ;;
esac

# A real run needs the caller's guard; without it nothing is written.
if [ "$dry_run" -eq 0 ]; then
  for writer in guard safe_cp safe_mv safe_perms safe_like safe_awk_to; do
    command -v "$writer" >/dev/null 2>&1 ||
      fail "yazma koruması yok ($writer): gerçek çalıştırma apply-pending.sh içinden yapılır; tek başına yalnızca --dry-run çalışır, hiçbir şey yazılmadı"
  done
fi

[ -f "$ENV_FILE" ] || fail "$ENV_FILE yok"
command -v openssl >/dev/null 2>&1 || fail "openssl yok"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
is_key() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_-]{43}$'; }

# The seed (base64url, from memory) as an Ed25519 private key in PKCS#8 DER (RFC 8410): a fixed
# 16-byte prefix (octal escapes: POSIX printf has no \x), then the 32 bytes.
seed_der() {
  printf '\060\056\002\001\000\060\005\006\003\053\145\160\004\042\004\040'
  printf '%s=' "$1" | tr '_-' '/+' | openssl base64 -d -A
}

# The public key of a seed, base64url; fails unless openssl gives a 44-byte Ed25519 SPKI.
public_of() {
  spki=$(seed_der "$1" | openssl pkey -inform DER -pubout -outform DER | od -An -v -tx1 | tr -d ' \n')
  [ "${#spki}" -eq 88 ] || return 1
  case "$spki" in
    "$PUBLIC_PREFIX"*) ;;
    *) return 1 ;;
  esac
  seed_der "$1" | openssl pkey -inform DER -pubout -outform DER | tail -c 32 | b64url
}

existing=$(sed -n 's/^NOTICE_SIGNING_KEY=//p' "$ENV_FILE" | tail -n 1)
existing_kid=$(sed -n 's/^NOTICE_SIGNING_KID=//p' "$ENV_FILE" | tail -n 1)

if [ -n "$existing" ]; then
  is_key "$existing" || fail ".env'deki NOTICE_SIGNING_KEY 32 baytlık base64url değil; elle bak"
  [ -n "$existing_kid" ] || fail ".env'de NOTICE_SIGNING_KEY var ama NOTICE_SIGNING_KID yok; elle bak"
  seed=$existing
  kid=$existing_kid
  say "NOTICE_SIGNING_KEY zaten var ($kid): değiştirilmedi"
elif [ "$dry_run" -eq 1 ]; then
  say "NOTICE_SIGNING_KEY yok: üretilecek; .env yedeklenip NOTICE_SIGNING_KEY ve NOTICE_SIGNING_KID=$KID eklenecek (0600, deploy:deploy)"
  seed=''
  kid=$KID
else
  seed=$(openssl rand 32 | b64url)
  is_key "$seed" || fail "anahtar üretilemedi"
  kid=$KID
  # Checked before anything is written: openssl must make a public key of it.
  public_of "$seed" >/dev/null || fail "açık anahtar çıkarılamadı; hiçbir şey yazılmadı"
  # The backup holds the same secrets as .env: 0600 whatever the mode of the original was.
  backup="$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
  safe_cp "$ENV_FILE" "$backup"
  safe_perms deploy:deploy 0600 "$backup"
  # The new .env is written beside it and moved over it (guard() checks every path); the seed goes
  # through printf, a shell builtin, so it is on no command line.
  env_new="$ENV_FILE.new.$$"
  guard "$env_new"
  {
    grep -v -e '^NOTICE_SIGNING_KEY=' -e '^NOTICE_SIGNING_KID=' "$ENV_FILE" || true
    printf 'NOTICE_SIGNING_KEY=%s\nNOTICE_SIGNING_KID=%s\n' "$seed" "$kid"
  } >"$GUARDED"
  safe_like "$ENV_FILE" "$env_new"
  safe_mv "$env_new" "$ENV_FILE"
  safe_perms deploy:deploy 0600 "$ENV_FILE"
  say "NOTICE_SIGNING_KEY üretildi ve .env'e eklendi ($kid); yedek: $backup"
fi

if [ -n "$seed" ]; then
  public=$(public_of "$seed") || fail "açık anahtar çıkarılamadı"
  is_key "$public" || fail "açık anahtar çıkarılamadı"
  if [ "$dry_run" -eq 1 ]; then
    say "$PUBLIC_FILE yazılacak: $kid:$public"
  else
    public_new="$PUBLIC_FILE.tmp"
    guard "$public_new"
    printf '%s:%s\n' "$kid" "$public" >"$GUARDED"
    safe_perms root:root 0644 "$public_new"
    safe_mv "$public_new" "$PUBLIC_FILE"
    say "açık anahtar $PUBLIC_FILE dosyasında: $kid:$public"
  fi
else
  say "$PUBLIC_FILE yeni anahtarın açık yarısıyla yazılacak"
fi

# The containers see the key only if compose.yml passes it (infra/staging/compose.yml has the two
# lines; an older copy on the server gets them after ENTITLEMENT_SIGNING_KID).
if [ -f "$COMPOSE_FILE" ] && ! grep -q '^  NOTICE_SIGNING_KEY:' "$COMPOSE_FILE"; then
  if ! grep -q '^  ENTITLEMENT_SIGNING_KID:' "$COMPOSE_FILE"; then
    say "uyarı: compose.yml NOTICE_SIGNING_KEY'i geçirmiyor; repo'daki infra/staging/compose.yml ile güncelle"
  elif [ "$dry_run" -eq 1 ]; then
    say "compose.yml'e NOTICE_SIGNING_KEY ve NOTICE_SIGNING_KID satırları eklenecek"
  else
    compose_backup="$COMPOSE_FILE.bak-$(date +%Y%m%d%H%M%S)"
    safe_cp "$COMPOSE_FILE" "$compose_backup"
    safe_perms deploy:deploy 0640 "$compose_backup"
    compose_new="$COMPOSE_FILE.new.$$"
    # shellcheck disable=SC2016 # the ${...} below is compose.yml text, not for the shell to expand
    safe_awk_to "$compose_new" '
      { print }
      /^  ENTITLEMENT_SIGNING_KID:/ {
        print "  NOTICE_SIGNING_KEY: ${NOTICE_SIGNING_KEY:-}"
        print "  NOTICE_SIGNING_KID: ${NOTICE_SIGNING_KID:-}"
      }
    ' "$COMPOSE_FILE"
    safe_like "$COMPOSE_FILE" "$compose_new"
    safe_mv "$compose_new" "$COMPOSE_FILE"
    safe_perms deploy:deploy 0640 "$COMPOSE_FILE"
    say "compose.yml NOTICE_SIGNING_KEY ve NOTICE_SIGNING_KID'i geçiriyor"
  fi
fi

if [ "$dry_run" -eq 1 ]; then
  say "deneme: hiçbir şey yazılmadı"
else
  say "api ve worker yeniden başlayınca sunucu haberleri imzalı gider"
fi
NOTICE_KEY_SCRIPT_END
}

# Runs the embedded notice-key.sh with the given arguments (--dry-run, or none) and keeps its
# answer in NOTICE_OUT: only the lines it prefixes with "notice-key: " and the guard's own refusals
# ("HATA: "); anything else, an openssl complaint say, is dropped, so nothing unforeseen can reach
# the screen. The text is eval'ed in a command substitution, i.e. a subshell of this script: it has
# guard(), the safe_* writers and DRY_RUN (so in a dry run even a stray write dies), its `exit`
# ends only the subshell, its stdin is /dev/null, and it sets its own `set -eu` (errexit is
# switched off around the call only so that nothing here is a "tested" context, which would
# silence the child's own -e).
run_notice_key() {
  set +e
  NOTICE_OUT=$(eval "$(notice_key_script)" </dev/null 2>&1)
  notice_rc=$?
  set -e
  NOTICE_OUT=$(printf '%s\n' "$NOTICE_OUT" | grep -E '^(notice-key: |HATA: )' || true)
  return "$notice_rc"
}

show_notice_out() {
  printf '%s\n' "$NOTICE_OUT" | while read -r out_line; do note "$out_line"; done
}

step_notice() {
  step "4/9" "Sunucu haberlerinin imza anahtarı: NOTICE_SIGNING_KEY (.env), compose satırları, açık anahtar dosyası"
  # The child's writes go through guard() too (it would stop at a symlink); still, refuse here,
  # before calling it and with a clearer message, when any path it writes is a symlink (.env and
  # compose.yml were checked in preflight; the backups it makes are new files named with the time,
  # so no link may sit under that name either).
  for target in "$NOTICE_PUBLIC" "$NOTICE_PUBLIC.tmp" "$ENV_FILE".bak-* "$COMPOSE_FILE".bak-*; do
    if [ -L "$target" ]; then
      problem "$target bir kısayol (symlink); notice-key.sh oraya yazmasın diye çağrılmadı"
      NOTICE_FAILED=true
      return 0
    fi
  done
  if ! command -v openssl >/dev/null 2>&1; then
    problem "openssl bulunamadı; anahtar üretilemez, bu adım atlandı"
    NOTICE_FAILED=true
    return 0
  fi
  # Complete on disk: is the public file also the one THIS key gives? (the child's own dry run
  # says what it would write; a mismatch is rewritten, the key itself is kept)
  if ! $NEED_NOTICE; then
    if run_notice_key --dry-run; then
      derived=$(printf '%s\n' "$NOTICE_OUT" | sed -n 's/^notice-key: .*notice-public-key\.txt yazılacak: //p' | head -n 1)
      if [ -n "$derived" ] && [ "$derived" != "$(head -n 1 "$NOTICE_PUBLIC")" ]; then
        NEED_NOTICE=true
        note "açık anahtar dosyası bu anahtarın açık yarısıyla uyuşmuyor, yeniden yazılacak"
      fi
    else
      problem "notice-key.sh --dry-run hata verdi (anahtar bozuk olabilir); elle bak:"
      show_notice_out
      NOTICE_FAILED=true
      return 0
    fi
  fi
  if ! $NEED_NOTICE; then
    note "zaten yapılmış: anahtar .env içinde ($(notice_kid)), compose.yml onu geçiriyor, açık anahtar dosyası güncel"
    return 0
  fi
  if $DRY_RUN; then
    note "yapılacak: notice-key.sh --dry-run'ın dediği (bu betiğin içindeki kopyası):"
    if run_notice_key --dry-run; then show_notice_out; else
      problem "notice-key.sh --dry-run hata verdi:"
      show_notice_out
      NOTICE_FAILED=true
    fi
    note "yapılacak: api ve worker yeni anahtarla yeniden başlatılacak (8. adım); gizli anahtar yalnız .env'e yazılır, hiçbir yerde gösterilmez"
    return 0
  fi
  note "çalışıyor: notice-key.sh (anahtar sunucuda üretilir, yalnız .env'e yazılır; ekrana çıkmaz)"
  if [ -n "$BACKUP_STAMP" ]; then
    # notice-key.sh names its own backups by the second: not the second of ours (it would
    # overwrite our copy of the original files with the half-edited ones).
    while [ "$(date +%Y%m%d%H%M%S)" = "$BACKUP_STAMP" ]; do sleep 1; done
  fi
  if run_notice_key; then
    show_notice_out
  else
    problem "notice-key.sh hata verdi:"
    show_notice_out
    NOTICE_FAILED=true
    return 0
  fi
  NOTICE_CHANGED=true
  # notice-key.sh makes its own backups private now; this also sets the ones that older versions of
  # it (or older runs) left: a .env backup holds the same secrets as .env, private in any case.
  for kept in "$ENV_FILE".bak-*; do
    if [ -f "$kept" ]; then safe_perms "$OWNER" 0600 "$kept"; fi
  done
  for kept in "$COMPOSE_FILE".bak-*; do
    if [ -f "$kept" ]; then safe_perms "$OWNER" 0640 "$kept"; fi
  done
  if notice_has_key && notice_compose_ok && notice_public_ok; then
    note "yapıldı: anahtar .env'de, compose.yml onu geçiriyor, açık anahtar $NOTICE_PUBLIC dosyasında"
  else
    problem "notice-key.sh bitti ama bir şey eksik: anahtar .env'de $(if notice_has_key; then echo var; else echo yok; fi), compose satırları $(if notice_compose_ok; then echo var; else echo yok; fi), açık anahtar dosyası $(if notice_public_ok; then echo tamam; else echo eksik; fi) (compose.yml eski olabilir: repo'daki infra/staging/compose.yml ile güncelle)"
    NOTICE_FAILED=true
  fi
}

step_perms() {
  step "5/9" "Sahip ve izinler: $OWNER; .env 0600; compose.yml 0640"
  fix=false
  if ! perms_ok "$ENV_FILE" 600; then fix=true; fi
  if ! perms_ok "$COMPOSE_FILE" 640; then fix=true; fi
  if ! $fix; then
    note "zaten yapılmış: .env ($OWNER, 0600) ve compose.yml ($OWNER, 0640) doğru"
    return 0
  fi
  if $DRY_RUN; then
    note "yapılacak: izinler düzeltilecek (.env: $(stat -c '%U:%G %a' "$ENV_FILE"), compose.yml: $(stat -c '%U:%G %a' "$COMPOSE_FILE"))"
    return 0
  fi
  safe_perms "$OWNER" 0600 "$ENV_FILE"
  safe_perms "$OWNER" 0640 "$COMPOSE_FILE"
  note "yapıldı: .env $OWNER 0600, compose.yml $OWNER 0640"
}

# One try at one day's build; leaves no half-written file behind when it fails.
extract_world() { # YYYYMMDD
  url="https://build.protomaps.com/$1.pmtiles"
  note "indiriliyor: $url (yakınlaştırma 0-$WORLD_MAXZOOM, yaklaşık 45 MB)"
  safe_rm "$WORLD_PART"
  guard "$WORLD_PART"
  if timeout 1200 "$PMTILES" extract "$url" "$GUARDED" --maxzoom="$WORLD_MAXZOOM" --download-threads=4 </dev/null &&
    "$PMTILES" verify "$GUARDED" </dev/null; then
    return 0
  fi
  safe_rm "$WORLD_PART"
  return 1
}

step_world() {
  step "6/9" "Dünya haritası: $WORLD_FILE (düşük ayrıntı, yakınlaştırma 0-$WORLD_MAXZOOM)"
  if world_is_fresh; then
    note "zaten yapılmış: dosya var ve 7 günden yeni ($(size_text "$WORLD_FILE"))"
    return 0
  fi
  if [ -L "$WORLD_FILE" ] || [ -L "$WORLD_PART" ]; then
    problem "$WORLD_FILE veya $WORLD_PART bir kısayol (symlink); oraya yazılmaz, harita atlandı"
    MAP_FAILED=true
    return 0
  fi
  if [ -f "$WORLD_FILE" ]; then note "dosya var ama 7 günden eski, yenilenecek"; fi
  if [ ! -x "$PMTILES" ]; then
    problem "$PMTILES çalıştırılamıyor (infra/vps/setup-map.sh kurulmamış olabilir); harita atlandı"
    MAP_FAILED=true
    return 0
  fi
  if [ ! -d "$TILES_DIR" ]; then
    problem "$TILES_DIR yok (infra/vps/setup-map.sh kurulmamış olabilir); harita atlandı"
    MAP_FAILED=true
    return 0
  fi
  today=$(date -u +%Y%m%d)
  yesterday=$(date -u -d yesterday +%Y%m%d)
  if $DRY_RUN; then
    note "yapılacak: https://build.protomaps.com/$today.pmtiles adresinden $WORLD_PART dosyasına indirilecek ('pmtiles extract --maxzoom=$WORLD_MAXZOOM'), 'pmtiles verify' ile doğrulanacak, sonra tek hamlede world.pmtiles olacak"
    note "yapılacak: bugünün yapısı henüz çıkmadıysa dünkü ($yesterday) denenecek"
    note "kuru çalıştırma: hiçbir şey indirilmedi"
    return 0
  fi
  if extract_world "$today"; then
    used=$today
  elif extract_world "$yesterday"; then
    used=$yesterday
    note "bugünün yapısı alınamadı, dünkü kullanıldı"
  else
    problem "world.pmtiles indirilemedi (bugün ve dün denendi); varsa eski dosya olduğu gibi duruyor. Biraz sonra scripti yeniden çalıştırın."
    MAP_FAILED=true
    return 0
  fi
  safe_perms root:root 0644 "$WORLD_PART"
  safe_mv "$WORLD_PART" "$WORLD_FILE"
  note "yapıldı: $WORLD_FILE ($(size_text "$WORLD_FILE"), yapı $used)"
}

step_nginx() {
  step "7/9" "nginx: /map/ altında bulunamayan dosya (404) önbelleğe alınmasın (Cache-Control: no-store)"
  if [ ! -f "$NGINX_SITE" ]; then
    problem "$NGINX_SITE yok (infra/vps/setup-nginx.sh çalıştırılmamış olabilir); nginx'e dokunulmadı"
    NGINX_FAILED=true
    return 0
  fi
  if nginx_is_done; then
    note "zaten yapılmış: $NGINX_SITE dosyasında /map/ için duruma göre Cache-Control var (404: no-store; 200, 206, 304: uzun önbellek)"
    return 0
  fi
  if [ -L "$NGINX_SITE" ]; then
    problem "$NGINX_SITE bir kısayol (symlink); oraya yazılmaz, nginx'e dokunulmadı"
    NGINX_FAILED=true
    return 0
  fi
  # What the edit needs to find, in the installed (domain filled in) site file.
  old_header='add_header Cache-Control "public, max-age=86400" always;'
  headers=$(grep -cF "$old_header" "$NGINX_SITE" || true)
  servers=$(grep -c '^server[[:space:]]*{' "$NGINX_SITE" || true)
  if [ "$headers" != 1 ] || [ "$servers" -lt 1 ]; then
    problem "$NGINX_SITE beklenen biçimde değil ($old_header satırı $headers tane, 1 olmalı; üst düzey server bloğu $servers tane); nginx'e dokunulmadı"
    NGINX_FAILED=true
    return 0
  fi
  if [ "$(readlink -f "$NGINX_SITE_LINK" 2>/dev/null || true)" != "$NGINX_SITE" ]; then
    problem "$NGINX_SITE_LINK, $NGINX_SITE dosyasına bağlı değil; nginx başka bir dosyayı okuyor olabilir, nginx'e dokunulmadı"
    NGINX_FAILED=true
    return 0
  fi
  if ! command -v nginx >/dev/null 2>&1 || ! command -v systemctl >/dev/null 2>&1; then
    problem "nginx veya systemctl bulunamadı; nginx'e dokunulmadı"
    NGINX_FAILED=true
    return 0
  fi
  note "bu nginx başka sitelere de hizmet veriyor, yalnız reload yapılacak (restart yok; reload öncesi 'nginx -t' bütün yapılandırmayı denetler)"
  if $DRY_RUN; then
    note "yapılacak: $NGINX_SITE dosyasının yedeği $STACK_DIR içine alınacak ($NGINX_BAK-<damga>)"
    note "yapılacak: dosyada iki küçük değişiklik: üstüne bir 'map \$status \$bargu_map_cache_control' bloğu, /map/ içindeki Cache-Control satırı bu değişkeni kullanacak"
    note "yapılacak: 'nginx -t' (bütün yapılandırma); hata verirse yedek geri konur ve reload yapılmaz"
    note "yapılacak: 'systemctl reload nginx' (diğer siteler kesintisiz çalışmaya devam eder)"
    note "bilgi: nginx adımı hata verirse yalnız nginx geri alınır; .env, compose.yml, imza anahtarı ve servislerin yeniden başlatılması uygulanmış kalır, betiği yeniden çalıştırmak güvenlidir"
    return 0
  fi
  if ! nginx_check; then
    problem "'nginx -t' bizim değişikliğimizden ÖNCE bile hata veriyor (başka bir sitenin ayarı olabilir); nginx'e dokunulmadı:"
    nginx_show_out
    NGINX_FAILED=true
    return 0
  fi
  nginx_stamp=$(date +%Y%m%d%H%M%S)
  safe_cp "$NGINX_SITE" "$NGINX_BAK-$nginx_stamp"
  note "yedek alındı: $NGINX_BAK-$nginx_stamp"
  tmp="$NGINX_NEW.$$"
  # The map goes in front of the first server block and the fixed header line becomes the variable.
  # shellcheck disable=SC2016 # the $bargu_map_cache_control below is nginx text, not for the shell
  safe_awk_to "$tmp" '
    !placed && /^server[ \t]*\{/ {
      print "# /map/ Cache-Control by response code (infra/staging/nginx/bargu-staging.conf has the long note)"
      print "map $status $bargu_map_cache_control {"
      print "    default \"no-store\";"
      print "    200     \"public, max-age=86400\";"
      print "    206     \"public, max-age=86400\";"
      print "    304     \"public, max-age=86400\";"
      print "}"
      print ""
      placed = 1
    }
    /^[ \t]*add_header Cache-Control "public, max-age=86400" always;[ \t]*$/ {
      match($0, /^[ \t]*/)
      print substr($0, 1, RLENGTH) "add_header Cache-Control $bargu_map_cache_control always;"
      next
    }
    { print }
  ' "$NGINX_SITE"
  if [ "$(grep -cF 'bargu_map_cache_control' "$tmp" || true)" != 2 ] || grep -qF "$old_header" "$tmp"; then
    die "Yeni nginx dosyası beklenen gibi çıkmadı; $NGINX_SITE olduğu gibi duruyor."
  fi
  safe_put "$tmp" "$NGINX_SITE"
  if nginx_check; then
    if systemctl reload nginx </dev/null; then
      note "yapıldı: 'nginx -t' tamam, 'systemctl reload nginx' yapıldı (restart yok)"
      if ! systemctl is-active --quiet nginx </dev/null; then
        problem "reload sonrası nginx çalışır görünmüyor; 'systemctl status nginx' bakın"
        NGINX_FAILED=true
      fi
      return 0
    fi
    problem "'systemctl reload nginx' başarısız oldu, yedek geri konuyor (dosya ile çalışan ayar aynı kalsın):"
  else
    problem "'nginx -t' yeni dosyayla hata verdi, yedek geri konuyor, reload YAPILMADI:"
    nginx_show_out
  fi
  safe_put "$NGINX_BAK-$nginx_stamp" "$NGINX_SITE"
  if nginx_check; then
    note "yedek geri yüklendi, 'nginx -t' yine tamam; nginx eskisi gibi çalışıyor"
  else
    problem "yedek geri yüklendikten sonra da 'nginx -t' hata veriyor (başka bir ayar olabilir); nginx hâlâ eski ayarla çalışıyor, reload yapılmadı:"
    nginx_show_out
  fi
  # Only nginx is rolled back: .env, compose.yml, the key and the restart of the services (the steps
  # around this one) stay as they are. Running the script again is safe; say so.
  problem "nginx geri alındı; diğer adımlar uygulandı, betiği yeniden çalıştırabilirsin."
  NGINX_FAILED=true
}

step_restart() {
  step "8/9" "api ve worker yeniden başlatılıyor (yeni ayarları okusunlar)"
  if runtime_ok api && runtime_ok worker; then
    note "zaten yapılmış: api ve worker şu an MIN_CLIENT_LEVEL=$WANT_LEVEL ve WATCH_PUSH ile çalışıyor, yeniden başlatmaya gerek yok"
    return 0
  fi
  if $DRY_RUN; then
    note "yapılacak: docker compose up -d --wait worker api (iki servis yeni ayarlarla yeniden oluşturulur, kısa bir kesinti olur)"
    return 0
  fi
  note "çalışıyor: docker compose up -d --wait worker api (en çok iki dakika sürer)"
  if compose up -d --wait --wait-timeout 120 worker api; then
    note "yapıldı: api ve worker sağlıklı"
    return 0
  fi
  if [ -n "$BACKUP_STAMP" ]; then
    safe_cp "$ENV_FILE.bak-$BACKUP_STAMP" "$ENV_FILE"
    safe_cp "$COMPOSE_FILE.bak-$BACKUP_STAMP" "$COMPOSE_FILE"
    note "yedekler geri yüklendi (.bak-$BACKUP_STAMP), eski ayarlarla yeniden başlatılıyor"
    if $NOTICE_CHANGED && ! notice_has_key; then safe_rm "$NOTICE_PUBLIC"; fi
    compose up -d --wait --wait-timeout 120 worker api || true
  fi
  note "Günlük için: cd $STACK_DIR && docker compose --env-file .env --env-file image.env logs --tail 50 api worker"
  die "api ve worker sağlıklı olarak ayağa kalkmadı."
}

health_check() { # tries
  port_line=$(compose port api 3000 2>/dev/null || true)
  case "$port_line" in
    127.0.0.1:[0-9]*) addr=$port_line ;;
    *) addr=127.0.0.1:3100 ;;
  esac
  tries=0
  while [ "$tries" -lt "$1" ]; do
    if body=$(curl -fsS --max-time 5 "http://$addr/health/live" 2>/dev/null </dev/null); then
      note "/health/live: $(printf '%s' "$body" | cut -c1-200)"
      return 0
    fi
    tries=$((tries + 1))
    if [ "$tries" -lt "$1" ]; then sleep 2; fi
  done
  return 1
}

# What a phone is told under /map/, asked of the local nginx under the Bargu domain: shows the
# status and the Cache-Control lines only. The answer must be `code` with exactly one Cache-Control
# line, "no-store".
check_cache_header() { # label path code tries [curl arguments]
  cc_label=$1
  cc_path=$2
  cc_code=$3
  cc_tries=$4
  shift 4
  tries=0
  while :; do
    # -k: only the headers of our own nginx on this machine are read, so the certificate chain does
    # not matter here (and an expired one must not hide the answer).
    if ! answer=$(curl -sSk -o /dev/null -D - --max-time 10 --resolve "$domain:443:127.0.0.1" "$@" "https://$domain$cc_path" 2>/dev/null </dev/null); then
      note "$cc_label: nginx'e bağlanılamadı, atlandı"
      return 0
    fi
    code=$(printf '%s\n' "$answer" | tr -d '\r' | sed -n '1s/^HTTP[^ ]* \([0-9]\{3\}\).*/\1/p')
    cache=$(printf '%s\n' "$answer" | tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p' | head -n 1)
    lines=$(printf '%s\n' "$answer" | tr -d '\r' | grep -ci '^cache-control:' || true)
    if [ "$code" != "$cc_code" ] || { [ "$cache" = no-store ] && [ "$lines" = 1 ]; }; then break; fi
    tries=$((tries + 1))
    # A reload is gradual: for a moment the old workers may still answer. Ask again for a few seconds.
    if [ "$tries" -ge "$cc_tries" ]; then break; fi
    sleep 1
  done
  note "$cc_label: HTTP ${code:-?}, Cache-Control: ${cache:-yok} ($lines satır)"
  if [ "$code" = "$cc_code" ] && { [ "$cache" != no-store ] || [ "$lines" != 1 ]; }; then
    if $DRY_RUN; then
      note "(şu an böyle; 7. adım bunu düzeltecek)"
    else
      problem "$cc_label hâlâ önbelleğe alınabilir ya da birden çok Cache-Control satırı var (tek satır: no-store olmalı)"
      CHECK_FAILED=true
    fi
  fi
}

check_map_cache() { # tries
  domain=$(nginx_domain 2>/dev/null || true)
  if [ -z "$domain" ]; then
    note "/map/ Cache-Control kontrolü: alan adı okunamadı, atlandı"
    return 0
  fi
  # Only the 404: a 416 (a range past the end of a file) keeps its two Cache-Control lines, see the
  # note in infra/staging/nginx/bargu-staging.conf.
  check_cache_header "/map/ altında olmayan dosya (404)" /map/yok-boyle-bir-dosya.pmtiles 404 "$1"
}

# The public half of the notice key (public: safe to show) and whether a service log shows it, i.e.
# whether the server signs. Only the public line is ever printed, never a log line.
check_notice_signing() { # tries
  if ! notice_public_ok; then
    note "açık anahtar: $NOTICE_PUBLIC yok ya da biçimi bozuk"
    return 0
  fi
  public_line=$(head -n 1 "$NOTICE_PUBLIC")
  note "açık anahtar satırı (apps/mobile/eas.json EXPO_PUBLIC_NOTICE_KEYS için): $public_line"
  tries=0
  while :; do
    for svc in worker api; do
      if compose logs --no-color --tail 500 "$svc" 2>/dev/null | grep -qF -- "$public_line"; then
        note "imza: $svc günlüğünde '$public_line' satırı var, sunucu haberleri imzalıyor"
        return 0
      fi
    done
    tries=$((tries + 1))
    if [ "$tries" -ge "$1" ]; then break; fi
    sleep 1
  done
  if $DRY_RUN; then
    note "imza: günlükte bu satır yok (anahtar henüz eklenmemiş ya da servisler yeniden başlamamış olabilir)"
  else
    problem "imza: api ve worker günlüğünde '$public_line' satırı yok; sunucu imzalamıyor olabilir (servisler anahtardan sonra yeniden başlamadı mı?)"
    CHECK_FAILED=true
  fi
}

step_check() {
  if $DRY_RUN; then
    step "9/9" "Son kontrol (kuru çalıştırmada yalnızca şu anki durum gösterilir)"
    wait_tries=1
  else
    step "9/9" "Son kontrol: api ayarları, /health/live, world.pmtiles boyutu, açık anahtar, /map/ 404 başlığı"
    wait_tries=10
  fi
  cid=$(compose ps -q api 2>/dev/null || true)
  if [ -z "$cid" ]; then
    problem "api konteyneri çalışmıyor"
    CHECK_FAILED=true
  else
    note "api konteynerindeki ayarlar (yalnızca MIN_CLIENT_LEVEL, WATCH_PUSH* ve NOTICE_SIGNING_KID):"
    show_env "$cid" | while read -r env_line; do note "  $env_line"; done
  fi
  if notice_has_key || $NOTICE_CHANGED; then check_notice_signing "$wait_tries"; else note "açık anahtar: sunucuda imza anahtarı yok"; fi
  if ! health_check "$wait_tries"; then
    problem "/health/live cevap vermedi"
    CHECK_FAILED=true
  fi
  if [ -f "$WORLD_FILE" ]; then
    note "world.pmtiles: $(size_text "$WORLD_FILE")"
  else
    note "world.pmtiles: yok"
  fi
  if [ -f "$NGINX_SITE" ]; then check_map_cache "$wait_tries"; fi
}

usage() { # message
  say "$1" >&2
  say "Kullanım: sh -s [-- [--dry-run] [--min-level N] [--allow-lower]] < apply-pending.sh   (N: 3 ile 9 arası tam sayı, varsayılan 4)" >&2
  exit 64
}

main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=true ;;
      --allow-lower) ALLOW_LOWER=true ;;
      --check-notice-key) CHECK_EMBED=true ;;
      --min-level)
        if [ "$#" -lt 2 ]; then usage "--min-level bir değer ister."; fi
        WANT_LEVEL=$2
        shift
        ;;
      --min-level=*) WANT_LEVEL=${1#--min-level=} ;;
      *) usage "Bilinmeyen seçenek: $1" ;;
    esac
    shift
  done
  case "$WANT_LEVEL" in
    [3-9]) ;;
    *) usage "--min-level yalnızca 3 ile 9 arası bir tam sayı olabilir (verilen: '$WANT_LEVEL')." ;;
  esac

  if $CHECK_EMBED; then
    # Run from the repo as a file: is the notice-key.sh inside this script the file beside it?
    beside="$(dirname "$0")/notice-key.sh"
    if [ ! -f "$beside" ]; then die "$beside yok; bu seçenek betik bir dosya olarak, depodan çalıştırılınca işler."; fi
    if notice_key_script | cmp -s - "$beside"; then
      say "notice-key.sh kopyası güncel: apply-pending.sh içindeki metin $beside ile aynı."
      return 0
    fi
    die "apply-pending.sh içindeki notice-key.sh kopyası $beside dosyasından FARKLI: kopyayı yenile."
  fi

  # The very first line, in the dry run and the real run alike. The script cannot know which app
  # versions the phones run; whoever runs it must have seen to that.
  say "Önce bütün telefonlara yeni APK'yı (seviye $WANT_LEVEL) kur; bu betik eski sürümleri kapatır."
  say "Bargu staging: bekleyen değişiklikler"
  if $DRY_RUN; then
    say "KURU ÇALIŞTIRMA: ne yapılacağı yazılır, hiçbir şey değiştirilmez (yedek, yazma, indirme, yeniden başlatma yok)."
  fi
  say "Yalnızca $STACK_DIR ve $MAP_ROOT içine yazılır; sunucudaki diğer projeye dokunulmaz."

  preflight
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  STARTED=true

  step_backup
  step_env
  step_compose
  step_notice
  step_validate
  step_perms
  step_world
  step_nginx
  step_restart
  step_check

  printf '\n'
  if $DRY_RUN; then
    say "Kuru çalıştırma bitti, hiçbir şey değiştirilmedi. Gerçek çalıştırma: aynı komut, --dry-run olmadan (ssh bargu-server 'sh -s' < infra/staging/apply-pending.sh)"
    if $MAP_FAILED || $NGINX_FAILED || $NOTICE_FAILED; then exit 1; fi
    return 0
  fi
  if $MAP_FAILED || $NGINX_FAILED || $NOTICE_FAILED || $CHECK_FAILED; then
    die "Bitti ama bir şey eksik kaldı (yukarıdaki SORUN satırlarına bakın). Scripti yeniden çalıştırmak güvenlidir."
  fi
  say "Bitti. Her şey yerinde."
}

main "$@"
