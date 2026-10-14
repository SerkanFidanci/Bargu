#!/bin/sh
# Points staging login emails at a Gmail account, or back to the internal Mailpit (docs/ADR/0006).
# Installed root-owned (0755) at /usr/local/bin/bargu-set-mail. Run it yourself, in a terminal:
#
#   ssh -t bargu-server bargu-set-mail          # asks for the Gmail address and its app password
#   ssh -t bargu-server bargu-set-mail mailpit  # back to Mailpit
#
# The app password is typed here (hidden), checked against Gmail, and written only to the stack's
# .env (0600). It never passes through a command line, a log or anyone else's hands.
set -eu
umask 077

STACK_DIR=/opt/bargu/staging
ENV_FILE="$STACK_DIR/.env"
cd "$STACK_DIR"

compose() {
  docker compose --env-file .env --env-file image.env "$@"
}

backup="$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_FILE" "$backup"

# The deploy user runs compose with this file: it must stay theirs and private after every edit.
keep_owner() {
  chown deploy:deploy "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

restore() {
  cp -p "$backup" "$ENV_FILE"
  keep_owner
  rm -f "$backup"
  echo "set-mail: önceki ayar geri yüklendi" >&2
}

if [ "${1:-}" = mailpit ]; then
  sed -i '/^SMTP_URL=/d; /^MAIL_FROM=/d' "$ENV_FILE"
  keep_owner
  compose up -d --wait worker api >/dev/null
  echo "set-mail: giriş kodları yine Mailpit'e gidiyor"
  exit 0
fi

printf 'Gmail adresi: '
read -r address
address=$(printf '%s' "$address" | tr -d ' ' | tr 'A-Z' 'a-z')
if ! printf '%s' "$address" | grep -Eq '^[a-z0-9._+-]+@(gmail|googlemail)\.com$'; then
  echo "set-mail: bir Gmail adresi gir (ornek@gmail.com)" >&2
  exit 64
fi

printf 'Uygulama şifresi (16 harf; yazarken görünmez): '
stty -echo
trap 'stty echo' EXIT
read -r password
stty echo
trap - EXIT
echo
password=$(printf '%s' "$password" | tr -d ' ')
if ! printf '%s' "$password" | grep -Eq '^[A-Za-z]{16}$'; then
  echo "set-mail: uygulama şifresi boşluksuz 16 harf olmalı (Google hesabı > Uygulama şifreleri)" >&2
  exit 65
fi

# The address is the SMTP user name: '@' and '+' must be escaped inside the URL.
user=$(printf '%s' "$address" | sed 's/%/%25/g; s/@/%40/g; s/+/%2B/g')
sed -i '/^SMTP_URL=/d; /^MAIL_FROM=/d' "$ENV_FILE"
# Port 587 with STARTTLS (required by the mailer whenever there is a password): the host blocks
# outgoing 465 and 25 (Hetzner default).
printf 'SMTP_URL=smtp://%s:%s@smtp.gmail.com:587\n' "$user" "$password" >> "$ENV_FILE"
printf 'MAIL_FROM="Bargu <%s>"\n' "$address" >> "$ENV_FILE"
keep_owner
unset password

# Log in to Gmail and send one test message to the same address before switching anything over.
check='
const nodemailer = require("nodemailer");
const to = process.env.MAIL_FROM.replace(/^.*<|>$/g, "");
const transport = nodemailer.createTransport({ url: process.env.SMTP_URL, requireTLS: true });
transport
  .sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: "Bargu: e-posta ayarı tamam",
    text: "Bargu giriş kodları artık bu adresten gönderilecek. Bu bir deneme mesajıdır.",
  })
  .then(
    () => { console.log("set-mail: Gmail girişi tamam, deneme e-postası gönderildi"); process.exit(0); },
    (e) => { console.error("set-mail: Gmail kabul etmedi (" + (e.code ?? "") + " " + (e.responseCode ?? "") + ")"); process.exit(1); },
  );
'
if ! compose run --rm --no-deps --entrypoint /nodejs/bin/node worker -e "$check"; then
  restore
  echo "set-mail: adresi ve uygulama şifresini kontrol edip tekrar dene" >&2
  exit 1
fi

compose up -d --wait worker api >/dev/null
echo "set-mail: giriş kodları artık $address adresinden gidiyor"
