# 0003. Staging deployment

- Status: Accepted
- Date: 2026-10-13

## Context

BARGU_PLAN §3.5: one VPS (Hetzner, EU), Docker Compose, automatic TLS, staging deploys from GitHub
Actions on `main`. The repository is public. The VPS already exists and **also hosts another
project**, whose host nginx (with certbot) owns ports 80/443. There is no Bargu domain yet.

## Decision

- **Shared host, additive footprint**: Bargu lives in compose project `bargu-staging` under
  `/opt/bargu/staging`, plus a `deploy` user, `/usr/local/bin/bargu-deploy` and one nginx site
  (`infra/vps/setup-staging.sh`, `infra/vps/setup-nginx.sh`). Nothing of the other project is
  modified. Host-wide hardening (key-only SSH, fail2ban) was applied with the owner's approval
  because it protects both projects.
- **Ingress**: the host nginx terminates TLS for Bargu's own server name (TLS 1.3, HSTS, no access
  log, `/health/ready` hidden) and proxies to the API on `127.0.0.1:3100`. Certificates come from the
  host's certbot (Let's Encrypt). The earlier plan of a Bargu-owned Caddy was dropped: it cannot
  share 80/443 with the existing nginx.
- **Domain**: `api.<ip-with-dashes>.sslip.io` until a real domain is bought — free, no account,
  resolves to the server IP. A real domain is required before passkeys / universal links (Faz 2).
- **Stack**: only the API publishes a port (loopback). Postgres and Redis live on an `internal`
  network. Containers drop all capabilities, run with `no-new-privileges`, read-only root
  filesystems where possible, memory limits, log rotation, digest-pinned images. The ingress network
  has a fixed subnet so `TRUST_PROXY` names exactly the Docker gateway nginx connects through.
- **Delivery**: CI builds the image once (pruned with `turbo prune`), pushes to GHCR with SBOM and
  provenance, then calls the server over SSH:
  - the CI key is bound to a **forced command** (`/usr/local/bin/bargu-deploy`, root-owned) that only
    accepts `ghcr.io/<owner>/bargu-api@sha256:<digest>` — CI never gets a shell;
  - the host key is pinned (`STAGING_SSH_KNOWN_HOSTS`), no third-party SSH action;
  - the registry token is the run's short-lived `GITHUB_TOKEN`, piped via stdin into a temporary
    Docker config that is deleted afterwards;
  - `docker compose up --wait` gates on health checks and rolls back to the previous digest on failure.
- Deploys run as a reusable workflow called by CI after all checks pass on a push to `main` (no
  `workflow_run`), and stay inert until `STAGING_ENABLED=true`.

## Consequences

- No long-lived registry credential on the server; no SSH shell for CI.
- The `deploy` user is in the `docker` group (root-equivalent on the host); the forced command limits
  what the CI key can do with it.
- sslip.io is not on the Public Suffix List, so Let's Encrypt's per-domain rate limit is shared with
  all sslip.io users; renewals may occasionally need a retry. Moving to a real domain removes this.
- Backups are not configured for staging in Faz 0 (no user data). Encrypted backups with restore tests
  are required before real data (Faz 10).
