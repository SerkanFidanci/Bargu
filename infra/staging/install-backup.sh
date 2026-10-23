#!/usr/bin/env bash
# Installs the encrypted backup on the staging server (docs/ADR/0034 §5a, §5b), from the owner's PC:
#   bash infra/staging/install-backup.sh            dry run: says what it would do, changes nothing
#   bash infra/staging/install-backup.sh --apply    does it (after the owner's approval)
#
# Puts on the server: age (apt), /usr/local/bin/bargu-backup, /etc/bargu/backup-recipients (the
# public key from backup-key.sh), /opt/bargu/backups (deploy, 0700), the nightly timer, and
# bargu-deploy with the backup before the migration (the old one is kept as .bak-<time>). Then takes
# one backup. Touches only Bargu paths: no other project, no nginx, no restart of the stack.
# Running it again changes only what differs.
set -euo pipefail

if [ "${1:-}" = --remote ]; then
  # On the server, as root, from the folder the files were unpacked into.
  src="$2"
  apply="${3:-}"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  say() { echo "install-backup: $*"; }
  run() {
    if [ "$apply" = --apply ]; then "$@"; else say "  (kuru) $*"; fi
  }
  # put <src> <dst> <owner> <mode>: installs when missing or different; keeps the old file.
  put() {
    if [ -f "$2" ] && cmp -s "$1" "$2"; then
      say "aynı, dokunulmadı: $2"
      return
    fi
    if [ -f "$2" ]; then
      say "değişecek: $2 (eskisi $2.bak-$stamp)"
      diff -u "$2" "$1" | sed -n '1,60p' | sed 's/^/    /' || true
      run cp -p "$2" "$2.bak-$stamp"
      run chmod a-x "$2.bak-$stamp"
    else
      say "eklenecek: $2"
    fi
    run install -o "${3%:*}" -g "${3#*:}" -m "$4" "$1" "$2"
  }

  [ -d /opt/bargu/staging ] || { say "/opt/bargu/staging yok; bu Bargu sunucusu değil"; exit 1; }
  id deploy >/dev/null 2>&1 || { say "deploy kullanıcısı yok"; exit 1; }
  grep -q '^age1[0-9a-z]\{58\}$' "$src/backup-recipients.txt" || { say "açık anahtar geçersiz"; exit 1; }

  if command -v age >/dev/null; then
    say "age kurulu: $(age --version)"
  else
    say "age kurulacak (apt)"
    run apt-get install -y -q age
  fi
  [ -d /etc/bargu ] || run install -d -o root -g root -m 0755 /etc/bargu
  [ -d /opt/bargu/backups ] || run install -d -o deploy -g deploy -m 0700 /opt/bargu/backups
  put "$src/backup-recipients.txt" /etc/bargu/backup-recipients root:root 0644
  put "$src/backup.sh" /usr/local/bin/bargu-backup root:root 0755
  put "$src/deploy.sh" /usr/local/bin/bargu-deploy root:root 0755
  put "$src/systemd/bargu-backup.service" /etc/systemd/system/bargu-backup.service root:root 0644
  put "$src/systemd/bargu-backup.timer" /etc/systemd/system/bargu-backup.timer root:root 0644
  run systemctl daemon-reload
  run systemctl enable --now bargu-backup.timer

  if [ "$apply" = --apply ]; then
    say "ilk yedek alınıyor"
    runuser -u deploy -- /usr/local/bin/bargu-backup manual
    systemctl list-timers bargu-backup.timer --no-pager | sed -n '1,2p'
    say "bitti"
  else
    say "kuru çalıştırma bitti, hiçbir şey değişmedi"
  fi
  exit 0
fi

# On the owner's PC: send the files and this script, run it there, clean up.
here="$(cd "$(dirname "$0")" && pwd)"
server="${BARGU_SERVER:-bargu-server}"
apply="${1:-}"
[ -z "$apply" ] || [ "$apply" = --apply ] || { echo "kullanım: install-backup.sh [--apply]" >&2; exit 64; }
[ -s "$here/backup-recipients.txt" ] || { echo "install-backup: önce bash infra/staging/backup-key.sh" >&2; exit 1; }

tar -C "$here" -cf - install-backup.sh backup.sh deploy.sh backup-recipients.txt \
  systemd/bargu-backup.service systemd/bargu-backup.timer |
  ssh -o BatchMode=yes "$server" "set -e; d=\$(mktemp -d); trap 'rm -rf \"\$d\"' EXIT; tar -xf - -C \"\$d\"; bash \"\$d/install-backup.sh\" --remote \"\$d\" $apply"
