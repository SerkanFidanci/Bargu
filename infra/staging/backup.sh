#!/bin/bash
# Encrypted database backup of the staging stack (docs/ADR/0034 §5a). Installed root-owned (0755) at
# /usr/local/bin/bargu-backup by infra/staging/install-backup.sh. Runs as the deploy user:
#   bargu-backup nightly      the systemd timer bargu-backup.timer, every night at 03:30
#   bargu-backup pre-deploy   bargu-deploy, before every migration; a failure stops the deploy
#   bargu-backup manual       by hand
#
# pg_dump (custom format) inside the stack's postgres container, piped straight into age with the
# owner's public key: the server never holds a plain dump and cannot read its own backups. The
# private key is not on the server or in the repo (restore-check.sh uses it on the owner's PC).
#
# Keeps the newest 14 nightly, 10 pre-deploy and 5 manual backups. When /etc/bargu/backup-offsite.conf
# exists, a nightly run then copies the folder off the server with rsync over ssh (no --delete:
# the target keeps what it has; its key is limited there to write-only, e.g. rrsync -wo).
# Prints file names and sizes only: no row, no secret.
set -euo pipefail
umask 077

BACKUP_DIR="${BARGU_BACKUP_DIR:-/opt/bargu/backups}"
RECIPIENTS="${BARGU_BACKUP_RECIPIENTS:-/etc/bargu/backup-recipients}"
OFFSITE_CONF="${BARGU_BACKUP_OFFSITE:-/etc/bargu/backup-offsite.conf}"
PROJECT="${BARGU_BACKUP_PROJECT:-bargu-staging}"
# Less than this after encryption is not a database (an empty one is ~30 KB): a broken dump.
MIN_BYTES=4096

reason="${1:-}"
case "$reason" in
  nightly) keep=14 ;;
  pre-deploy) keep=10 ;;
  manual) keep=5 ;;
  *)
    echo "kullanım: bargu-backup nightly|pre-deploy|manual" >&2
    exit 64
    ;;
esac

fail() {
  echo "bargu-backup: $*" >&2
  exit 1
}

[ -s "$RECIPIENTS" ] || fail "açık anahtar yok ($RECIPIENTS); yedek alınmadı"
command -v age >/dev/null || fail "age kurulu değil; yedek alınmadı"
[ -d "$BACKUP_DIR" ] || fail "yedek klasörü yok ($BACKUP_DIR)"

# One backup at a time: a deploy during the nightly run waits for it.
exec 9>"$BACKUP_DIR/.lock"
flock -w 600 9 || fail "başka bir yedek 10 dakikadır sürüyor; bu yedek alınmadı"

container="$(docker ps -q \
  --filter "label=com.docker.compose.project=$PROJECT" \
  --filter "label=com.docker.compose.service=postgres")"
[ -n "$container" ] || fail "$PROJECT içinde çalışan bir postgres yok; yedek alınmadı"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="bargu-$stamp-$reason.dump.age"
partial="$BACKUP_DIR/.$name.partial"
[ ! -e "$BACKUP_DIR/$name" ] || fail "$name zaten var (aynı saniyede ikinci yedek); bu yedek alınmadı"
trap 'rm -f "$partial"' EXIT

# The variables are the container's own (single quotes): the password never passes through here.
# shellcheck disable=SC2016
if ! docker exec "$container" sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' |
  age --encrypt --recipients-file "$RECIPIENTS" > "$partial"; then
  fail "pg_dump ya da şifreleme başarısız; yedek alınmadı"
fi
bytes="$(stat -c %s "$partial")"
[ "$bytes" -ge "$MIN_BYTES" ] || fail "yedek çok küçük ($bytes bayt); saklanmadı"
mv "$partial" "$BACKUP_DIR/$name"
trap - EXIT
echo "bargu-backup: $name ($((bytes / 1024)) KB)"

# Retention per reason; names sort by time.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "bargu-*-$reason.dump.age" -printf '%f\n' |
  sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  rm -f "$BACKUP_DIR/$old"
done

if [ "$reason" = nightly ] && [ -f "$OFFSITE_CONF" ]; then
  # OFFSITE_TARGET=user@host:path, OFFSITE_KEY=/etc/bargu/backup-offsite-key (0600, deploy) and the
  # target's host key in /etc/bargu/backup-offsite-known-hosts.
  # shellcheck source=/dev/null
  . "$OFFSITE_CONF"
  [ -n "${OFFSITE_TARGET:-}" ] && [ -n "${OFFSITE_KEY:-}" ] || fail "$OFFSITE_CONF eksik; sunucu dışı kopya yok"
  if rsync -a --ignore-existing --include='bargu-*.dump.age' --exclude='*' \
    -e "ssh -i $OFFSITE_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/bargu/backup-offsite-known-hosts" \
    "$BACKUP_DIR/" "$OFFSITE_TARGET/"; then
    echo "bargu-backup: sunucu dışı kopya güncel"
  else
    fail "sunucu dışı kopya gönderilemedi (yedek sunucuda duruyor)"
  fi
fi
