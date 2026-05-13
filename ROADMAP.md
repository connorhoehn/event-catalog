# event-catalog Roadmap

> Authoritative source. Drafted 2026-05-13 alongside the multi-agent platform
> audit that established the M1–M4 platform milestones (see
> `~/.claude/projects/-Users-connorhoehn-Projects-websocket-gateway/memory/`).

## Charter (one paragraph)

event-catalog is the authoritative declaration of every cross-service event in
the platform. It validates schemas at publish time via an in-process library
(fast path, zero network) and provides central inventory, compatibility
enforcement, subscriber topology, dead-letter inspection, and admin UI via a
service tier. It covers **both** durable (SQS-style, via `message-queue`) and
signal (WS-style, via Redis pub/sub) events. It is not a broker; messages flow
over Redis and message-queue, not through this service.

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

### Phase E1 — Declare the contract (1–2 days)

**Goal:** event-catalog has stated direction, a north star, and an agent
context document so any agent claiming work on it has a starting point.

- [x] Write `.agent/CONSTITUTION.md` (charter, scope, anti-goals, daily cap,
  cross-repo contracts).
- [x] Write `CLAUDE.md` (agent context, architecture in a paragraph, local
  dev, consumer status table).
- [x] Write `ROADMAP.md` (this file).
- [ ] Add `docs/architecture.md` explaining the hybrid library + service model
  (when to declare in-code vs. POST to registry; how `syncToRemoteRegistry`
  reconciles them).
- [ ] Add `docs/contracts/event-declaration.md` documenting every field of
  `EventDeclaration` and `EventEnvelope` with examples.

**Success criteria:**
- Any new agent claiming a task on this repo can answer "what is event-catalog
  for, and what does its API look like?" by reading three files.
- The hybrid model (library half + service half) is explicit, not implicit.

### Phase E2 — Pull gateway + SFU in as declared producers (1–2 weeks)

**Goal:** Stop the "only one of three potential clients" smell. Every
cross-service event gets a declaration.

- [ ] **E2.1: Extract `channel_message` envelope to shared type.** Move the
  envelope shape into `event-catalog/src/types/envelopes.ts` as a TypeScript
  type AND JSON Schema. Replace hand-rolled constructors:
    - `platform-api/src/lib/event-catalog.ts:443`
    - `websocket-gateway/src/core/message-router.js:463`
  Both import the shared type. Smallest possible M1 adoption proof.

- [ ] **E2.2: Add `@connorhoehn/event-catalog` to `websocket-gateway/package.json`.**
  Declare gateway WS frame types as signal events with JSON Schemas:
  `presence`, `chat`, `cursor`, `crdt:update`, `crdt:snapshot`, `activity`,
  `activity:event`, `reaction`, `social`, `call`, `pipeline:event`,
  `pipeline:snapshot`, `pipeline:history`, `ingest:event`, `documents:presence`,
  `error`. ~20 declarations.

- [ ] **E2.3: Coordinate with the live-video-streaming agent** via handoff to
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

