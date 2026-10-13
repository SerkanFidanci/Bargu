#!/bin/sh
# Prepares Bargu staging on an EXISTING, SHARED server. Run as root on the server:
#   BARGU_API_DOMAIN=api.example.com sh setup-staging.sh "<deploy public key>"
# Strictly additive and idempotent. It never touches other projects' containers, volumes, networks
# or files. It only creates:
#   - the `deploy` user, whose SSH key may run nothing but /usr/local/bin/bargu-deploy
#   - /usr/local/bin/bargu-deploy (root-owned)
#   - /opt/bargu/staging (compose project `bargu-staging`), with secrets generated on the server
set -eu

deploy_pubkey="${1:-}"
src_dir="$(cd "$(dirname "$0")/../staging" && pwd)"
stack_dir=/opt/bargu/staging

if [ "$(id -u)" -ne 0 ]; then
  echo "setup-staging: run as root" >&2
  exit 1
fi
case "$deploy_pubkey" in
  ssh-ed25519\ *) ;;
  *)
    echo "usage: sh setup-staging.sh \"ssh-ed25519 AAAA... github-actions-deploy\"" >&2
    exit 64
    ;;
esac
if ! docker compose version >/dev/null 2>&1; then
  echo "setup-staging: Docker with the compose plugin is required (not installed by this script)" >&2
  exit 1
fi

# 1. Deploy identity (locked password, forced command, no forwarding/pty).
if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh deploy
fi
passwd --lock deploy >/dev/null
usermod --append --groups docker deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
printf 'restrict,command="/usr/local/bin/bargu-deploy" %s\n' "$deploy_pubkey" \
  > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys

# 2. Deploy entry point, root-owned so the deploy user cannot change it.
install -m 0755 -o root -g root "$src_dir/deploy.sh" /usr/local/bin/bargu-deploy

# 3. Stack directory and compose file.
install -d -m 0750 -o deploy -g deploy /opt/bargu "$stack_dir"
install -m 0640 -o deploy -g deploy "$src_dir/compose.yml" "$stack_dir/compose.yml"

# 4. Secrets: generated here, never transmitted. An existing .env is never overwritten.
if [ ! -f "$stack_dir/.env" ]; then
  umask 077
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" \
      -e "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$(openssl rand -hex 32)/" \
      "$src_dir/.env.example" > "$stack_dir/.env"
  chown deploy:deploy "$stack_dir/.env"
  chmod 0600 "$stack_dir/.env"
  echo "setup-staging: generated $stack_dir/.env"
fi

# 5. Settings added in later phases: appended once, existing values are never changed.
b64key() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
add_setting() {
  if ! grep -q "^$1=." "$stack_dir/.env"; then
    sed -i "/^$1=/d" "$stack_dir/.env"
    printf '%s=%s\n' "$1" "$2" >> "$stack_dir/.env"
    echo "setup-staging: added $1"
  fi
}
add_setting DB_APP_PASSWORD "$(openssl rand -hex 32)"
add_setting JWT_SIGNING_KEY "$(b64key)"
add_setting OTP_KEY "$(b64key)"
add_setting EMAIL_LOOKUP_KEY "$(b64key)"
add_setting JOB_PAYLOAD_KEY "$(b64key)"
domain="${BARGU_API_DOMAIN:-}"
if [ -n "$domain" ]; then
  add_setting WEBAUTHN_RP_ID "$domain"
  add_setting WEBAUTHN_ORIGINS "https://$domain"
fi

echo "setup-staging: done. Nothing outside the paths listed above was changed."
