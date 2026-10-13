#!/bin/sh
# Publishes the Bargu staging API through the host's EXISTING nginx. Run as root on the server:
#   sh setup-nginx.sh api.example.com [api-host-port]
# Additive: writes only /etc/nginx/sites-available/bargu-staging (+ its sites-enabled link) and a
# Let's Encrypt certificate for that one domain via the host's certbot. Every change is validated
# with `nginx -t` and rolled back if invalid; reloads are graceful (other sites keep serving).
set -eu

domain="${1:-}"
port="${2:-3100}"
template="$(cd "$(dirname "$0")/../staging/nginx" && pwd)/bargu-staging.conf"
site=/etc/nginx/sites-available/bargu-staging
link=/etc/nginx/sites-enabled/bargu-staging

if [ "$(id -u)" -ne 0 ]; then
  echo "setup-nginx: run as root" >&2
  exit 1
fi
if ! printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo "usage: sh setup-nginx.sh <domain> [api-host-port]" >&2
  exit 64
fi
case "$port" in
  *[!0-9]* | '') echo "setup-nginx: invalid port" >&2; exit 64 ;;
esac
if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
  echo "setup-nginx: nginx and certbot must already be installed on the host" >&2
  exit 1
fi

backup="$(mktemp)"
had_site=false
if [ -f "$site" ]; then cp "$site" "$backup" && had_site=true; fi

# Installs $1 as the site, validates the whole nginx config and reloads; restores on failure.
apply_site() {
  install -m 0644 "$1" "$site"
  ln -sf "$site" "$link"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
  else
    echo "setup-nginx: nginx -t failed, restoring the previous state" >&2
    if $had_site; then install -m 0644 "$backup" "$site"; else rm -f "$site" "$link"; fi
    nginx -t && systemctl reload nginx
    exit 1
  fi
}

work="$(mktemp)"
trap 'rm -f "$work" "$backup"' EXIT

# 1. Certificate. An HTTP-only server block lets certbot answer the ACME challenge first.
if [ ! -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]; then
  printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    location / { return 404; }\n}\n' \
    "$domain" > "$work"
  apply_site "$work"
  certbot certonly --nginx --non-interactive --agree-tos --keep-until-expiring \
    --domain "$domain" --deploy-hook "systemctl reload nginx"
fi

# 2. Full site from the template.
sed -e "s/__API_DOMAIN__/$domain/g" -e "s/__API_PORT__/$port/g" "$template" > "$work"
apply_site "$work"
echo "setup-nginx: https://$domain is served by nginx -> 127.0.0.1:$port"