- [ ] **E2.4: Declare distributed-core's pipeline events** in `platform-api`
  (on distributed-core's behalf, since DC is a library):
    - All 28 colon-form events (`pipeline:run:started`, `pipeline:step:*`,
      `pipeline:llm:*`, `pipeline:approval:*`, `pipeline:join:*`, etc.)
    - Mark dot-form aliases as deprecated (depends on E3 `aliases?` field).

**Success criteria:**
- `grep -r 'channel_message' platform-api websocket-gateway` finds only
  imports of the shared type, no inline construction.
- `GET /api/events?producer=websocket-gateway` returns ≥15 declared events.
- `GET /api/events?producer=sfu-cluster` returns ≥20 declared events
  (after LVS agent commits).
- SFU chat-bus casing drift is closed (both publishers use the canonical
  declared shape).

### Phase E3 — Treat signal and durable as first-class peers (2–3 weeks)

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

- [ ] **E3.1**: Schema-evolve `EventDeclaration` (additive, no break).
- [ ] **E3.2**: Update `DurableTransport` to read queue config from declaration
  and provision via idempotent PUT on first publish per process.
- [ ] **E3.3**: Update `SignalTransport` to use declared channel pattern;
  validate channel matches the declaration (warn in dev, error in strict mode).
- [ ] **E3.4**: Implement `transport: 'both'` fan-out in `EventCatalog.publish()`.
- [ ] **E3.5**: Implement `aliases?` suppression in the catalog publish path,
  with a deprecation log when a deprecated alias is used.
- [ ] **E3.6**: Discriminator validation — when `discriminator` is declared,
  validate that `payload[field]` is in `values`.

**Success criteria:**
- A single declaration for `pipeline.run.completed` produces both signal and
  durable publishes.
- The hardcoded `DEPRECATED_DUAL_EMIT_ALIASES` in gateway can be deleted
  (suppression now driven by event-catalog declarations).
- `ingest:progress` is declared with 10 discriminator values; invalid sub-types
  fail validation at publish.
- Declaring an event with `queue: 'social-posts'` automatically provisions
  that queue on message-queue with the declared retention / FIFO settings.

### Phase E4 — Make the registry enforcing (3–4 weeks)

**Goal:** Today compat violations are *logged*, not blocked. Schemas are
declared at module load but never centrally collected. There's no compat gate
on schema evolution.

- [ ] **E4.1 — Strict library-side declare.** `EventCatalog.declare()` throws
  on compat violation when `EVENT_CATALOG_STRICT=true`. Default off in dev,
  on in prod.
- [ ] **E4.2 — Compat-gated service-side declare.** `POST /api/events` returns
  409 when a declaration would break compat against the registered history.
  Response body lists violations. Existing declarations bump version and
  push old schema to history (capped at 5).
- [ ] **E4.3 — Topology API.** `GET /api/topology` returns the
  producer→eventName→consumers graph. Subscribers register via the existing
  `syncToRemoteRegistry`, extended to also POST subscription declarations on
  service boot.
- [ ] **E4.4 — Subscriber tracking by service.** Each `EventCatalog` instance
  posts its `serviceName` + subscribed events on startup. Catalog server
  maintains a per-service subscriber map. TTL-based liveness (last-seen
  heartbeat).
- [ ] **E4.5 — Admin UI Phase 1.** Vite + React using `@connorhoehn/ui-components`.
    - Event browser: list, filter by producer/transport/tag, schema viewer
      with JSON Schema rendering.
    - Topology graph: visual producer→event→consumers (use a force-directed
      graph or simple grouped lists).
    - Version history per event with diff view.
    - Compat-violation log (catalog server records every failed declare for
      operator visibility).
- [ ] **E4.6 — OpenAPI spec** at `openapi/event-catalog.yaml`. SDK generation
  is a non-goal; the spec is for documentation and tooling.

**Success criteria:**
- A deploy that ships a schema-breaking change to a registered event fails
  rather than ships silently.
- An operator can answer "who consumes `social.post.created`?" in one query.
- The admin UI shows the topology graph live as services start and register.

### Phase E5 — DLQ replay + cross-region (2–3 weeks)

**Goal:** At 10x scale you need to redrive DLQ entries from the admin UI
without code changes. Multi-region is on the horizon but not now.

- [ ] **E5.1 — DLQ browser.** Admin UI Phase 2. List DLQ entries (filterable
  by event name, time, producer). Inspect payload + error. Redrive with
  idempotency-keyed reposting into the source queue on message-queue.
- [ ] **E5.2 — Batch redrive.** Select N entries, redrive with one click.
  Idempotency keys prevent duplicate delivery if redrive partially fails.
- [ ] **E5.3 — DLQ retention policy.** Per-event retention for DLQ entries
  (today: hardcoded 30 days). Declarable via `EventDeclaration.dlqRetention`.
- [ ] **E5.4 — Cross-region propagation (DEFERRED).** Schema changes propagate
  across regions via `distributed-core`'s `CrossDCReplicator`. Defer until
  a second region exists. Track as `docs/specs/cross-region.md` only.
- [ ] **E5.5 — Schema fingerprinting (DEFERRED).** Wire-level compatibility
  check — fingerprint a declaration so consumers can detect "did the schema
  I'm reading change?" without a network call. Already half-built via
  `version` + history; promote when a real consumer needs it.

**Success criteria:**
- Operator can redrive a poison message via the admin UI without code changes.
- DLQ retention is per-event, not global.
- Cross-region work has a design doc but no implementation (correct posture
  until there's a 2nd region).

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

- Multi-tenancy / multi-platform namespaces.
- Streaming subscribe (Kafka-style consumer groups against the catalog).
- Code generation from schemas. Consumers derive TypeScript types via shared
  exports if needed.
- Runtime contract testing (event replay against a recorded golden set).
- Replacing message-queue's per-queue schema validation. Per-queue validation
  stays in message-queue; event-catalog declares what *should* be valid.
