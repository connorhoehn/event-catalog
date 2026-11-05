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

Every variable in the first table is read and validated at startup by
`src/cli/config.ts`. A missing or malformed value exits `2` with one line per
problem naming the variable; the service never boots half-configured.

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
| `EVENT_CATALOG_AUTH_TOKEN` | — (**auth off**) | Shared secret gating mutating admin-API requests. See below. |
| `EVENT_CATALOG_COMPRESSION` | `true` | Response compression. `false` is the full revert. See below. |
| `EVENT_CATALOG_COMPRESSION_THRESHOLD` | `1024` | Bytes below which a body is sent uncompressed. `0` compresses everything; under 128 warns, because below ~200 bytes gzip makes JSON larger. |
| `EVENT_CATALOG_COMPRESSION_LEVEL` | `6` | zlib level, `1`–`9`. |
| `ALERT_WEBHOOK_URL` | — | Optional; health transitions are POSTed here. |
| `DYNAMODB_ENDPOINT` / `LOCALSTACK_ENDPOINT` | — | Optional DynamoDB override. Without one (and without AWS credentials) DLQ reads and writes fail; nothing else does. |

Two more are read by the server itself rather than by the config gate, so they
are not validated at boot:

| Variable | Default | Notes |
|----------|---------|-------|
| `EVENT_CATALOG_CORS_ORIGIN` | — (no CORS headers) | Set to an origin to allow it, or `*` to reflect any origin. Off by default: the API has no authentication, so reflecting every origin let any page the operator had open write to the registry. The admin UI is same-origin and needs nothing here. |
| `EVENT_CATALOG_MAX_SSE_STREAMS` | `256` | Concurrent `/api/flow` streams; over-cap connections get `503`. `0` disables the cap. |

`REDIS_URL` is deliberately required rather than defaulted. The old default of
`redis://localhost:6379` is right on a laptop and silently wrong in every
container: the service came up, reported itself healthy, ran an empty in-memory
registry, and said nothing about why.

## Library logging

The client library logs to `console.warn`/`console.error` by default. Pass a
`logger` to route it into the host service's own pipeline instead:

```ts
new EventCatalog({
  ...config,
  logger: {
    warn:  (msg, fields) => log.warn(fields ?? {}, msg),
    error: (msg, fields) => log.error(fields ?? {}, msg),
  },
});
```

`fields` carries the structured half — `eventName`, `channel`, `queue`,
`attempt`, `status`, `suppressed` — so a sink never has to regex the message.

Rate limiting stays inside the library: some of these lines sit on the publish
path, and an adapter has no way to know which. Forward every call you receive.
Omitting `logger` leaves output byte-identical to before.

## Response compression

**On by default.** API responses and the admin UI's static assets are
compressed with brotli, gzip or deflate, negotiated from `Accept-Encoding` in
that preference order (brotli q5 measured both smaller and ~1.5x cheaper than
gzip L6 on every payload here). `/api/events` goes 325.6 → 39.4 KiB,
`/api/metrics/history` 199.0 → 1.9 KiB, the admin bundle 68.9% smaller.

Nothing that worked stops working: a body is only ever compressed for a client
that advertised the coding, so a caller that cannot decode still gets
`identity`. Node's global `fetch` advertises and decodes transparently;
`http.request` advertises nothing. SSE (`/api/flow`, `/api/audit/stream`) is
excluded structurally — the first `flushHeaders()`/`write()` latches a flag —
rather than by a path list, so a future streaming endpoint cannot be
accidentally buffered.

Set `EVENT_CATALOG_COMPRESSION=false` to turn the whole thing off, e.g. behind
a proxy that already compresses.

## Admin API authentication

**Off by default.** With `EVENT_CATALOG_AUTH_TOKEN` unset, no middleware is
installed and every endpoint answers exactly as it always has — producers
syncing declarations at boot, CI jobs, curl and the admin UI all keep working
with no credential. Setting the variable is the only thing that turns this on.

Set it to require `Authorization: Bearer <token>` on **every mutating (non-GET)
`/api` request** — declare, delete, deprecate, subscriber add/remove, manifest
put/delete, DLQ replay/clear. GET is never challenged, so the admin UI, the
read endpoints and the `/api/flow` and `/api/audit` SSE streams are unaffected,
and `/health` and `/metrics` stay open regardless: a liveness probe and a
Prometheus scrape can never be locked out by a token rotation.

```bash
EVENT_CATALOG_AUTH_TOKEN=$(openssl rand -hex 32)

curl -X POST localhost:3010/api/events \
  -H "Authorization: Bearer $EVENT_CATALOG_AUTH_TOKEN" \
  -H 'Content-Type: application/json' -d @declaration.json
```

