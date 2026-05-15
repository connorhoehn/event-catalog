# event-catalog Roadmap

> Authoritative source. Drafted 2026-05-13 alongside the multi-agent platform
> audit that established the M1–M4 platform milestones. **Refreshed 2026-05-15**
> with a sharpened vision: this is an *exchange* for contracts plus an
> *observability layer* on the flow, not merely a schema registry.

## Charter (one paragraph)

event-catalog is the authoritative declaration of every cross-service event in
the platform, **plus the operator surface that makes those flows visible in
real time**. It validates schemas at publish time via an in-process library
(fast path, zero network) and provides central inventory, compatibility
enforcement, subscriber topology, dead-letter inspection, fingerprint-based
drift detection, and an admin UI showing live event flow via a service tier.
It covers **both** durable (SQS-style, via `message-queue`) and signal
(WS-style, via Redis pub/sub) events. It is not a broker; messages flow over
Redis and message-queue, not through this service.

## 2026-05-15 vision refresh

The system is event-driven; what was missing was visibility. The refreshed
direction sharpens three threads and explicitly drops one:

- **Promoted from deferred:** *fingerprinting* (Phase E6). Was "wait until a
  consumer asks." Now ship — it's foundational to the drift-detection story.
- **New phase: namespaces** (Phase E7). Organize ~110 declared events into
  domain groups (`pipeline`, `ws`, `sfu`, `social`, ...) for UI/API ergonomics
  and a clear filter axis. **Not multi-tenancy** — single-platform-single-tenant
  stays the model.
- **New phase: live flow observability** (Phase E8). The admin UI must show
  events firing in real time using the shared node-editor component from
  `~/Projects/ui-components` (the same one the gateway uses for pipeline
  replay). Tap endpoint on the server, animated edges in the UI.
- **Dropped: cross-region (formerly E5.4).** No second region planned; not on
  the roadmap.

## Why this exists now

The 2026-05-13 audit established that ~75 distinct cross-service event names
flow today across six sibling repos; only ~21 are declared (all in
`platform-api`). distributed-core's ~28 pipeline events, gateway's ~20 WS frame
types, and live-video-streaming's ~25 chat-bus / SFU control / webhook events
are unregistered. The system is event-driven without an event registry. That
gap produces concrete bugs (e.g., SFU `chatBans.js` events silently dropped
because of casing drift on the same Redis channel) and forces hand-rolled
envelope construction in multiple places (`platform-api/src/lib/event-catalog.ts:443`
and `websocket-gateway/src/core/message-router.js:463` both build the
`channel_message` envelope; neither validates it).

## Reality check (v0.1.0 today)

What's already in place — building blocks the roadmap composes:

- ✅ `TransportType = 'signal' | 'durable'` (`src/types/index.ts:1`). Vocabulary
  is correct; what's missing is adoption.
- ✅ `SignalTransport` (Redis pub/sub) and `DurableTransport` (HTTP → message-queue)
  shipped at `src/client/signal.ts` and `src/client/durable.ts`.
- ✅ JSON Schema declarations with backward / forward / full compat checking
  at `src/registry/schema-compat.ts`.
- ✅ DDB-backed DLQ store at `src/server/dlq-store.ts`.
- ✅ Express admin server on `:3010` at `src/server/`.
- ✅ Local validation via `Registry.validate()` before publish at
  `src/client/index.ts:94`. (Hybrid model is already half-implemented.)
- ✅ Remote registry sync at `src/client/index.ts:224` (`syncToRemoteRegistry`).

What's missing:

- ⚠ Only one consumer (`platform-api`). websocket-gateway, SFU, distributed-core,
  message-queue do **not** import the library.
- ⚠ Admin UI is a skeleton (no real components).
- ⚠ No CLAUDE.md, no CONSTITUTION.md, no ROADMAP.md before this writeup. This
  is the most cited reason "no agent prioritizes event-catalog work."
- ⚠ Observability is `console.log` only. No structured logger, no metrics
  endpoint instrumentation, no `/health` HEALTHCHECK in Dockerfile.
- ⚠ No K8s manifests / Helm chart.
- ⚠ `publishSignal()` in platform-api **bypasses** the catalog and writes
  directly to Redis. Schemas aren't actually validated on the WS path today.
- ⚠ `DurableTransport.eventNameToQueueName()` is a convention, not a contract;
  no glue ensures the message-queue queue's settings match the declaration.

## Phases

