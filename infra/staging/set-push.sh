#!/bin/sh
# Turns staging push notifications on with a Firebase service account key (docs/ADR/0010), or off.
# Installed root-owned (0755) at /usr/local/bin/bargu-set-push. Run it yourself, in a terminal:
#
#   scp <downloaded-key>.json bargu-server:/root/fcm-key.json
#   ssh -t bargu-server bargu-set-push /root/fcm-key.json   # checks the key with Google, then on
#   ssh -t bargu-server bargu-set-push off                  # push off again
#
# The key is checked against Google before anything switches, then stored only in the stack's .env
# (0600) and the uploaded file is deleted. It never passes through a command line or a log.
set -eu
umask 077

STACK_DIR=/opt/bargu/staging
ENV_FILE="$STACK_DIR/.env"
cd "$STACK_DIR"

compose() {
  docker compose --env-file .env --env-file image.env "$@"
}

# The deploy user runs compose with this file: it must stay theirs and private after every edit.
keep_owner() {
  chown deploy:deploy "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

backup="$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_FILE" "$backup"

restore() {
  cp -p "$backup" "$ENV_FILE"
  keep_owner
  rm -f "$backup"
  echo "set-push: önceki ayar geri yüklendi" >&2
}

if [ "${1:-}" = off ]; then
  sed -i '/^FCM_SERVICE_ACCOUNT=/d' "$ENV_FILE"
  keep_owner
  compose up -d --wait worker api >/dev/null
  echo "set-push: bildirimler kapalı"
  exit 0
fi

key_file="${1:-}"
if [ -z "$key_file" ] || [ ! -f "$key_file" ]; then
  echo "kullanım: bargu-set-push /root/fcm-key.json   (önce scp ile sunucuya kopyala)" >&2
  rm -f "$backup"
  exit 64
fi

sed -i '/^FCM_SERVICE_ACCOUNT=/d' "$ENV_FILE"
printf 'FCM_SERVICE_ACCOUNT=%s\n' "$(base64 -w0 "$key_file")" >> "$ENV_FILE"
keep_owner

# Ask Google for a messaging token with this key before switching anything over.
check='
import { importPKCS8, SignJWT } from "jose";
const fail = (why) => { console.error("set-push: " + why); process.exit(1); };
let account;
try {
  account = JSON.parse(Buffer.from(process.env.FCM_SERVICE_ACCOUNT, "base64").toString("utf8"));
} catch {
  fail("dosya bir JSON anahtarı değil");
}
if (!account.project_id || !account.client_email || !String(account.private_key).includes("PRIVATE KEY")) {
  fail("bu bir Firebase hizmet hesabı anahtarı değil (project_id, client_email, private_key gerekli)");
}
const now = Math.floor(Date.now() / 1000);
const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
  .setProtectedHeader({ alg: "RS256", typ: "JWT" })
  .setIssuer(account.client_email)
  .setAudience("https://oauth2.googleapis.com/token")
  .setIssuedAt(now)
  .setExpirationTime(now + 600)
  .sign(await importPKCS8(account.private_key, "RS256"));
const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
});
if (!response.ok) fail("Google anahtarı kabul etmedi (" + response.status + ")");
console.log("set-push: Google anahtarı kabul etti (proje: " + account.project_id + ")");
'
if ! compose run --rm --no-deps --entrypoint /nodejs/bin/node worker --input-type=module -e "$check"; then
  restore
  exit 1
fi

rm -f "$key_file"
compose up -d --wait worker api >/dev/null
echo "set-push: bildirimler açık; yüklenen anahtar dosyası silindi"
