# Staging server runbook

Staging runs on an **existing server that also hosts another project**. Ground rule:
Bargu changes are additive and confined to its own paths. Nothing server-wide (sshd, firewall,
Docker daemon, other containers/networks/volumes) is modified without an explicit decision.

Stack: `infra/staging/compose.yml` (compose project `bargu-staging`): Caddy (automatic TLS) → API →
Postgres + Redis. GitHub Actions builds the API image, pushes it to GHCR and rolls it out over SSH.
Decision record: [ADR 0003](../../docs/ADR/0003-staging-deployment.md).

## Prerequisites

- DNS: `A` record `api.<domain>` → `<server-ip>`.
- Ports 80/443: Caddy in this stack binds them. If another service on the host already owns 80/443,
  Bargu must be routed through that proxy instead — decide before step 2.
- A CI-only deploy key pair (no passphrase), created locally:
  `ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f bargu-deploy`

## 1. Inspect (read-only)

```bash
ssh bargu-server 'docker ps --format "{{.Names}}\t{{.Ports}}"; ss -tlnp; docker network ls'
```

## 2. Install (additive)

```bash
scp -r infra bargu-server:/tmp/bargu-infra
ssh bargu-server 'sh /tmp/bargu-infra/vps/setup-staging.sh "$(cat)"' < bargu-deploy.pub
ssh bargu-server
  openssl rand -hex 32                 # twice: POSTGRES_PASSWORD, REDIS_PASSWORD
  nano /opt/bargu/staging/.env         # API_DOMAIN, ACME_EMAIL, both passwords
  rm -rf /tmp/bargu-infra
```

[`setup-staging.sh`](setup-staging.sh) creates only: the `deploy` user (key restricted to a forced
command), `/usr/local/bin/bargu-deploy` (root-owned) and `/opt/bargu/staging`. Re-running it is safe
and never overwrites `.env`.

## 3. Pin the host key

```bash
ssh-keyscan -t ed25519 <server-ip>
```

Compare its fingerprint (`| ssh-keygen -lf -`) with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
run on the server. Keep the `ssh-keyscan` line for step 4.

## 4. Connect GitHub

Repository → Settings → Environments → **staging** (deployment branch: `main`; a required reviewer
is recommended):

| Kind     | Name                      | Value                       |
| -------- | ------------------------- | --------------------------- |
| Secret   | `STAGING_SSH_KEY`         | private `bargu-deploy` key  |
| Variable | `STAGING_SSH_HOST`        | `<server-ip>`               |
| Variable | `STAGING_SSH_KNOWN_HOSTS` | verified `ssh-keyscan` line |
| Variable | `STAGING_API_DOMAIN`      | e.g. `api.bargu.app`        |

Then repository variable `STAGING_ENABLED` = `true`, and delete the local private key file.

## 5. Deploy

Every green CI run on `main` deploys; Actions → **Deploy staging** → _Run workflow_ deploys on demand.
The deploy script pulls the exact image digest, waits for health checks and rolls back to the
previous digest if the new release does not become healthy.

Check: `curl https://api.<domain>/health/live` → `{"status":"ok"}`.

## Operations

```bash
cd /opt/bargu/staging
docker compose --env-file .env --env-file image.env ps
docker compose --env-file .env --env-file image.env logs -f api
```

- `/health/ready` answers only on the host; Caddy returns 404 for it publicly.
- Postgres and Redis publish no ports and sit on an internal network.
- Backups: not configured yet (no user data in Faz 0). Encrypted backups with a restore test are
  required before real user data (Faz 10).
