#!/usr/bin/env bash
# Restore check of a staging backup (docs/ADR/0034 §5a, Faz 10 DoD), on the owner's PC with Docker:
#   bash infra/staging/restore-check.sh                      the newest backup on the server
#   bash infra/staging/restore-check.sh <file.dump.age>      a backup already on this PC
#
# Decrypts it with the private key (BARGU_BACKUP_KEY, default ~/.bargu/backup-age-key.txt, made by
# backup-key.sh) inside a throwaway Postgres of the same image as the server, restores it, and
# compares the applied migrations with the repo. Prints table names and row counts only, never a
# row; the key and the plain dump exist only inside the container, which is removed at the end.
set -euo pipefail
export MSYS_NO_PATHCONV=1

here="$(cd "$(dirname "$0")" && pwd)"
key="${BARGU_BACKUP_KEY:-$HOME/.bargu/backup-age-key.txt}"
server="${BARGU_SERVER:-bargu-server}"

fail() {
  echo "restore-check: $*" >&2
  exit 1
}

[ -s "$key" ] || fail "gizli anahtar yok ($key)"
image="$(grep -m1 -oE 'postgres:[^ ]+@sha256:[a-f0-9]{64}' "$here/compose.yml")" ||
  fail "compose.yml'de postgres imajı bulunamadı"

work="$(mktemp -d)"
container="bargu-restore-check-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

file="${1:-}"
if [ -z "$file" ]; then
  name="$(ssh -o BatchMode=yes "$server" \
    'ls -1 /opt/bargu/backups 2>/dev/null | grep -E "^bargu-[0-9TZ]+-[a-z-]+\.dump\.age$" | sort | tail -1')"
  [ -n "$name" ] || fail "sunucuda yedek yok"
  file="$work/$name"
  ssh -o BatchMode=yes "$server" "cat /opt/bargu/backups/$name" > "$file"
fi
[ -s "$file" ] || fail "yedek dosyası yok ya da boş ($file)"
echo "restore-check: $(basename "$file") ($(($(wc -c < "$file") / 1024)) KB)"

# No published port; the trust login never leaves the container.
docker run -d --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore \
  "$image" >/dev/null
docker exec "$container" apk add --quiet --no-cache age >/dev/null || fail "age kurulamadı"
# The image's first start runs a temporary server on the socket only; TCP means the real one.
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres && break
  sleep 1
done
docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres || fail "geçici Postgres açılmadı"

docker exec -i "$container" sh -c 'umask 077 && cat > /tmp/key' < "$key"
docker exec -i "$container" sh -c 'cat > /tmp/backup.age' < "$file"
docker exec "$container" sh -c \
  'age --decrypt --identity /tmp/key --output /tmp/backup.dump /tmp/backup.age; s=$?; rm -f /tmp/key; exit $s' ||
  fail "yedek çözülemedi (anahtar bu yedeğin anahtarı mı?)"

psql() {
  docker exec -i "$container" psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d restore "$@"
}

# The roles the dump owns things with or grants to (the server's admin role among them) exist
# before the restore, so ownership and privileges come back as they were.
roles="$(docker exec "$container" sh -c "pg_restore --list /tmp/backup.dump | awk '!/^;/ && NF { print \$NF }'" |
  grep -E '^[a-z_][a-z0-9_]*$' | sort -u || true)"
for role in $roles bargu_app; do
  case "$role" in pg_*) continue ;; esac
  psql -c "DO \$\$ BEGIN CREATE ROLE $role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$"
done

# Error lines only: a failing COPY's context line could quote a row.
if ! docker exec "$container" pg_restore -U postgres -d restore --exit-on-error --single-transaction \
  /tmp/backup.dump > "$work/restore.log" 2>&1; then
  grep -E '^pg_restore: (error|detail)' "$work/restore.log" | cut -c1-200 | head -5 >&2
  fail "geri yükleme başarısız"
fi

applied="$(psql -c 'SELECT count(*) FROM app.schema_migrations')"
last="$(psql -c 'SELECT max(name) FROM app.schema_migrations')"
repo="$(find "$here/../../apps/api/migrations" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' | wc -l | tr -d ' ')"
[ "$applied" -gt 0 ] || fail "yedekte uygulanmış migration yok"

echo "restore-check: tablolar ve satır sayıları"
psql -F ' ' <<'SQL' | sed 's/^/  /'
SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname IN ('app', 'pgboss') ORDER BY schemaname, tablename
\gexec
SQL

echo "restore-check: yedekte $applied migration (son: $last), depoda $repo"
if [ "$applied" -lt "$repo" ]; then
  echo "restore-check: depodaki $((repo - applied)) migration bu yedekten sonra (henüz dağıtılmamış olabilir)"
fi
echo "restore-check: başarılı, yedek geri yüklenebiliyor"