### Phase E1 — Declare the contract (1–2 days) ✅ COMPLETE

**Goal:** event-catalog has stated direction, a north star, and an agent
context document so any agent claiming work on it has a starting point.

- [x] Write `.agent/CONSTITUTION.md` (charter, scope, anti-goals, daily cap,
  cross-repo contracts).
- [x] Write `CLAUDE.md` (agent context, architecture in a paragraph, local
  dev, consumer status table).
- [x] Write `ROADMAP.md` (this file).
- [x] Add `docs/architecture.md` explaining the hybrid library + service model.
- [x] Add `docs/contracts/event-declaration.md` documenting every field of
  `EventDeclaration` and `EventEnvelope` with examples (wave16-a).

### Phase E2 — Pull gateway + SFU in as declared producers (1–2 weeks) ✅ COMPLETE

**Goal:** Stop the "only one of three potential clients" smell. Every
cross-service event gets a declaration.

- [x] **E2.1: Extract `channel_message` envelope to shared type.** Shipped in
  Phase 55 (envelope + builders) and finished in wave18-a/b/c (JSON Schemas;
  direct + broadcast envelope builders; gateway swapped off its hand-rolled
  literals). Released as event-catalog v0.3.7.

- [x] **E2.2: Add `@connorhoehn/event-catalog` to `websocket-gateway/package.json`.**
  Declare gateway WS frame types as signal events with JSON Schemas:
  `presence`, `chat`, `cursor`, `crdt:update`, `crdt:snapshot`, `activity`,
  `activity:event`, `reaction`, `social`, `call`, `pipeline:event`,
  `pipeline:snapshot`, `pipeline:history`, `ingest:event`, `documents:presence`,
  `error`. ~20 declarations.

- [x] **E2.3: SFU declarations in `live-video-streaming/src/event-declarations.js`.**
  Shipped as wave17-a/b/c — 19 SFU events declared with best-effort registration
  to the catalog at SFU boot. Chat-bus casing kept as-is (IVS parity preserved);
  architectural ambiguity captured in `docs/handoffs/2026-05-15-lvs-chat-bus-architecture.md`.

  *Historical context: the original E2.3 directive said "do not edit LVS;
  file a handoff." The 2026-05-15 confirmation that LVS is inactive permitted
  direct edits.*

- [ ] ~~**E2.3 (legacy text)** — Coordinate with the live-video-streaming agent~~ via handoff to
  declare SFU events:
    - Chat-bus events (`user.banned`, `user.unbanned`, `chat.message`,
      `chat.message_deleted`, `chat.user_disconnected`). **Canonicalize casing
      here** — this fixes the silent-drop bug at
      `live-video-streaming/src/api/channels/chatBans.js:44` vs.
      `live-video-streaming/src/chat/ChatHub.js:208`.
    - SFU control events (`producer.added`, `producer.removed`,
      `participant.joined`, `participant.left`, `sfu:router:created`,
      `sfu:pipe:created`, `sfu:pipe:connected`).
    - Webhook events as `durable`: `stream.started`, `stream.ended`,
      `stream.health.degraded`, `stream.health.recovered`,
      `stream.thumbnail.updated`, `recording.started`, `recording.completed`,
      `channel.created`, `channel.updated`, `channel.deleted`,
      `session.created`, `session.ended`.

  ✋ **Do not directly edit live-video-streaming files** — that repo is owned
  by another agent. File a handoff with the proposed declarations and let the
  LVS agent commit them.

- [x] **E2.4: Declare distributed-core's pipeline events.** Shipped in
  earlier waves (pipeline-p1, pipeline-p2, pipeline-raft declaration modules,
  ~36 events total).

**Success criteria:**
- `grep -r 'channel_message' platform-api websocket-gateway` finds only
  imports of the shared type, no inline construction.
- `GET /api/events?producer=websocket-gateway` returns ≥15 declared events.
- `GET /api/events?producer=sfu-cluster` returns ≥20 declared events
  (after LVS agent commits).
- SFU chat-bus casing drift is closed (both publishers use the canonical
  declared shape).

### Phase E3 — Treat signal and durable as first-class peers (2–3 weeks) ✅ COMPLETE

**Goal:** The current `EventDeclaration` schema treats both transports
homogeneously. They're not. Durable needs additional metadata signal doesn't,
and signal needs metadata durable doesn't.

Schema-evolve `EventDeclaration` additively (existing declarations keep
working without changes):

