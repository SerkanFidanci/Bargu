# 0003. Staging deployment

- Status: Accepted
- Date: 2026-10-13

## Context

BARGU_PLAN §3.5: one VPS (Hetzner, EU), Docker Compose, Caddy with automatic TLS, staging deploys
from GitHub Actions on `main`. The repository is public. The VPS already exists and **also hosts
another project (rastamen)**, which must not be affected.

## Decision

- **Shared host, additive footprint**: Bargu lives in compose project `bargu-staging` under
  `/opt/bargu/staging`, plus a `deploy` user and `/usr/local/bin/bargu-deploy`
  (`infra/vps/setup-staging.sh`). Server-wide settings (sshd, firewall, Docker daemon) are not
  changed by Bargu tooling; hardening proposals for the host are raised with the owner instead.
- **Stack** (`infra/staging/compose.yml`): only Caddy publishes ports. Postgres and Redis live on an
  `internal` network. Containers drop all capabilities, run with `no-new-privileges`, read-only root
  filesystems where possible, log rotation, digest-pinned images.
- **TLS**: Caddy, TLS 1.3 only, HSTS. No access log (would record IPs and raw URLs).
  `/health/ready` is not exposed publicly.
- **Delivery**: CI builds the image once, pushes to GHCR with SBOM and provenance, then calls the
  server over SSH:
  - the CI key is bound to a **forced command** (`/usr/local/bin/bargu-deploy`, root-owned) that only
    accepts `ghcr.io/<owner>/bargu-api@sha256:<digest>` — CI never gets a shell;
  - the host key is pinned (`STAGING_SSH_KNOWN_HOSTS`), no third-party SSH action;
  - the registry token is the run's short-lived `GITHUB_TOKEN`, piped via stdin into a temporary
    Docker config that is deleted afterwards;
  - `docker compose up --wait` gates on health checks and rolls back to the previous digest on failure.
- The deploy workflow stays inert until `STAGING_ENABLED=true`, so CI is green before the server is
  wired up.

## Consequences

- No long-lived registry credential on the server; no SSH shell for CI.
- The `deploy` user is in the `docker` group (root-equivalent on the host); the forced command limits
  what the CI key can do with it.
- If another service on the host owns ports 80/443, Caddy cannot bind them and ingress must go
  through that proxy (follow-up decision).
- Backups are not configured for staging in Faz 0 (no user data). Encrypted backups with restore tests
  are required before real data (Faz 10).
