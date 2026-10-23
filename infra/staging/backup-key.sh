#!/usr/bin/env bash
# Makes the backup key pair once, on the owner's PC with Docker (docs/ADR/0034 §5a):
#   bash infra/staging/backup-key.sh
# The private key goes to BARGU_BACKUP_KEY (default ~/.bargu/backup-age-key.txt) and is never
# printed: keep a copy in the password manager and one more place; without it no backup can be
# read. The public key goes to infra/staging/backup-recipients.txt (in the repo; it can only
# encrypt), which install-backup.sh puts on the server.
set -euo pipefail
export MSYS_NO_PATHCONV=1

here="$(cd "$(dirname "$0")" && pwd)"
key="${BARGU_BACKUP_KEY:-$HOME/.bargu/backup-age-key.txt}"
public="$here/backup-recipients.txt"
# The server's postgres image (pinned), which is Alpine and can add age; no other image is pulled.
image="$(grep -m1 -oE 'postgres:[^ ]+@sha256:[a-f0-9]{64}' "$here/compose.yml")"

if [ -e "$key" ]; then
  echo "backup-key: $key zaten var; üzerine yazılmadı (eski yedekler onunla açılır)" >&2
  exit 1
fi
mkdir -p "$(dirname "$key")"
chmod 700 "$(dirname "$key")"

age() {
  docker run --rm -i --entrypoint sh "$image" -c 'apk add --quiet --no-cache age >/dev/null && exec "$@"' sh "$@"
}

(umask 077 && age age-keygen 2>/dev/null > "$key")
grep -q '^AGE-SECRET-KEY-1' "$key" || { rm -f "$key"; echo "backup-key: anahtar üretilemedi" >&2; exit 1; }
age age-keygen -y < "$key" > "$public"
grep -q '^age1' "$public" || { echo "backup-key: açık anahtar çıkarılamadı" >&2; exit 1; }
echo "backup-key: gizli anahtar $key içinde (parola yöneticisine ve bir yere daha kopyala)"
echo "backup-key: açık anahtar $public: $(cat "$public")"
