# event-catalog — Hybrid Architecture Reference

> **Audience:** an engineer (or future-Claude) deciding whether to add
> event-catalog to a service. Answers "library? service? both? neither?"
> in ~5 minutes.

event-catalog is **one product shipped as two halves**: an npm library that
runs in-process inside every producer/consumer service, and a central
Express service on `:3010` that owns cross-service inventory. The library
is the fast path (validation + transport). The service is the slow path
(discovery, evolution gating, DLQ inspection, UI).

Messages **never flow through the service**. Redis (signal) and
message-queue (durable) are the real wires.

---

## 1. The split

### What lives in the library (`@connorhoehn/event-catalog`)

The library is what consumers import and instantiate per process. Everything
on the publish hot-path runs in-process — no network call to the catalog
service is required to validate or send an event.

| Concern | Module |
|---|---|
| `EventCatalog` class — `connect / declare / publish / publishSignal / subscribe` | `src/client/index.ts` |
| `EventDeclaration`, `EventEnvelope`, `EventMetadata`, `TransportType` | `src/types/index.ts` |
| Shared wire envelopes (`channel_message`, `direct_message`, `broadcast`, `SignalMessage`) + builders + JSON Schemas | `src/types/envelopes.ts` |
| Local `Registry` + Ajv-based JSON Schema validation + alias resolution | `src/registry/index.ts` |
| Backward / forward / full schema compat checking | `src/registry/schema-compat.ts` |
| **Deterministic schema fingerprinting (Phase E6)** — sha256 of sorted-key serialization | `src/registry/fingerprint.ts` |
| **Namespace derivation (Phase E7)** — dotted/colon prefix fallback | `src/registry/namespace.ts` |
| Signal transport (Redis pub/sub) | `src/client/signal.ts` |
| Durable transport (HTTP → message-queue) | `src/client/durable.ts` |
| Library-owned event declarations (DC PipelineExecutor events) | `src/declarations/` |

Boot looks like:

```ts
const catalog = new EventCatalog({ redis: { url }, messageQueue: { url }, serviceName, registryUrl });
catalog.declare(myEvent);                  // local registry only
await catalog.connect();                   // opens Redis + syncs to remote registry
await catalog.publish('event:name', payload);
```

`publish()` runs locally:
1. Look up the declaration. Reject if undeclared.
2. Validate payload against the JSON Schema.
3. Apply discriminator check if declared (E3.6).
4. Build envelope; fan out to signal and/or durable per `transport`.

**Library publish never blocks on the catalog server.** If the registry
URL is unreachable, sync is retried in the background; publishes keep
working.

### What lives in the service (`event-catalog` on `:3010`)

The service is the central inventory and operator surface. It does not
proxy or broker events.

| Concern | Endpoint(s) |
|---|---|
| Event inventory (carries `schemaFingerprint` + `namespace` on every entry) | `GET /api/events`, `GET /api/events/:name` |
| Filter by namespace | `?namespace=X` on `/api/events` and `/api/topology` |
| Bulk declaration sync from producers | `POST /api/events`, `POST /api/events/bulk` |
| Schema history per event (with per-version fingerprints) | `GET /api/events/:name/history` |
| Pre-flight compat check | `GET /api/events/:name/schema/check` |
| Per-event publish stats | `GET /api/events/:name/stats` |
| Subscriber registration | `POST /api/events/:name/subscribers`, `DELETE …/:serviceName` |
| Topology graph (producers → events → consumers) | `GET /api/topology` |
| **Live flow tap (SSE, Phase E8)** | `GET /api/flow` with `?eventName, ?transport, ?producer, ?namespace, ?sample` |
| Signal-side channel inventory | `GET /api/transports/signal/channels` |
| Durable-side queue inventory + DLQ store + batch redrive | `GET /api/transports/durable/queues`, `…/dlq`, `…/dlq/:id/replay`, `…/dlq/replay` |
| Health / readiness | `GET /health` |
| Prometheus metrics | `GET /metrics` |
| Admin UI (Vite + React; topology + live flow on `@xyflow/react` with shared `AnimatedEdge` from ui-components) | `src/admin/` |

