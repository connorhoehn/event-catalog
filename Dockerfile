# syntax=docker/dockerfile:1

# event-catalog service image.
#
# BUILD CONTEXT: the PARENT directory holding event-catalog/ and
# ui-components/ as siblings — the admin UI takes ui-components as a `file:`
# dependency and Vite aliases `@ui` at its source tree. docker-compose.yml
# sets `context: ..` for this reason. Ignore rules live in
# Dockerfile.dockerignore (BuildKit prefers it over the context root's
# .dockerignore, which is what keeps the other sibling repos out).
#
# SSH IS REQUIRED. distributed-core and two of ui-components' dependencies are
# private `github:` pins, so npm shells out to git over SSH:
#
#   docker build --ssh default -f event-catalog/Dockerfile -t event-catalog ..
#   docker compose build          # compose passes `ssh: [default]`
#
# Without `--ssh default` the install fails with `npm error syscall spawn git`.

ARG NODE_IMAGE=node:20-alpine

# -----------------------------------------------------------------------------
# Shared base: git + ssh for the private github: pins, and the toolchain
# node-gyp needs for distributed-core's native deps (lz4).
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache git openssh-client python3 make g++ \
 && mkdir -p -m 0700 /root/.ssh \
 && ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null

# -----------------------------------------------------------------------------
# Stage 1 — compile the server + CLI to dist/
#
# NOTE: `tsc` alone is NOT enough. tsconfig.json is the *emit* config for the
# library half and explicitly excludes src/cli and src/server; `build:cli`
# emits those from their own entry-point graph. Running only `tsc` produces a
# dist/ with no dist/cli/index.js, i.e. an image whose CMD cannot resolve.
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY event-catalog/package.json event-catalog/package-lock.json* ./
RUN --mount=type=ssh npm ci

COPY event-catalog/tsconfig.json ./
COPY event-catalog/src/ ./src/
RUN npm run build && npm run build:cli

# -----------------------------------------------------------------------------
# Stage 2 — build the admin UI bundle.
#
# src/admin/dist is gitignored, so it must be BUILT here; a plain COPY of the
# host tree yields nothing and every admin route 404s in the container.
# -----------------------------------------------------------------------------
FROM base AS admin-builder

# `file:../../../ui-components` resolved from /app/src/admin lands on
# /ui-components, and vite.config.ts aliases @ui at /ui-components/src.
COPY ui-components/ /ui-components/

WORKDIR /app/src/admin
COPY event-catalog/src/admin/package.json event-catalog/src/admin/package-lock.json* ./
# --ignore-scripts because npm runs `prepare` for the `file:` ui-components
# link, and ui-components' prepare rebuilds itself with rolldown — whose
# native binding in the copied-in node_modules is the host's darwin build.
# The bundle never needs it: vite.config.ts aliases @ui at ui-components/src,
# not at its dist.
RUN --mount=type=ssh npm ci --ignore-scripts

COPY event-catalog/src/admin/ ./
# `npm run build` is `tsc && vite build`. Only the bundle is wanted here:
# that `tsc` also typechecks ui-components' SOURCE through the @ui alias,
# against a tsconfig that has no @types/node in this stage, so it fails on
# ui-components' own `process.env` reads. Typechecking the admin app is a CI
# gate (`npm run build:admin` on a dev machine), not a deployment gate — an
# image should not become unbuildable because a sibling library's types
# drifted.
RUN npx vite build \
 && test -f dist/index.html   # fail the build here, not at the first 404

# -----------------------------------------------------------------------------
# Stage 3 — runtime. Production dependencies only; no compilers, no dev deps,
# no source.
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3010 \
    HOST=0.0.0.0

# git/ssh/toolchain are install-time only — added, used, and removed in one
# layer so they never reach the shipped image.
COPY event-catalog/package.json event-catalog/package-lock.json* ./
RUN --mount=type=ssh \
    apk add --no-cache --virtual .build-deps git openssh-client python3 make g++ \
 && mkdir -p -m 0700 /root/.ssh \
 && ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && apk del .build-deps \
 && rm -rf /root/.ssh /root/.npm

COPY --from=builder /app/dist ./dist
# The server resolves the admin bundle at join(__dirname, '../admin/dist'),
# i.e. /app/dist/admin/dist.
COPY --from=admin-builder /app/src/admin/dist ./dist/admin/dist
# Shipped for CLI subcommands run inside the container (`drift`,
# `manifest verify`) that read the registry snapshot off disk.
COPY event-catalog/contracts ./contracts

# Fail the build rather than the first request if either bundle is missing.
RUN test -f dist/cli/index.js && test -f dist/admin/dist/index.html

# node:alpine ships an unprivileged `node` user (uid 1000). Nothing here is
# written to at runtime, so ownership stays with root and the process only
# reads.
USER node

EXPOSE 3010

# LIVENESS, not readiness — deliberately passes on any HTTP response,
# including /health's 503.
#
# /health is a DEPENDENCY report: it scores itself unhealthy (503) whenever
# message-queue or Redis is unreachable. Wiring that to the container's
# healthcheck would mean message-queue going down gets the registry killed
# and restarted too, which is the outage-amplifier shape this service is
# specifically built to avoid (it boots and serves with Redis down on
# purpose). What belongs here is "is the process still answering its socket";
# whether its dependencies are up is for /health's readers to act on.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3010,path:'/health',timeout:4000},r=>{r.resume();process.exit(0)}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})"

CMD ["node", "dist/cli/index.js"]
