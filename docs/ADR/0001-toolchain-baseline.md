# 0001. Toolchain baseline

- Status: Accepted
- Date: 2026-10-13

## Context

Faz 0 sets up the monorepo. Versions were verified against registries and official docs on
2026-10-13 (CLAUDE.md: never from memory). Several "latest" releases are not usable together yet.

## Decision

| Area            | Choice                                                                                                                                      | Why                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | **Node 24.21.0 LTS**, pinned in `package.json#devEngines.runtime` (pnpm installs and uses it for every script) and `.nvmrc`                 | Node 25 is EOL (2026-06) and outside Vitest 5 / Expo engines. Node 26 becomes LTS on 2026-10-28; move once tooling confirms support.                                                                             |
| Package manager | **pnpm 12.11.2** (`packageManager`)                                                                                                         | Settings live in `pnpm-workspace.yaml`. Isolated `node_modules` (Expo supports it since SDK 54).                                                                                                                 |
| Supply chain    | `minimumReleaseAge: 1440` (strict), `allowBuilds` allow-list, exact versions (`savePrefix: ''`), frozen lockfile in CI                      | New releases are quarantined for 24 h; install scripts run only for reviewed packages.                                                                                                                           |
| Monorepo        | Turborepo 2.11                                                                                                                              | `dev` is non-interactive so it works in any terminal; `pnpm dev:mobile` gives Expo's shortcuts.                                                                                                                  |
| TypeScript      | **6.0.3**, not 7.0                                                                                                                          | typescript-eslint 8.71 supports `<6.1`; the NestJS 12 CLI also pins `~6.0`. Renovate blocks ≥6.1. Strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.                                          |
| Lint            | ESLint 10 flat config, typescript-eslint `strictTypeChecked`, eslint-plugin-security, eslint-comments (`require-description`)               | Enforces CLAUDE.md: no `any`, no `@ts-ignore`, every `eslint-disable` needs a reason, crypto imports only in `packages/crypto`, no `Math.random`, no `console`.                                                  |
| Mobile lint     | `eslint-plugin-react-hooks` 7 (incl. React Compiler rules) + `eslint-plugin-expo`, **without** `eslint-config-expo`                         | `eslint-config-expo` 57 pulls `eslint-plugin-react` / `eslint-plugin-import`, which call context APIs removed in ESLint 10 (verified: crash in `react/display-name`). Revisit when Expo ships ESLint 10 support. |
| Tests           | Vitest 5 (API, with unplugin-swc for decorator metadata); Jest 29 via `jest-expo` (mobile)                                                  | Each matches its platform's documented setup.                                                                                                                                                                    |
| Mobile          | Expo SDK 57 (RN 0.86, React 19.2, New Architecture only, Hermes V1), Expo Router with typed routes, React Compiler, dev client (no Expo Go) | Current SDK; pinned patch versions older than 24 h.                                                                                                                                                              |
| Hooks           | husky 9 + lint-staged 17; gitleaks in pre-commit                                                                                            | Secrets are blocked before they reach history.                                                                                                                                                                   |

## Consequences

- Contributors need pnpm 12 (`npm i -g pnpm@12.11.2`) and gitleaks installed; Node is provided by pnpm.
- Expo SDK patches published < 24 h ago cannot be installed until they mature (by design).
- Upgrade TypeScript to 7 and `eslint-config-expo` only after their ecosystem constraints lift; Renovate
  rules encode these limits.