The DLQ store is DynamoDB-backed (`src/server/dlq-store.ts`). The service
listens on `EVENT_CATALOG_PORT` (default `3010`).

---

## 2. When to use library vs. service

Pick the smallest path that covers your need:

| Need | Library only | Service required |
|---|:-:|:-:|
| Publish a validated event | ✅ | — |
| Subscribe with envelope decoding | ✅ | — |
| Local schema enforcement on publish | ✅ | — |
| Cross-service discovery ("who consumes X?") | — | ✅ |
| DLQ inspection / redrive | — | ✅ |
| Schema-evolution gating across deploys | — | ✅ |
| Operator UI / metrics scrape | — | ✅ |
| Live producer/consumer topology graph | — | ✅ |

Rule of thumb:

- **Library-only** is enough for a leaf producer that only emits or
  consumes events and doesn't care about platform-wide observability.
- **Library + service** is the default for any service participating in
  cross-service flows. The library handles the hot path; the service
  handles operator concerns.
- **Service-only** is never the right answer — the service is not a
  proxy; you'd lose schema validation on the publish path.

A consumer adding event-catalog **always** starts with the library. Wire
the service when (a) you need to see cross-service topology, (b) you need
DLQ redrive without code changes, or (c) you're enabling strict-mode
compat enforcement at deploy time.

---

## 3. Declaration ownership

Where a declaration lives depends on who emits the event.

### Library-emitted events → declared in `event-catalog/src/declarations/`

distributed-core's `PipelineExecutor` emits ~28 colon-form events
(`pipeline:run:started`, `pipeline:step:completed`, etc.). distributed-core
itself never imports event-catalog — it's a library and has no agent. So
event-catalog hosts these declarations on its behalf at
`src/declarations/pipeline.ts` + `pipeline-p1.ts`. Consumers
`import { pipelineDeclarations } from '@connorhoehn/event-catalog'` and
feed them into `catalog.declare()` at boot.

### Service-emitted events → declared in the producing service's repo

Per the EC charter, **the producer owns the declaration**. Gateway-emitted
WS frame types are declared in `websocket-gateway/src/event-catalog/`;
platform-api events live in `platform-api/src/lib/event-catalog.ts`;
LVS events (when wired) belong in `live-video-streaming/src/`.

Why: the schema is part of the producer's API surface. Moving it would
force two-repo PRs every time a field is added. Keeping it co-located
with the producer keeps cohesion high.

The catalog only *aggregates* — it never sources declarations centrally.

---

## 4. `syncToRemoteRegistry` reconciliation

Each `EventCatalog` instance owns a local in-memory `Registry`. On
`connect()`, if `registryUrl` is set, it POSTs every declaration to
`POST /api/events/bulk` and then re-syncs every 60 s.

Conflict resolution on the service side (`POST /api/events`):

1. **Unknown event** — accepted; first version is `1`.
2. **Identical schema** — no-op (version unchanged).
3. **Compatible schema change** (additive) — version bumped, prior schema
   pushed to history (capped at 5 entries).
4. **Breaking schema change** — strict-mode gate applies. See §7.

Background sync failures are retried with exponential backoff via
distributed-core's `RetryManager`. A failed sync **never blocks publish**
— the library still has a valid local registry.

```ts
// Subscriber registration is non-blocking and fault-tolerant:
catalog.subscribe('event:name', handler);
// → adds to local registry
// → POST /api/events/{name}/subscribers (fire-and-forget)
```

---

## 5. Schema-fetch flow (Wave 3 / MQ-7 + EC-6)

message-queue does not import the event-catalog library. The reverse
direction (catalog → message-queue HTTP) is the only coupling. So
message-queue fetches schemas at message-receive time via the service's
HTTP API:

```
MQ worker → GET /api/events/{name} → { schema, validationMode, ... }
                                   → cache 60 s in-process
                                   → validate inbound payload per validationMode
```

Per-declaration `validationMode` (declared via `EventDeclaration`):

- `'strict'` — reject + DLQ on validation failure.
- `'warn'` — log violation, deliver anyway.
- `'off'` — skip validation entirely.

