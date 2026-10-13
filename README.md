# Bargu

Live location sharing with friends and family — **Zenly feel, Signal security**. Locations are
end-to-end encrypted; the server never sees plain coordinates.

- Plan and phases: [BARGU_PLAN.md](BARGU_PLAN.md) · Rules for contributors and agents: [CLAUDE.md](CLAUDE.md)
- Decisions: [docs/ADR](docs/ADR/README.md) · Staging server: [infra/vps/README.md](infra/vps/README.md)

## Layout

```
apps/
  api/        NestJS 12 (Fastify, ESM) — Postgres (pg), Redis (node-redis)
  mobile/     Expo SDK 57, Expo Router, dev client
packages/
  config/     Shared ESLint, TypeScript and Prettier config
infra/
  docker-compose.yml   Local Postgres, Redis, Mailpit
  staging/             Staging stack (Caddy, API, Postgres, Redis) + deploy script
  vps/                 Staging server runbook
docs/ADR/
```

## Prerequisites

- **pnpm 12**: `npm install --global pnpm@12.11.2`. Node is not needed globally for the project:
  pnpm installs Node 24.21.0 (`devEngines.runtime`) and uses it for every script.
- **Docker** (Desktop) for local Postgres/Redis/Mailpit.
- **gitleaks** for the pre-commit secret scan: `winget install --id Gitleaks.Gitleaks`
  (macOS/Linux: `brew install gitleaks`).

## First run

```bash
pnpm install
cp infra/.env.example infra/.env
cp apps/api/.env.example apps/api/.env
pnpm infra:up      # Postgres + Redis + Mailpit, waits until healthy
pnpm dev           # API on :3000 and Metro on :8081
```

- API: `http://localhost:3000/health/live`, `http://localhost:3000/health/ready`
- Mailpit: `http://localhost:8025` (port configurable in `infra/.env`)
- Mobile: see [apps/mobile/README.md](apps/mobile/README.md) for building the dev client.

## Scripts

| Command                                                     | What it does                                           |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                                  | API (watch, SWC + type check) and Metro, via Turborepo |
| `pnpm dev:api` / `pnpm dev:mobile`                          | One app; `dev:mobile` keeps Expo's keyboard shortcuts  |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` | Across the workspace (cached by Turborepo)             |
| `pnpm format` / `pnpm format:check`                         | Prettier                                               |
| `pnpm infra:up` / `infra:down` / `infra:logs`               | Local dependencies                                     |

## Quality and security gates

- **Pre-commit**: gitleaks on staged changes, then ESLint + Prettier on staged files.
- **CI** (`.github/workflows/ci.yml`): frozen-lockfile install, format, typecheck, lint, test,
  build, `pnpm audit --audit-level high`.
- **Security** (`security.yml`): gitleaks (full history), Semgrep, CodeQL (TypeScript + Actions);
  weekly as well.
- **Dependencies**: Renovate (digest-pinned actions and images, 3-day release age); pnpm refuses
  releases younger than 24 h and runs install scripts only for allow-listed packages.
- **Staging deploy** (`deploy-staging.yml`): image to GHCR, SSH forced-command rollout with
  health-gated rollback. Inactive until `STAGING_ENABLED=true`.