```ts
type EventDeclaration = {
  name: string;
  schema: JsonSchema;
  transport: 'signal' | 'durable' | 'both';   // NEW 'both'
  producer: string | string[];                  // multiple producers
  description?: string;
  tags?: string[];
  version?: number;
  compatibilityMode?: 'backward'|'forward'|'full'|'none';

  // Signal-only:
  channel?: string | ((payload) => string);     // Redis channel pattern
  discriminator?: { field: string; values: string[] };  // for envelope events

  // Durable-only:
  queue?: string;                               // override default name mapping
  retention?: number;                           // seconds
  fifo?: boolean;
  partitionKey?: (payload) => string;
  dlqAfterAttempts?: number;

  // Both:
  aliases?: { name: string; deprecated: true; until?: string }[];
};
```

Why each addition:

- **`transport: 'both'`** — for `pipeline.run.completed`, `recording.completed`,
  `stream.ended`. Today these require two declarations with different names
  (`social:post` signal + `social.post.created` durable). One declaration with
  `'both'` lets `catalog.publish()` fan out to both transports.
- **`producer: string[]`** — `pipeline.run.completed` has two producers today
  (distributed-core's `PipelineExecutor` AND platform-api's `bootstrap.ts:745`).
  Reconciling to one is a separate refactor; for now, model the reality.
- **`channel?`** — declared Redis channel pattern. Catalog can validate the
  signal publish channel matches the declaration.
- **`discriminator?`** — `ingest:progress` carries 10 sub-shapes via
  `payload.type` (see `platform-api/src/ingest/types.ts:253-262`); today the
  registry sees one schema and 10 effective contracts.
- **Durable-only fields** — mirror message-queue's per-queue config
  (visibility timeout, FIFO, retention). On declare, event-catalog ensures
  the queue exists with matching settings via idempotent
  `PUT /api/v1/queues/{name}`.
- **`aliases?`** — replaces gateway's hardcoded `DEPRECATED_DUAL_EMIT_ALIASES`
  set (currently in `gateway/src/pipeline-bridge/pipeline-bridge.js:84`) with a
  declaration. Catalog auto-suppresses the deprecated half during fan-out.

Tasks:

- [x] **E3.1**: Schema-evolve `EventDeclaration` (additive, no break).
- [x] **E3.2**: `DurableTransport` reads queue config from declaration and
  provisions via idempotent PUT on first publish per process.
- [x] **E3.3**: `SignalTransport` honors declared channel pattern (wave16-b).
- [x] **E3.4**: `transport: 'both'` fan-out in `EventCatalog.publish()`.
- [x] **E3.5**: `aliases?` suppression in catalog publish path (wave16-c).
- [x] **E3.6**: Discriminator validation at publish time.

**Success criteria:**
- A single declaration for `pipeline.run.completed` produces both signal and
  durable publishes.
- The hardcoded `DEPRECATED_DUAL_EMIT_ALIASES` in gateway can be deleted
  (suppression now driven by event-catalog declarations).
- `ingest:progress` is declared with 10 discriminator values; invalid sub-types
  fail validation at publish.
- Declaring an event with `queue: 'social-posts'` automatically provisions
  that queue on message-queue with the declared retention / FIFO settings.

### Phase E4 — Make the registry enforcing (3–4 weeks) ✅ COMPLETE

**Goal:** Today compat violations are *logged*, not blocked. Schemas are
declared at module load but never centrally collected. There's no compat gate
on schema evolution.

- [x] **E4.1 — Strict library-side declare.** `EventCatalog.declare()` throws
  on compat violation when `EVENT_CATALOG_STRICT=true`.
- [x] **E4.2 — Compat-gated service-side declare.** `POST /api/events` returns
  409 on compat-breaking declarations under strict mode.
- [x] **E4.3 — Topology API.** `GET /api/topology` with producer/consumer/
  eventType/transport filters.
- [x] **E4.4 — Subscriber tracking by service.** POST/DELETE
  `/api/events/:name/subscribers/:serviceName`.
- [x] **E4.5 — Admin UI Phase 1.** Vite + React scaffold with Dashboard,
  EventList, EventDetail, TopologyView, TransportHealth, LiveInspector,
  DeclarationViewer, DLQBrowser components. (Topology gets a major refresh
  in Phase E8 using the shared node editor.)
- [x] **E4.6 — OpenAPI spec** at `openapi/event-catalog.yaml` (wave16-d).

