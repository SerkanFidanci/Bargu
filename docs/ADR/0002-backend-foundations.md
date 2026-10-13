# 0002. Backend foundations

- Status: Accepted
- Date: 2026-10-13

## Context

BARGU_PLAN §3.2 fixes NestJS (Fastify), PostgreSQL, Redis, BullMQ and Socket.io. Faz 0 needs a
production-shaped skeleton that later phases build on without rework.

## Decision

- **NestJS 12.1 as ESM** (`"type": "module"`, `module: nodenext`): v12 packages are ESM-only.
  Legacy decorators with `emitDecoratorMetadata` remain required for DI.
- **Fastify adapter**, built by `createHttpAdapter()`:
  - pino logging with redaction (auth headers, tokens, email, push tokens, coordinates). Requests log
    the **route pattern**, never the raw URL (paths/queries may carry tokens) and never the client IP.
  - Server-generated UUID request ids, echoed as `x-request-id`; client-supplied ids are ignored.
  - 64 KiB body limit, connection/request timeouts, `trustProxy` only for an explicit CIDR list
    (Fastify 5.12 no longer accepts hop counts).
- **Built-in hardening** from Nest 12.1: `useSecurityHeaders()` (helmet 8 defaults) and
  `enableCsrfProtection()` (Fetch-Metadata based; native clients unaffected). No extra helmet
  dependency. CORS stays disabled.
- **Configuration**: one zod schema; invalid config stops startup. Error messages name variables but
  never echo values. `.env` is loaded only if present; real environment variables win.
- **Postgres driver: `pg` 8** (pool with connect/statement/query timeouts, idle-error handler).
  Drizzle sits on top of it in Faz 2.
- **Redis client: `node-redis` 6** (`redis` package), not ioredis: Redis recommends it for new
  projects, BullMQ 6 supports it, and the Socket.io Redis adapter works with it. Offline queue is
  disabled so realtime commands fail fast instead of arriving late; reconnects use capped backoff.
- **Health**: `/health/live` (process only) and `/health/ready` (Postgres `SELECT 1` + Redis `PING`,
  1 s timeout each, 503 otherwise). The API starts while dependencies are down and recovers by itself.
- **Build**: Nest CLI with the SWC builder plus type checking (`nest build`), for fast watch mode.
- **Container**: multi-stage; `pnpm deploy --prod` output on `distroless/nodejs24` (no shell),
  non-root, read-only root filesystem, digest-pinned base images, Node-based `HEALTHCHECK`.

## Consequences

- Validation for endpoints will use Nest 12's built-in Standard Schema pipe with zod (no
  class-validator).
- Nest's own logs use JSON in production (`ConsoleLogger`), Fastify uses pino; unifying both on pino
  can be revisited when observability lands (Faz 10).
