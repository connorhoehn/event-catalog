# event-catalog — agent context

Hybrid schema-registry library + service. Owns the declaration of every
cross-service event in the platform — both **durable** (SQS-style, persisted,
retryable, via `message-queue`) and **signal** (WS-style, ephemeral, via Redis
pub/sub). Reframed 2026-05-15 as **an exchange for contracts plus an
observability layer on the flow**, not merely a schema registry.

All roadmap phases (E1–E8) shipped; see `CHANGELOG.md` for history. There
is no self-driven backlog — new direction comes from the operator.

## Architecture in one paragraph

The library half (`@connorhoehn/event-catalog`) is the fast-path runtime: each
service declares its events in code (`catalog.declare(...)`) and publishes
through `catalog.publish('event:name', payload)`, which validates locally
against the schema and routes to `SignalTransport` (Redis pub/sub) or
`DurableTransport` (HTTP POST to `message-queue`). The service half
(distributed-core AdmissionHttpServer on `:3010`) is the central inventory + observability surface: consumers POST
their declarations via `syncToRemoteRegistry` so the server can answer "who
consumes X?", gate schema evolution, surface deterministic sha256
fingerprints (Phase E6), group events by namespace (Phase E7), and stream
the live event flow over SSE at `GET /api/flow` (Phase E8) so the admin UI
can pulse the topology graph as events fire. Library publish never blocks
on the server. Multiple server replicas share the registry over a Redis hash
plus pub/sub; `src/server/registry-coordinator.ts` orders mutations with a
Lamport clock and runs the same compat gate the HTTP route runs, so a schema
refused on one replica cannot be installed on another by broadcast. The 24
`FeatureBundle`s in `src/declarations/bundles/` are the pinnable unit an
adopter names in a CRD, served at `/api/feature-bundles`.

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

Service listens on `$PORT`, falling back to `$EVENT_CATALOG_PORT` (default
`3010`); `$PORT` wins if both are set. **`REDIS_URL` is required** — unset or
malformed is a boot error and exit `2`, not a fall back to localhost.
`MESSAGE_QUEUE_URL` is optional (default `http://localhost:3004`); unset only
warns. All 11 runtime variables — including the three
`EVENT_CATALOG_COMPRESSION*` knobs, response compression being on by default —
are resolved and validated in `src/cli/config.ts` before any socket is opened.
See README's Configuration table.

## Cross-repo position

event-catalog is the **gating milestone (M1)** for the platform. M2 (durable
backbone via message-queue), M3 (gateway split), M4 (pipeline-worker split) all
assume cross-service events are declared and validated here.

