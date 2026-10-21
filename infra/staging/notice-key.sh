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