This wiring keeps message-queue decoupled from the library's TypeScript
surface while still honoring the declared schema. The 60-s cache absorbs
catalog restarts without blocking the worker hot path.

---

## 6. Compat checking (Wave 3 / EC-7)

The library and service both run compat checks; they enforce at different
moments.

### Library side — `EventCatalog.declare()`

Runs `schema-compat` against the local registry's prior version of the
event. If a violation is detected:

- `EVENT_CATALOG_STRICT=true` (or `config.strict: true`) → `declare()`
  **throws**. The service fails to boot.
- Otherwise → violation logged at warn level; declaration accepted.

### Service side — `POST /api/events`

Runs the same compat check against the registered history. On violation:

- Strict mode enabled → respond `409 Conflict` with a body listing
  violations. The producer's `syncToRemoteRegistry` surfaces this as a
  background warning (does not crash the producer, but the schema is not
  registered until reconciled).
- Otherwise → accept and bump version.

Compat mode is declared per-event via `compatibilityMode`:
`'backward' | 'forward' | 'full' | 'none'`. Default is `'backward'`
(consumers expect old fields to remain).

```ts
// Per-event override:
catalog.declare({
  name: 'doc:comment_added',
  schema: { ... },
  transport: 'signal',
  producer: 'platform-api',
  compatibilityMode: 'full',   // strictest — neither side may break
});
```

---

## 7. Phase roadmap (where we are)

The full plan lives in `ROADMAP.md`. Status as of the 2026-05-15 vision
refresh:

| Phase | Goal | Status |
|---|---|---|
| **E1** Universal declarations | `CLAUDE.md` + `CONSTITUTION.md` + `ROADMAP.md` + this doc | ✅ done |
| **E2** Adopt across producers | platform-api, gateway, LVS all consume the library | ✅ done |
| **E3** Signal/durable as peers | `transport: 'both'`, queue auto-provision, aliases, discriminator, channel resolution | ✅ done |
| **E4** Strict-mode registry | Library + service strict declare, topology API, subscriber tracking, admin UI v1, OpenAPI spec | ✅ done |
| **E5** DLQ replay automation | DLQ browser + batch redrive + per-event retention | ✅ done (E5.1–5.3) |
| **E6** Schema fingerprinting | sha256 of sorted-key serialization on `RegistryEntry` + GET surfaces + 409 enrichment + history fingerprints + UI chip | ✅ done |
| **E7** Namespaces | Optional `namespace` field with auto-derive in v0.4; backfill across 98 declarations | ✅ E7.1+E7.2 done; E7.3 (hard-require in v0.5) future |
| **E8** Live flow observability | Process-internal tap emitter, SSE `/api/flow`, topology + live-flow admin UI views, namespace clusters | ✅ done |

Explicitly dropped per the 2026-05-15 refresh: cross-region propagation
(former E5.4 — no second region planned). Multi-tenancy, code generation,
streaming consumer groups stay out of scope.

---

## Quick decision tree

```
Do you emit or consume a cross-service event?
├── No  → don't add event-catalog.
└── Yes → add the library. Declare your events in *your* repo.
          │
          ├── Need cross-service discovery / DLQ / strict gating?
          │   └── Run the service too. Point `registryUrl` at it.
          │
          └── Library-only is fine. The service is optional.
```

Anti-patterns:

- ❌ POSTing declarations directly to the service from a non-library
  caller. The library handles sync; bypassing it splits the registry.
- ❌ Treating the service as a message broker. It isn't. Messages flow
  over Redis / message-queue.
- ❌ Declaring another service's events in your repo. Producer owns the
  declaration (exception: library-emitted events live in
  `src/declarations/`).
- ❌ Using `publishSignal` for events you haven't declared. It works (with
  a warn log) but defeats the entire point of routing through the catalog.

## See also

- `ROADMAP.md` — full phase plan with success criteria.
- `.agent/CONSTITUTION.md` — charter, anti-goals, daily cap.
- `src/types/index.ts` — every field of `EventDeclaration` documented inline.
- `src/types/envelopes.ts` — `ChannelMessageEnvelope` wire contract.
