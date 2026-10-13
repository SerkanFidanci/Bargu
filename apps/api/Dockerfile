# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t bargu-api .

# Base images are pinned by digest; Renovate keeps tag and digest up to date.
FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS base
ENV CI=true \
    HUSKY=0 \
    TURBO_TELEMETRY_DISABLED=1
# pnpm 12 ships as a native binary; npm verifies both packages via registry integrity.
RUN npm install --global --no-fund --no-audit pnpm@12.11.2 turbo@2.11.7
WORKDIR /repo

# 1) Reduce the monorepo to the API and its workspace dependencies (no Expo/React Native).
FROM base AS prune
COPY . .
RUN turbo prune @bargu/api --docker

# 2) Install from the pruned manifests first so this layer is cached until dependencies change,
#    then build and emit a production-only node_modules.
FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm turbo run build --filter=@bargu/api \
 && pnpm --filter @bargu/api deploy --prod /out

# 3) Runtime: distroless (no shell, no package manager), unprivileged `nonroot` user.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e

ENV NODE_ENV=production
WORKDIR /app
# Files stay owned by root: the process can read but not modify its own code.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist

USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "dist/healthcheck.js"]
CMD ["dist/main.js"]