**Success criteria:**
- A deploy that ships a schema-breaking change to a registered event fails
  rather than ships silently.
- An operator can answer "who consumes `social.post.created`?" in one query.
- The admin UI shows the topology graph live as services start and register.

### Phase E5 — DLQ replay (2–3 weeks) ✅ COMPLETE

**Goal:** At 10x scale, operators redrive DLQ entries from the admin UI without
code changes.

- [x] **E5.1 — DLQ browser** (admin UI + `GET/DELETE/POST` server routes).
- [x] **E5.2 — Batch redrive** (`POST /api/transports/durable/dlq/replay`
  + selection UI; wave16-f).
- [x] **E5.3 — Per-event DLQ retention** via `EventDeclaration.dlqRetention`
  (wave16-e).
- ~~E5.4 — Cross-region propagation~~ — **DROPPED 2026-05-15.** No second
  region planned.
- ~~E5.5 — Schema fingerprinting~~ — **PROMOTED to Phase E6** below.

### Phase E6 — Schema fingerprinting (1 wave — in progress) 🎯

**Goal:** Deterministic content-addressable identifier for each schema so
consumers detect drift locally (cache + compare) without a registry round-trip.

- [x] **E6.1 — Sorted-key stableStringify + sha256** in `src/registry/fingerprint.ts`
  (wave19-b).
- [x] **E6.2 — `schemaFingerprint: string` on `RegistryEntry`** computed at
  declare-time, recomputed when schema changes.
- [x] **E6.3 — Surface on `GET /api/events`, `GET /api/events/:name`,
  `POST /api/events` 201 response.**
- [x] **E6.4 — Enrich 409 `COMPAT_VIOLATION`** with `currentFingerprint` +
  `proposedFingerprint` so callers diff in one round-trip.
- [ ] **E6.5 — History fingerprints on `SchemaHistoryEntry`** (V2, deferred —
  promote when a consumer wants "is my cached version in your history?").
- [ ] **E6.6 — Admin UI display.** Short 12-char prefix on event detail page,
  schema-diff fingerprint deltas. (Phase E8 work.)

**Success criteria:**
- `GET /api/events/:name` returns a stable 64-char hex `schemaFingerprint`.
- Re-declaring with identical-shape-but-different-key-order produces the same
  fingerprint (no spurious version bump from key reordering).
- A breaking re-declare under strict mode returns 409 with both fingerprints.

### Phase E7 — Namespaces (2 waves — planned)

**Goal:** Organize ~110 declared events into domain groups for ergonomic
filtering, admin-UI grouping, and a clear filter axis on the live-flow view.
Explicitly **not multi-tenancy**.

- [ ] **E7.1 — Add `namespace?: string` to `EventDeclaration`** with
  auto-derive from dotted prefix (`name.split('.')[0]`) when missing. Filter
  on `GET /api/events?namespace=X` and `GET /api/topology?namespace=X`. Tag
  release v0.3.9.
- [ ] **E7.2 — Backfill explicit namespaces** across all declarations:
  `event-catalog/src/declarations/*.ts`, `live-video-streaming/src/event-declarations.js`,
  `websocket-gateway/src/observability/gateway-event-declarations.ts`. Bump
  event-catalog pin in LVS and gateway.
- [ ] **E7.3 — Hard-required namespace in v0.5** (future) — remove
  auto-derive, lint at declaration time.

**Audit:** 4 clean domains today (`pipeline` 36, `ws` 41, `sfu` 22,
service-level 13). No cross-namespace events; no migration ambiguity.

**Success criteria:**
- `GET /api/events?namespace=sfu` returns only SFU events.
- Admin UI groups events by namespace with tabs/pills.
- Live-flow view (Phase E8) accepts namespace as a filter.

### Phase E8 — Live flow observability (2 waves — planned)

**Goal:** Operators see events firing in real time. The admin UI gets a
"Flow" view using the **shared `PipelineCanvas` node editor from
`~/Projects/ui-components/src/components/pipelines/`** — the same component
`websocket-gateway` already uses for pipeline replay.

- [ ] **E8.1 — Server-side tap (SSE).** Process-internal `EventEmitter` patched
  into `SignalTransport.publish` and `DurableTransport.publish`. New
  `GET /api/flow` SSE endpoint with filters `?eventName, ?transport, ?producer,
  ?namespace, ?sample`. Tag release v0.3.10.
- [ ] **E8.2 — Admin UI: Topology refresh.** Replace existing topology
  component with `PipelineCanvas`-driven graph. Custom `EventNode` +
  `ServiceNode` types; dagre layout from existing utility.
