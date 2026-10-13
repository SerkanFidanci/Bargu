# Architecture Decision Records

Every decision that changes the architecture gets an ADR (CLAUDE.md). Copy the template below into
`NNNN-short-title.md`, never rewrite an accepted ADR — supersede it with a new one.

| #                                   | Title                                                          | Status   |
| ----------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-toolchain-baseline.md)  | Toolchain baseline (Node, pnpm, TypeScript, ESLint, Expo)      | Accepted |
| [0002](0002-backend-foundations.md) | Backend foundations (NestJS 12 ESM on Fastify, pg, node-redis) | Accepted |
| [0003](0003-staging-deployment.md)  | Staging deployment (single VPS, GHCR, SSH forced command)      | Accepted |

## Template

```md
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```
