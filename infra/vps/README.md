# Staging server runbook

Staging runs on an **existing server that also hosts another project**. Ground rule: Bargu changes
are additive and confined to its own paths; nothing belonging to the other project is modified.

- **Ingress**: the host's nginx (already serving the other project on 80/443) gets one extra site,
  `bargu-staging`, with its own Let's Encrypt certificate from the host's certbot.
- **Stack**: `infra/staging/compose.yml` (compose project `bargu-staging`) — API published on
  `127.0.0.1:3100` only; Postgres and Redis on an internal network.
- **Delivery**: GitHub Actions builds the API image, pushes it to GHCR and rolls it out over SSH
  (forced command, health-gated, automatic rollback).
- **Domain**: until a real domain exists, `api.<ip-with-dashes>.sslip.io` (free wildcard DNS that
  resolves to the embedded IP). Passkeys and universal links will need a real domain (Faz 2).

Decision record: [ADR 0003](../../docs/ADR/0003-staging-deployment.md).

## Host baseline (applied 2026-10-13)

- SSH: key-only (`/etc/ssh/sshd_config.d/00-hardening.conf`: no passwords, root by key only).
- fail2ban: `sshd` jail (`/etc/fail2ban/jail.local`, journal match fixed for Ubuntu 24.04's
  `ssh.service`).
- Already present: ufw (22/80/443), unattended upgrades, nginx + certbot.

## 1. Install the stack (additive)

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f bargu-deploy   # CI-only key pair
scp -r infra bargu-server:/tmp/bargu-infra
ssh bargu-server 'sh /tmp/bargu-infra/vps/setup-staging.sh "$(cat)"' < bargu-deploy.pub
```

[`setup-staging.sh`](setup-staging.sh) creates only the `deploy` user (key restricted to a forced
command), `/usr/local/bin/bargu-deploy` (root-owned) and `/opt/bargu/staging` with secrets generated
on the server. Re-running it is safe and never overwrites `.env`.

## 2. Publish through nginx

```bash
ssh bargu-server 'sh /tmp/bargu-infra/vps/setup-nginx.sh api.<ip-with-dashes>.sslip.io 3100'
```

[`setup-nginx.sh`](setup-nginx.sh) writes `/etc/nginx/sites-available/bargu-staging`, obtains the
certificate (`certbot certonly --nginx`, renewal reloads nginx) and validates with `nginx -t`
before every graceful reload; an invalid config is rolled back.

## 3. Connect GitHub

Repository → Settings → Environments → **staging** (deployment branch: `main`; a required reviewer
is recommended):

| Kind     | Name                      | Value                                           |
| -------- | ------------------------- | ----------------------------------------------- |
| Secret   | `STAGING_SSH_KEY`         | private `bargu-deploy` key                      |
| Variable | `STAGING_SSH_HOST`        | server IP                                       |
| Variable | `STAGING_SSH_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <server-ip>` (verified) |
| Variable | `STAGING_API_DOMAIN`      | the domain from step 2                          |

Then repository variable `STAGING_ENABLED` = `true`, and delete the local private key file.
Verify the host key fingerprint against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the
server before storing it.

## 4. Deploy

Every green CI run on `main` deploys; Actions → **Deploy staging** → _Run workflow_ deploys on demand.
The deploy script pulls the exact image digest, waits for health checks and rolls back to the
previous digest if the new release does not become healthy.

Check: `curl https://<domain>/health/live` → `{"status":"ok"}`.

## Operations

```bash
ssh bargu-server
cd /opt/bargu/staging
docker compose --env-file .env --env-file image.env ps
docker compose --env-file .env --env-file image.env logs -f api
curl -s http://127.0.0.1:3100/health/ready   # readiness is only reachable on the host
```

- Postgres and Redis publish no ports and sit on an internal network.
- Backups: not configured yet (no user data in Faz 0). Encrypted backups with a restore test are
  required before real user data (Faz 10).