- [ ] **E8.3 — Admin UI: Live flow overlay.** SSE client subscribes to
  `/api/flow`; maps incoming events to `replayEdgeStates` dict (`active` →
  fade after 800ms). Pause/resume, sample slider, filter controls.
- [ ] **E8.4 — Namespace clustering** on the graph (SVG overlay), plus
  fingerprint chip on event detail panes (closes E6.6).

**Success criteria:**
- Operator opens the admin UI's Flow tab, sees events pulsing on edges
  in real time without leaving the browser.
- Filter pills work for transport / namespace / producer.
- Visual style matches the gateway's pipeline-replay view (shared node-editor
  component).

## What event-catalog will never be

- Not a broker. Messages flow over Redis (signal) and message-queue (durable).
- Not on the WebRTC media plane. Only SFU *control* events register.
- Not the auth layer.
- Not a code-generation tool.

## Decisions made

| Decision | Why | When |
|---|---|---|
| Hybrid library + service (option c) | Library-only loses cross-team topology; service-only adds a network hop per publish (deal-breaker at gateway fan-out volumes) | 2026-05-13 audit |
| JSON Schema, not zod / Ajv-replacement | User preference: no runtime schema libs unless an incident motivates it (see memory `feedback_no_runtime_schema_libs`) | Pre-existing |
| Cover both transports | The whole point — single registry for the platform | 2026-05-13 audit |
| `EventDeclaration` evolves additively | Existing declarations must keep working | This roadmap |
| event-catalog never holds business state | Avoid becoming Consul / ZooKeeper | This roadmap |
| SFU declarations land via handoff to LVS agent | That repo has its own agent; respect the boundary | 2026-05-13 user instruction |
| Reframe as "exchange + observability surface" | Value is visibility, not storage; topology + flow + drift detection in one place | 2026-05-15 refresh |
| Explicit `namespace` field with auto-derive | DRY-avoiding, handles single-word frames, soft-migrate via auto-derive | 2026-05-15 (Agent 2 audit + recommendation) |
| Flow viz reuses gateway's `PipelineCanvas` | Same node-editor used for pipeline replay; consistent visual language across platform UIs | 2026-05-15 user instruction |

## Risks

- **R1: distributed-core pin drift.** Gateway pins `#v0.14.2` (tag); platform-api,
  event-catalog, message-queue float on `#main`. Any deprecation removal in
  0.15 / 0.16 silently breaks gateway when lockfile is regenerated. **Mitigation:**
  reconcile pins before E3 changes `DurableTransport` (which uses
  distributed-core's RetryManager / CircuitBreaker).

- **R2: LVS agent contention.** SFU declarations require coordination with the
  live-video-streaming agent. **Mitigation:** propose declarations via handoff
  with full JSON Schemas attached; don't directly commit to that repo.

- **R3: E4 enforcement breaking existing producers.** Strict-mode declare
  could refuse declarations that "worked" before just because the inferred
  history wasn't tracked. **Mitigation:** strict mode is opt-in via env var;
  ship E4.1 + E4.2 with a 2-week soak period before enabling in prod.

- **R4: Admin UI scope creep.** Once a UI exists, every operator concern wants
  to live there. **Mitigation:** scope UI strictly to event-catalog concerns
  (schemas, topology, compat, DLQ); push other operator UIs to their own
  services.

- **R5: Discriminator complexity.** `ingest:progress` with 10 sub-types is the
  worst case. If many more events need discriminators, may need a richer model
  (sub-schemas per discriminator value). **Mitigation:** ship E3.6 with the
  simple model; revisit if a 20+ value discriminator appears.

## Out of scope (now and probably forever)

- **Multi-tenancy.** Single-platform, single-tenant. (Note: *namespaces*
  for organizing events within the single tenant ARE in scope — see
  Phase E7. They were lumped with multi-tenancy in the 2026-05-13 draft;
  the 2026-05-15 refresh separated them.)
- **Cross-region propagation.** Dropped 2026-05-15 — no second region planned.
- Streaming subscribe (Kafka-style consumer groups against the catalog).
- Code generation from schemas. Consumers derive TypeScript types via shared
  exports if needed.
- Runtime contract testing (event replay against a recorded golden set).
- Replacing message-queue's per-queue schema validation. Per-queue validation
  stays in message-queue; event-catalog declares what *should* be valid.
