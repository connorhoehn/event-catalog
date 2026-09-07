# @connorhoehn/event-catalog

Unified event registry and transport layer — schema enforcement, metrics, and
admin UI over Redis pub/sub and message-queue.

event-catalog is the authoritative declaration of every cross-service event in
the platform. It covers **both** durable (SQS-style, via `message-queue`) and
signal (WS-style, via Redis pub/sub) events. It is not a broker; messages flow
over Redis and message-queue, not through this service.

## Quick start

```bash
# Install as a library consumer
npm install @connorhoehn/event-catalog

# Run the whole stack (redis + message-queue + event-catalog on :3010)
ssh-add ~/.ssh/id_rsa   # the images install private github: pins over SSH
docker compose up --build

# Or run just this service against a local redis
REDIS_URL=redis://localhost:6379 npm run dev

# Or bring up the same three processes without Docker
npm run dev:stack
```

`REDIS_URL` has no default — see below.

## Configuration

Every variable below is read and validated at startup by `src/cli/config.ts`.
A missing or malformed value exits `2` with one line naming the variable; the
service never boots half-configured.

| Variable | Default | Notes |
|----------|---------|-------|
| `REDIS_URL` | **required** | `redis://` or `rediss://`. Backs the registry, signal transport and audit log. |
| `PORT` | `3010` | `EVENT_CATALOG_PORT` is accepted as an alias; `PORT` wins. |
| `HOST` | `0.0.0.0` | The HTTP server's own default is `127.0.0.1`, which is unreachable from outside a container. |
| `MESSAGE_QUEUE_URL` | `http://localhost:3004` | Durable transport target. Unset only warns. |
| `DLQ_TABLE_NAME` | `event-catalog-dlq` | DynamoDB table for dead letters. |
| `SUBSCRIBER_TTL_SECONDS` | `1800` | Heartbeat sweep window; `0` disables the sweeper. |
| `REDIS_BOOT_CONNECT_ATTEMPTS` | `3` | Connect attempts before boot gives up on Redis and continues degraded. |
| `EVENT_CATALOG_STRICT` | `false` | Reject publishes of undeclared events instead of warning. |
| `ALERT_WEBHOOK_URL` | — | Optional; health transitions are POSTed here. |
| `DYNAMODB_ENDPOINT` / `LOCALSTACK_ENDPOINT` | — | Optional DynamoDB override. Without one (and without AWS credentials) DLQ reads and writes fail; nothing else does. |

`REDIS_URL` is deliberately required rather than defaulted. The old default of
`redis://localhost:6379` is right on a laptop and silently wrong in every
container: the service came up, reported itself healthy, ran an empty in-memory
registry, and said nothing about why.

## Boot behaviour

The server binds its port and serves `/health` **even when Redis is
unreachable** — it degrades to an in-memory registry rather than blocking boot
(`src/utils/redis-boot-strategy.ts`; covered by
`tests/redis-boot-degraded.test.ts`, which spawns the real bin against a dead
Redis). A registry that will not start because Redis is slow would stall every
producer that syncs declarations at boot.

`GET /health` is a tri-state **dependency** report — `200` healthy, `503` when
Redis or message-queue is down — so it is a readiness signal, not a liveness
one. The image's `HEALTHCHECK` deliberately passes on any HTTP response;
wiring container liveness to `/health` would let a message-queue outage restart
the registry too.

## Deployment

```bash
# Context is the PARENT directory: the admin UI takes ../ui-components as a
# file: dependency. Dockerfile.dockerignore keeps the other sibling repos out.
docker build --ssh default -f event-catalog/Dockerfile -t event-catalog ..
```

- **SSH forwarding is required.** `distributed-core` and two of
  ui-components' dependencies are private `github:` pins, so npm shells out to
  git over SSH. Without a key in your agent the build fails with
  `npm error syscall spawn git` or `Permission denied (publickey)`.
- Three stages: server compile, admin bundle, runtime. Only production
  dependencies reach the final image, and the git/ssh/gcc toolchain is added
  and removed in a single layer.
- The admin bundle is **built** in the image. `src/admin/dist` is gitignored,
  so copying the host tree would ship nothing and every admin route would 404.
- Runs as the unprivileged `node` user (uid 1000).
- `dist/`, `dist/admin/dist/index.html` and `contracts/` are asserted present
  at build time, so a missing bundle fails the build rather than the first
  request.

## CLI tools

| Command | Description |
|---------|-------------|
| `ec-lint-crd <path>` | Validate CRD YAML files against the bundle catalog |
| `ec-bundle-diff <name@v1> <name@v2>` | Compare two bundle versions; suggests semver bump |
| `ec-bundle-create <name>` | Scaffold a new FeatureBundle file |

Each CLI prints usage with `--help`.

## CI Integration

Ready-made templates for wiring the CLI into GitHub Actions and git hooks:

- **GitHub Actions workflow** — [`templates/github-actions/lint-crds.yml`](templates/github-actions/lint-crds.yml)
  Drop into `.github/workflows/lint-crds.yml` in any repo that holds CRDs.
- **Pre-commit hook** — [`templates/git-hooks/pre-commit-lint-crd.sh`](templates/git-hooks/pre-commit-lint-crd.sh)
  Copy to `.git/hooks/pre-commit` and `chmod +x`.

### Exit codes (quick reference)

| Code | Meaning |
|------|---------|
| `0` | Clean |
| `1` | Error (missing bundle, stale fingerprint) — fails PR |
| `2` | Warnings only (deprecated bundle) — passes by default, fails in strict mode |

Fail on errors only (recommended default):

```bash
npx ec-lint-crd crds/ || [ $? -eq 2 ]
```

Fail on errors and warnings (strict mode):

```bash
npx ec-lint-crd crds/
```

## Subpath exports

```typescript
import { catalog }              from '@connorhoehn/event-catalog';           // main library
import { pipelineDeclarations } from '@connorhoehn/event-catalog/pipeline';  // pipeline event decls
import { publishSignal }        from '@connorhoehn/event-catalog/signal';    // signal transport
import { publishDurable }       from '@connorhoehn/event-catalog/durable';   // durable transport
import { EventRegistry }        from '@connorhoehn/event-catalog/registry';  // local registry
import { DLQClient }            from '@connorhoehn/event-catalog/dlq';       // DLQ browser
```

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`contracts/README.md`](contracts/README.md) — machine-readable AsyncAPI/OpenAPI adopter specs
