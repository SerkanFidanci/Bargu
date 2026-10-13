#!/bin/sh
# Prepares Bargu staging on an EXISTING, SHARED server. Run as root on the server:
#   sh setup-staging.sh "<deploy public key>"
# Strictly additive and idempotent. It never touches sshd, the firewall, the Docker daemon config or
# containers/volumes/networks of other projects. It only creates:
#   - the `deploy` user, whose SSH key may run nothing but /usr/local/bin/bargu-deploy
#   - /usr/local/bin/bargu-deploy (root-owned)
#   - /opt/bargu/staging (compose project `bargu-staging`)
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

# 1. Deploy identity (no password, forced command, no forwarding/pty).
if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh deploy
  passwd --lock deploy >/dev/null
fi
usermod --append --groups docker deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
printf 'restrict,command="/usr/local/bin/bargu-deploy" %s\n' "$deploy_pubkey" \
  > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys

# 2. Deploy entry point, root-owned so the deploy user cannot change it.
install -m 0755 -o root -g root "$src_dir/deploy.sh" /usr/local/bin/bargu-deploy

# 3. Stack directory. Existing .env (secrets) is never overwritten.
install -d -m 0750 -o deploy -g deploy /opt/bargu "$stack_dir" "$stack_dir/caddy"
install -m 0640 -o deploy -g deploy "$src_dir/compose.yml" "$stack_dir/compose.yml"
install -m 0640 -o deploy -g deploy "$src_dir/caddy/Caddyfile" "$stack_dir/caddy/Caddyfile"
if [ ! -f "$stack_dir/.env" ]; then
  install -m 0600 -o deploy -g deploy "$src_dir/.env.example" "$stack_dir/.env"
  echo "setup-staging: created $stack_dir/.env from the template; fill in the secrets."
fi

echo "setup-staging: done. Nothing outside the paths listed above was changed."