Comparison is constant-time over sha256 digests, so neither the value nor its
length leaks through timing. A rejection is a bare `401 {"error":"Unauthorized"}`
— identical for an absent, malformed or wrong token — and is logged server-side
with source, method and path, never the presented token.

The token must be at least 16 characters with no whitespace; anything shorter,
empty or malformed exits `2` at boot rather than starting a server that looks
authenticated and is not. Set it *and* leave it empty (a broken `${VAR}`
interpolation) and the server refuses to start — that case is an error, not
"off". A library consumer calling `startServer()` directly can pass their own
`authMiddleware` instead; an explicit one wins over the variable.

## Boot behaviour

The server binds its port and serves `/health` **even when Redis is
unreachable** — it degrades to an in-memory registry rather than blocking boot
(`src/utils/redis-boot-strategy.ts`; covered by
`tests/redis-boot-degraded.test.ts`, which spawns the real bin against a dead
Redis). A registry that will not start because Redis is slow would stall every
producer that syncs declarations at boot.

`GET /health` is a tri-state **dependency** report — `healthy` / `degraded` /
`unhealthy` per check, `200` for the first two and `503` once Redis or
message-queue is unhealthy — so it is a readiness signal, not a liveness one.
The image's `HEALTHCHECK` deliberately passes on any HTTP response;
wiring container liveness to `/health` would let a message-queue outage restart
the registry too.

## Deployment

```bash
# Context is the PARENT directory (every COPY is prefixed event-catalog/);
# Dockerfile.dockerignore keeps the sibling repos out.
docker build --ssh default -f event-catalog/Dockerfile -t event-catalog ..
```

- **SSH forwarding is required.** `distributed-core` is a private `github:`
  pin, so npm shells out to git over SSH. Without a key in your agent the build fails with
  `npm error syscall spawn git` or `Permission denied (publickey)`.
- Three stages: server compile, admin bundle, runtime. Only production
  dependencies reach the final image, and the git/ssh/gcc toolchain is added
  and removed in a single layer.
- The admin bundle is **built** in the image. `src/admin/dist` is gitignored,
  so copying the host tree would ship nothing and every admin route would 404.
- Runs as the unprivileged `node` user (uid 1000).
- `dist/cli/index.js` and `dist/admin/dist/index.html` are asserted present at
  build time, so a missing entrypoint or bundle fails the build rather than the
  first request.

## CLI tools

| Command | Description |
|---------|-------------|
| `ec-lint-crd <path>` | Validate CRD YAML files against the bundle catalog |
| `ec-bundle-diff <name@v1> <name@v2>` | Compare two bundle versions; suggests semver bump. `--exit-code` makes "differs" exit `3` so CI can tell it from "failed to run" (`1`). |
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
| `2` | Usage error — unknown flag, missing path, path not found, non-YAML file. |
| `3` | Warnings only (deprecated bundle) — passes by default, fails in strict mode. |

Fail on errors only (recommended default):

```bash
npx ec-lint-crd crds/ || [ $? -eq 3 ]
```

Fail on errors and warnings (strict mode):

```bash
npx ec-lint-crd crds/
```

## Subpath exports

```typescript
import { EventCatalog }         from '@connorhoehn/event-catalog';           // main library
import { pipelineDeclarations } from '@connorhoehn/event-catalog/pipeline';  // pipeline event decls
import { SignalTransport }      from '@connorhoehn/event-catalog/signal';    // signal transport
import { DurableTransport }     from '@connorhoehn/event-catalog/durable';   // durable transport
import { Registry }             from '@connorhoehn/event-catalog/registry';  // local registry
import { DLQManager }           from '@connorhoehn/event-catalog/dlq';       // DLQ browser

import type { EventPayloadMap }    from '@connorhoehn/event-catalog/types';         // generated payload types
import type { ClientFramePayload } from '@connorhoehn/event-catalog/client-frames'; // generated WS frame types
```

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`contracts/README.md`](contracts/README.md) — machine-readable AsyncAPI/OpenAPI adopter specs


### Durable consumer acknowledgement failures

The library marks a consumed message `received` only after MQ accepts its
receipt deletion. HTTP errors, network failures and timeouts leave the message
eligible for queue redelivery and increment the failed metric, without charging
those failures to the handler's poison-message budget. Handlers must be
idempotent because processing can succeed while acknowledgement fails.

Set `acknowledgementTimeoutMs` (default 10,000 ms) directly or through
`EventCatalog.messageQueue`. Unsubscribe/disconnect stop intake immediately, keep
renewing accepted work, and wait up to `drainTimeoutMs` (default 30,000 ms).
After that deadline the handler signal and pending receipt I/O are aborted.
The local in-memory DLQ remains a bounded diagnostic buffer, not a durable
replacement for the queue service's DLQ.

