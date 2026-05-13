# event-catalog — agent context

Hybrid schema-registry library + service. Owns the declaration of every
cross-service event in the platform — both **durable** (SQS-style, persisted,
retryable, via `message-queue`) and **signal** (WS-style, ephemeral, via Redis
pub/sub).

**Read `.agent/CONSTITUTION.md` first** — agent's north star and
backlog priorities. Read `ROADMAP.md` for phase E1–E5 progression.

## Architecture in one paragraph

The library half (`@connorhoehn/event-catalog`) is the fast-path runtime: each
service declares its events in code (`catalog.declare(...)`) and publishes
through `catalog.publish('event:name', payload)`, which validates locally
against the schema and routes to `SignalTransport` (Redis pub/sub) or
`DurableTransport` (HTTP POST to `message-queue`). The service half (Express
on `:3010`) is the central inventory: each consumer POSTs its declarations
via `syncToRemoteRegistry` so the server can answer "who consumes X?" and gate
schema evolution. Library publish never blocks on the server.

## Workflow conventions

- **Solo project, no PRs.** Stage, commit, push to `main` directly.
- **No destructive ops without explicit ask.**
- **TypeScript strict mode.** Vitest for tests.
- **No runtime schema libs.** JSON Schema only — don't pitch zod/ts-rest/tRPC.

## Local dev

```bash
npm run dev               # tsx watch on src/cli/index.ts
docker compose up         # redis + message-queue + event-catalog server
```

Service listens on `EVENT_CATALOG_PORT` (default `3010`). Requires
`REDIS_URL` and `MESSAGE_QUEUE_URL` (default `http://localhost:3004`).

## Cross-repo position

event-catalog is the **gating milestone (M1)** for the platform. M2 (durable
backbone via message-queue), M3 (gateway split), M4 (pipeline-worker split) all
assume cross-service events are declared and validated here.

| Producer | Status |
|----------|--------|
| `platform-api` | ✅ Only current consumer of the library |
| `websocket-gateway` | 🔜 Phase E2 — needs WS frame types declared, envelope shared |
| `live-video-streaming` (SFU) | 🔜 Phase E2 — needs chat-bus + control + webhook events declared. **Coordinate via handoff** — other agent owns that repo. |
| `distributed-core` | ❌ Never a direct consumer (it's a library). Its events declared on its behalf by `platform-api`. |
| `message-queue` | ❌ Never imports event-catalog. Reverse: catalog's `DurableTransport` calls message-queue HTTP. |

## Dependencies

- **`distributed-core`** — pinned to `#main`. Uses `RetryManager`,
  `CircuitBreaker`, `JsonSchemaValidator`, `MetricsRegistry`. Drift hazard:
  websocket-gateway pins to `#v0.14.2` tag; reconcile before deeper adoption.
- **`@connorhoehn/message-queue`** — peer dependency. `DurableTransport`
  resolves to this via `MESSAGE_QUEUE_URL`.
- **`@connorhoehn/ui-components`** — admin UI shared components (Vite).

## Hub coordination

Registered with `agent-hub` as the agent named `event-catalog` (role `infra`).
Open tasks at `agent-hub status tasks` or the dashboard at
http://127.0.0.1:8765/.