| Producer | Status |
|----------|--------|
| `platform-api` | ✅ Library consumer; publishes via `catalog.publishSignal`/`publish`. |
| `websocket-gateway` | ✅ Library consumer (Phase E2); shared envelope builders adopted in `message-router.ts`; 23 frame-type declarations in `realtime-examples/src/observability/gateway-event-declarations.ts` (they live in realtime-examples, not this repo or websocket-gateway) + finer-grained `gatewaySignalDeclarations` pulled from this repo. |
| `live-video-streaming` (SFU) | ✅ Best-effort registration at boot via `src/event-declarations.js` (20 events: webhook + control-plane + chat-bus). LVS is inactive — direct edits permitted; no handoff required. |
| `realtime-modules` | ✅ Type-only devDependency — client hooks annotate outbound frames with `satisfies ClientFramePayload<...>` from `@connorhoehn/event-catalog/client-frames` (hub#1497). |
| `distributed-core` | ❌ Never a direct consumer (it's a library). Its ~36 pipeline events are declared on its behalf by this repo at `src/declarations/`. |
| `message-queue` | ❌ Never imports event-catalog. Reverse: catalog's `DurableTransport` calls message-queue HTTP, and MQ workers fetch schemas via `GET /api/events/:name`. |

## Dependencies

- **`distributed-core`** — SHA-pinned (v0.42.1 as of 2026-09-07; check
  package.json for current). Uses `RetryManager`, `CircuitBreaker`,
  `JsonSchemaValidator`, `MetricsRegistry`, and — since v0.4.0 — the HTTP
  transport (`AdmissionHttpServer` + `serveStatic` from
  `distributed-core/server`; the admin server does NOT use Express).
  `Counter`/`Gauge` come from `distributed-core/monitoring`, not the root
  barrel.
- **`@connorhoehnslalom/message-queue`** — runtime dependency, SHA-pinned to
  v0.4.0. `DurableTransport` imports `/client`; `MESSAGE_QUEUE_URL` is the
  broker's bare origin. Queue policy is strict; subscriber leases renew and
  shutdown drains within a configured budget. See README's 0.9.0 section.
- **`@connorhoehnslalom/ui-components`** — the admin UI's component library
  (the slalom scope is correct; its peer `@connorhoehn/realtime-modules` is a
  different, never-renamed repo — do not "fix" either scope). Installed from a
  vendored tarball, `src/admin/vendor/connorhoehnslalom-ui-components-<ver>.tgz`
  via `file:`; there is no source alias. To upgrade: drop the new tarball in
  `vendor/`, `npm install --save file:vendor/<tgz>` in `src/admin`, delete the
  old one. The topology + flow views use `AnimatedEdge` from its
  `/pipelines` subpath with `@xyflow/react` to match the gateway's
  pipeline-replay visual language.

## Admin UI (`src/admin`)

Before writing or changing any admin page, read
`src/admin/node_modules/@connorhoehnslalom/ui-components/docs/COMPONENT_INDEX.md`
and follow the library's `ui-page-build` skill
(`node_modules/@connorhoehnslalom/ui-components/skills/ui-page-build/SKILL.md`):

- Start every routed view from one page template (`CollectionPage`,
  `MasterDetailPage`, `DetailPage`, `DashboardPage`, `SettingsPage`, or
  `PageFrame`) inside the app's single `AppShell layout="fill"` (`App.tsx`).
- Controls come from the library: `DataTable`, `Select`, `Input`,
  `SearchInput`, `NumberInput`, `Checkbox`, `Button` with an explicit
  `variant`. No raw `<table>`/`<select>`/`<input>`/`<button>`, no
  `style={{}}`, no new rules in `src/styles.css` for something the library
  draws. Missing primitive → add it to ui-components first.
- Gate: `npm run typecheck && npm test && npm run lint && npm run build` in
  `src/admin` (`npm run lint:admin` from the root). Lint is the library's
  ESLint plugin (`eslint.config.js`, `configs.recommended`).
- Import from subpaths (`/shared`, `/pipelines`, …) per COMPONENT_INDEX;
  only root-only names (`AppShell`, `ThemeProvider`) come from the root.
  `vite.config.ts` marks the library's JS side-effect free so the root
  import doesn't pull the whole barrel into the entry chunk.
- The library `Select` is a combobox over a portaled listbox, not a native
  `<select>`; unit tests drive it with `readOptions`/`chooseOption` from
  `src/test/helpers.tsx`.

## agent-hub retired (2026-08-16)

This repo was previously coordinated through `agent-hub`. That system was
retired on 2026-08-16: the server is gone, the MCP registration removed, and
`~/.agent-hub` (task database, handoffs, blockers) deleted. Do not look for
hub tasks, do not attempt to register/heartbeat, and do not call
`mcp__agent-hub__*` tools — they no longer exist. `hub#<id>` references in
docs and commit history are historical breadcrumbs, not live tickets.
Current state and open work live in this repo (constitution/roadmap/CHANGELOG).
## Production authentication (0.7.1)

`startServer` requires `EVENT_CATALOG_AUTH_TOKEN` or an injected auth middleware
in production, before opening dependencies. The bearer policy protects mutations;
reads and observability still need private routing. MQ is a separate receiver:
`MQ_SERVICE_AUTH_SECRET` signs outbound requests as `event-catalog`. Configure
both boundaries. Docker installs skip lifecycle scripts and compile the service
explicitly; Git dependencies provide tracked distribution artifacts.