Handler failures never cause source deletion. `maxProcessingAttempts` controls
when a diagnostic and `onDeadLetter` callback fire; neither that buffer nor a
successful callback authorizes an acknowledgement. Configure the queue's
`dlqAfterAttempts`/redrive policy for durable movement. Without a broker redrive
policy, a poison message remains eligible for retry until queue retention expires.
Replacing the client or losing the diagnostic buffer cannot delete that source.
The legacy `deadLetteredTotal` metric counts poison observations, not confirmed
durable DLQ transfers.

### Authenticated queue transport

Pass `createServiceRequestHeaders({ secret, serviceId, audience: 'message-queue' })`
from service-runtime 0.4.0 as `messageQueue.requestHeaders` when constructing
EventCatalog, or `requestHeaders` when constructing DurableTransport directly.
The hook runs for each actual HTTP attempt, including retries and receipt
deletion. It receives the final URL, method and UTF-8 body. The transport
preserves existing content headers and cancellation signals, refuses redirects
when signing, and never retries without a signature if the hook fails.

For the registry container's outbound MQ transport, set `MQ_SERVICE_AUTH_SECRET`
and allow the `event-catalog` caller at MQ. This is separate from inbound
`EVENT_CATALOG_AUTH_TOKEN`; configuring one does not secure the other.

Production registry startup (`NODE_ENV=production`) now requires
`EVENT_CATALOG_AUTH_TOKEN`, or an explicitly injected `authMiddleware` for
programmatic `startServer` callers. It refuses to open dependencies or bind a
listener when neither is supplied. The existing bearer policy gates mutations;
reads/metrics/flow still require a private network or an authenticated ingress
policy if their visibility must be restricted. EventCatalog already forwards
`EVENT_CATALOG_AUTH_TOKEN` on producer registration, heartbeat and manifest writes.

### Durable subscriber lifecycle and queue policy (0.9.0)

Queue policy setup is strict. A configuration conflict, unavailable broker or
missing required dead-letter queue rejects publishing; the catalog never drops
redrive policy to make a send succeed. Subscriptions retry failed setup with
bounded backoff. Broker `/ready` is probed with a two-second deadline;
`isConnected()` still means `connect()` was called, while `healthCheck()` reports
current dependency availability. Queue URLs must be bare HTTP(S) origins.

Declare `fifo: true` with `partitionKey(payload)`, or pass `groupId` to publish.
The default queue name gains `.fifo`; an explicit queue name must already be valid
for the broker. An automatically created FIFO dead-letter queue is named
`base-dlq.fifo` (long names are deterministically shortened). `deduplicationId`
defaults to the envelope ID for retries of that publish. Separate publish calls
create distinct envelopes; use an explicit stable business key when those calls
represent the same operation. `delaySeconds`, `timeoutMs` and `signal` are also
available in publish options. Timeouts apply per HTTP attempt, including setup,
signing and the response body; retries can extend the overall publish duration.

```ts
catalog.declare({
  name: 'work:requested', producer: 'worker', schema: { type: 'object' },
  transport: 'durable', fifo: true, dlqAfterAttempts: 3,
  partitionKey: payload => (payload as { teamId: string }).teamId,
});
const subscription = catalog.subscribe('work:requested', async (event, context) => {
  context?.signal.throwIfAborted();
  // Persist the business result idempotently; cancellation alone cannot fence writes.
  await processWork(event, context?.signal);
}, { visibilityTimeout: 30 });
await subscription.unsubscribe(); // stops intake and awaits bounded draining
```

Direct `DurableTransport.subscribe()` still returns a callable stop function;
`stop(); await stop.done` awaits draining. Every receipt in a fetched batch is
renewed, including those behind a slow handler. Renewal failure aborts the
handler context and prohibits a late ACK. Pausing stops new intake; an already
started handler may finish, while unstarted deliveries are left for redelivery.
Handler cancellation is cooperative: uncooperative business writes can continue
after the drain deadline and need their own durable idempotency/fencing checks.

The catalog deliberately uses distributed-core's `fallback` validator to retain
its established supported keyword set, regardless of transitive AJV installation.
`format` remains documentary on this path. Adopting broader schema enforcement
requires a separate compatibility review, not a dependency-hoisting side effect.

Run `npm run verify:durable` for the packed boundary. Run
`EC_DDB_INTEGRATION=1 npm test -- tests/durable-broker.test.ts` with a loopback
DynamoDB Local endpoint for real delivery acceptance. The test starts the installed
SHA-pinned broker package, creates only its UUID-owned table and processes, and
removes them afterward. It does not migrate or reset a shared stack. The broker's
experimental `ddb-v2` path still rejects production/durable runtime profiles;
durable subscriptions, operator replay and scale acceptance remain separate gates.
