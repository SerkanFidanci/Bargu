#!/bin/sh
# Applies the changes that are waiting on the Bargu staging server, in one go. The coding session
# may not change the shared server, so the owner runs this from their own terminal (as root on the
# server). First the dry run, which only lists what would happen, then the real run:
#
#   ssh bargu-server 'sh -s -- --dry-run' < infra/staging/apply-pending.sh
#   ssh bargu-server 'sh -s' < infra/staging/apply-pending.sh
#
# What it does (each step is announced in Turkish first, and says "zaten yapılmış" when there is
# nothing left to do; running it twice changes nothing the second time):
#   1. timestamped backup of .env and compose.yml (only when one of them is about to change)
#   2. .env: MIN_CLIENT_LEVEL=3
#   3. compose.yml: the three WATCH_PUSH lines after BILLING_TEST (as in infra/staging/compose.yml)
#   4. owner and modes: deploy:deploy, .env 0600, compose.yml 0640
#   5. world.pmtiles: the low-detail world map (Protomaps build, zoom 0-6) next to turkey.pmtiles
#   6. docker compose up -d --wait worker api (only when they do not run the new settings yet)
#   7. final check: MIN_CLIENT_LEVEL and WATCH_PUSH* inside the api container, /health/live, size
#
# Rules it keeps:
#   - It writes only under /opt/bargu/staging and /srv/bargu-map. Every write goes through guard(),
#     which refuses (stops with a Turkish message) any other path after resolving ".." and symlinks.
#     Nothing of the other project on the server (rastamen) is touched.
#   - It never prints secrets: .env is only edited, never shown; the container check shows nothing
#     but MIN_CLIENT_LEVEL and WATCH_PUSH* lines.
#   - --dry-run changes nothing: no backup, no write, no download, no restart.
#   - If the new files do not pass `docker compose config`, or the services do not come up, the
#     backups are put back.
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

WANT_LEVEL=3
WORLD_MAXZOOM=6
WORLD_FRESH_MINUTES=10080 # 7 days
OWNER=deploy:deploy

DRY_RUN=false
STARTED=false
BACKUP_STAMP=""
NEED_ENV=false
NEED_COMPOSE=false
MAP_FAILED=false
CHECK_FAILED=false

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
# whole script unless the path (with ".." resolved, and the folder it sits in with symlinks
# resolved) lies inside /opt/bargu/staging or /srv/bargu-map. The checked path is left in GUARDED.
guard() {
  if $DRY_RUN; then
    die "İç hata: kuru çalıştırmada yazma isteği geldi, durduruldu: $1"
  fi
  case "$1" in
    /*) ;;
    *) die "Güvenlik: yol / ile başlamıyor, hiçbir şey yazılmadı: $1" ;;
  esac
  normalize "$1"
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

# The lines of a container's environment we may show; every other line is dropped here.
show_env() { # container-id
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" </dev/null |
    grep -E '^(MIN_CLIENT_LEVEL|WATCH_PUSH[A-Z_]*)=' || true
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

world_is_fresh() {
  [ -f "$WORLD_FILE" ] && [ -n "$(find "$WORLD_FILE" -mmin "-$WORLD_FRESH_MINUTES" 2>/dev/null)" ]
}

# Does this service already run with the new settings?
runtime_ok() { # service
  cid=$(compose ps -q "$1" 2>/dev/null || true)
  [ -n "$cid" ] || return 1
  lines=$(show_env "$cid")
  printf '%s\n' "$lines" | grep -qxF "MIN_CLIENT_LEVEL=$WANT_LEVEL" || return 1
  printf '%s\n' "$lines" | grep -q '^WATCH_PUSH=' || return 1
}

# ---- cleaning up ------------------------------------------------------------------------------

cleanup() {
  code=$?
  trap - EXIT
  if $STARTED && ! $DRY_RUN; then
    for leftover in "$ENV_FILE.new.$$" "$COMPOSE_FILE.new.$$" "$WORLD_PART"; do
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

  if env_is_done; then NEED_ENV=false; else NEED_ENV=true; fi
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
  step "1/7" "Yedek: .env ve compose.yml, değişmeden önce tarih damgalı kopya"
  if ! $NEED_ENV && ! $NEED_COMPOSE; then
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
  step "2/7" ".env: MIN_CLIENT_LEVEL=$WANT_LEVEL (daha eski uygulama sürümleri güncelleme ister)"
  if ! $NEED_ENV; then
    note "zaten yapılmış: MIN_CLIENT_LEVEL=$WANT_LEVEL"
    return 0
  fi
  before=$(env_level_now)
  if $DRY_RUN; then
    note "yapılacak: değer şu an '$before', $WANT_LEVEL yapılacak (satır varsa değiştirilir, yoksa eklenir; başka satıra dokunulmaz)"
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
  note "yapıldı: MIN_CLIENT_LEVEL=$WANT_LEVEL (önceki değer: $before)"
}

step_compose() {
  step "3/7" "compose.yml: WATCH_PUSH üç satırı (arka plan canlı modu), BILLING_TEST satırından sonra"
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

step_perms() {
  step "4/7" "Sahip ve izinler: $OWNER; .env 0600; compose.yml 0640"
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
  step "5/7" "Dünya haritası: $WORLD_FILE (düşük ayrıntı, yakınlaştırma 0-$WORLD_MAXZOOM)"
  if world_is_fresh; then
    note "zaten yapılmış: dosya var ve 7 günden yeni ($(size_text "$WORLD_FILE"))"
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

step_restart() {
  step "6/7" "api ve worker yeniden başlatılıyor (yeni ayarları okusunlar)"
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

step_check() {
  if $DRY_RUN; then
    step "7/7" "Son kontrol (kuru çalıştırmada yalnızca şu anki durum gösterilir)"
    wait_tries=1
  else
    step "7/7" "Son kontrol: api ayarları, /health/live, world.pmtiles boyutu"
    wait_tries=10
  fi
  cid=$(compose ps -q api 2>/dev/null || true)
  if [ -z "$cid" ]; then
    problem "api konteyneri çalışmıyor"
    CHECK_FAILED=true
  else
    note "api konteynerindeki ayarlar (yalnızca MIN_CLIENT_LEVEL ve WATCH_PUSH*):"
    show_env "$cid" | while read -r env_line; do note "  $env_line"; done
  fi
  if ! health_check "$wait_tries"; then
    problem "/health/live cevap vermedi"
    CHECK_FAILED=true
  fi
  if [ -f "$WORLD_FILE" ]; then
    note "world.pmtiles: $(size_text "$WORLD_FILE")"
  else
    note "world.pmtiles: yok"
  fi
}

main() {
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=true ;;
      *)
        say "Kullanım: sh -s [-- --dry-run] < apply-pending.sh" >&2
        exit 64
        ;;
    esac
  done

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
  step_validate
  step_perms
  step_world
  step_restart
  step_check

  printf '\n'
  if $DRY_RUN; then
    say "Kuru çalıştırma bitti, hiçbir şey değiştirilmedi. Gerçek çalıştırma: ssh bargu-server 'sh -s' < infra/staging/apply-pending.sh"
    if $MAP_FAILED; then exit 1; fi
    return 0
  fi
  if $MAP_FAILED || $CHECK_FAILED; then
    die "Bitti ama bir şey eksik kaldı (yukarıdaki SORUN satırlarına bakın). Scripti yeniden çalıştırmak güvenlidir."
  fi
  say "Bitti. Her şey yerinde."
}

main "$@"
