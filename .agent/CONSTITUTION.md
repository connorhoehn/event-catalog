# Constitution: event-catalog

> A living document. Edit deliberately and explain the reason in commit messages.
> Workers re-read this on every `/clear` between tasks; it is the north star
> when no task has been dispatched and self-driven work needs to be chosen.

## Mission

Be the authoritative declaration of every cross-service event in the platform.
Cover **both** durable (SQS-style, persisted, retryable, DLQ-backed) and signal
(WebSocket-style, ephemeral, fire-and-forget, Redis pub/sub) events. Validate
schemas at publish time via an in-process library and provide central inventory,
compatibility enforcement, subscriber topology, dead-letter inspection, and
admin UI via a service tier.

## Scope

**This project IS:**
- A TypeScript library (`@connorhoehn/event-catalog`) for in-process schema
  declarations, validation, and transport routing.
- A standalone HTTP service (`:3010`, distributed-core AdmissionHttpServer)
  for cross-team event discovery, compatibility gating, topology
  visualization, and DLQ inspection.
- The owner of the event-envelope shape and the canonical event registry.
- A hybrid: library half is the runtime fast-path (no network on publish);
  service half is the governance + admin tier.

**This project IS NOT:**
- A message broker. Messages flow over Redis (signal) and `message-queue` (durable).
  event-catalog only declares.
- On the WebRTC media plane. SFU media frames are not events. SFU *control*
  events (participant joined, recording started, stream health changed) are.
- The auth layer. Identity verification stays with platform-api / edge-gateway / Cognito.
- A code-generation tool. Schemas are JSON Schema; consumers can derive types
  via shared TypeScript exports, but no codegen step is shipped.
- A multi-tenant catalog. Single-platform, single-namespace today.

## Cross-platform position

event-catalog is one of seven long-running services (or library + service pairs)
in the platform target topology established by the 2026-05-13 system audit:

1. **edge-gateway** — stateless WS connection plane.
2. **realtime-fanout** — CRDT / presence / chat owner (split from current
   `websocket-gateway`).
3. **platform-api** — HTTP CRUD + outbox writer.
4. **pipeline-worker** — split from current `platform-api`; consumes durable
   pipeline events.
5. **message-queue** — SQS-style durable backbone.
6. **event-catalog** — this project.
7. **sfu-cluster** — `live-video-streaming` mediasoup SFU.

`distributed-core` stays a library + k8s operator; it never becomes a runtime
service.

event-catalog is the **gating milestone (M1)** for the platform: M2 (durable
backbone), M3 (gateway split), M4 (pipeline-worker split + SFU /sessions) all
assume that cross-service events are declared and validated.

## Principles (non-negotiable)

1. **Library-side validation is the fast path.** `EventCatalog.publish()` runs
   schema validation in-process via the locally-bundled schema registry. No
   network hop on the hot path.
2. **Service-side is governance, not runtime.** The admin server's job is
   inventory, compat gating, topology, DLQ inspection, admin UI. If a producer
   can't reach the server, it must still publish (cached schemas, eventual
   sync via `syncToRemoteRegistry`).
3. **Schemas live next to producers.** Each service declares its events in its
   own source tree at module load; declarations sync to the central registry
   via background HTTP. No central "schema repo" to PR against.
4. **Additive over breaking.** EventDeclaration fields evolve additively. New
   fields land with defaults; readers ignore unknown fields. Removing a field
   requires a deprecation cycle.
5. **Versioning is on the schema, not on the event name.** Schema history is
   tracked per event; compat checks against the prior versions. Aliases
   handle name evolution (e.g., colon-form → dot-form pipeline events).
6. **Linear history.** Rebase, don't merge. Commits small + atomic. Reference
   hub task ids in commit bodies.

## Anti-goals

- **Don't become a broker.** Tempting to add "publish via event-catalog HTTP"
  for testability. Resist — it adds a hop and a SPOF. Library-side publish is
  the contract.
- **Don't add runtime schema-validation libraries (zod, ts-rest, tRPC).**
  See user memory `feedback_no_runtime_schema_libs`. JSON Schema + a small
  validator is the chosen surface.
- **Don't model the SFU media plane.** Only control events (participant joined,
  recording lifecycle, stream health) register here. Media frames stay opaque.
- **Don't pre-build multi-region.** Defer cross-region schema propagation until
  a second region exists.
- **Don't ship the admin UI before the topology API.** UI eats topology data;
  topology must be real first.

## Current phase

**Roadmap complete (2026-08-16).** All phases E1–E8 shipped — see
`ROADMAP.md` and `CHANGELOG.md` for what exists. v0.4.0 replaced Express
with distributed-core's `AdmissionHttpServer` per platform standard. Four
consumers: platform-api, websocket-gateway, live-video-streaming,
realtime-modules. Only deferred roadmap item: E7.3 (hard-required
namespace, targeted at v0.5).

There is NO ranked self-driven backlog right now — the previous one (all
five items) shipped. New direction requires operator input; do not invent
phases. Known open threads: publish to GitHub Packages + re-pin consumers
(hub#1493), stale hub#1497 (work done, needs closing), `build:cli` broken
(import.meta under CJS + TapFilter cast).

## Self-driven backlog

Empty by operator intent. Draw only from dispatched tasks and handoffs.

## Good-enhancement criteria

A self-driven task is worth claiming if it satisfies AT LEAST ONE of:

- **Closes a drift hazard** documented in the audit memory
  `critical-drift-hazards.md` (channel_message envelope, pipeline.run.completed
  dual-source, SFU chat-bus casing, etc.).
- **Pulls a new producer onto event-catalog** (declared events that previously
  flew unschema'd).
- **Improves operator visibility** of an existing surface (topology, DLQ count,
  schema version history, compat-violation history).
- **Adds an integration test** for an existing wire-up that has only unit-level
  coverage today.
- **Hardens the DLQ store** (cleanup, redrive, indexed lookups) before the M2
  durable backbone makes it load-bearing.

A self-driven task is **not** worth claiming if it:

- Builds a feature for a hypothetical consumer (e.g., multi-region propagation
  before a second region exists).
- Adds runtime schema libraries (zod, ts-rest, tRPC, Ajv replacement).
- Modifies the SFU's event shape directly — coordinate with the live-video-streaming
  agent via handoff instead.
- Spends more than ~200 LOC across implementation. Larger than that → file a
  blocker for operator review of scope first.

## User-facing framing

"User" of event-catalog means three personas:

- **Producer agent** (a service declaring + publishing events): what's the
  smallest correct call site? "Producers no longer need to hand-roll the
  `channel_message` envelope — `catalog.publish('chat:message', payload)`
  validates and routes."
- **Consumer agent** (a service subscribing): can it filter? Can it know what
  events exist? "Consumers can list every event the gateway emits via
  `GET /api/topology?producer=gateway` instead of grepping the source."
- **Platform operator** (you, on-call): can they answer "who consumes X?" in
  one query? Can they redrive a DLQ entry without code changes? "Operators
  can browse the DLQ in the admin UI and redrive entries with idempotency keys."

**Good user-impact statements:**
- "Consumers can find all 28 distinct pipeline events distributed-core emits
  via topology API instead of grepping `PipelineExecutor.ts`."
- "When a producer declares a schema that breaks backward compat against the
  registered history, deploy fails with a 409 listing the violations — instead
  of silently shipping a wire-format break."
- "The SFU chat-bus casing drift (where `chatBans.js` events were silently
  dropped because `ChatHub.js` reads `payload.Type`, not `payload.type`) is
  now caught at schema-declare time."

**Bad user-impact statements (REJECTED):**
- "Adds `transport: 'both'` to EventDeclaration." (Names the field, not the
  capability.)
- "Improves topology coverage." (Vague; specify which producer or consumer.)

## Affected consumers

- **platform-api** — only current consumer of `@connorhoehn/event-catalog`.
  6 imports across `src/lib/event-catalog.ts`, `src/ingest/catalog-event-bus.ts`,
  `src/pipeline/bootstrap.ts`. Any API surface change here ships with a handoff
  to platform-api.
- **websocket-gateway** — priority adopter (Phase E2). Needs the
  `channel_message` envelope as shared type and the gateway WS frame types
  declared.
- **live-video-streaming** — priority adopter (Phase E2). Needs SFU chat-bus
  + control + webhook events declared. **Coordinate via handoff** — that
  project is being worked by another agent.
- **distributed-core** — never a direct consumer (it's a library). Its pipeline
  events are declared on its behalf by platform-api (which embeds the
  PipelineExecutor) until distributed-core stabilizes its public event surface.
- **message-queue** — never imports event-catalog. The relationship is the
  reverse: event-catalog's `DurableTransport` calls message-queue's HTTP API.
  Phase E3 adds queue-config-from-declaration so the two are bound.

## Cross-repo contracts owned by this repo

- **`EventDeclaration` schema** — `src/types/index.ts`. Evolves additively.
- **`EventEnvelope<T>` shape** — `src/types/index.ts`. `{eventName, payload,
  metadata:{id,producer,timestamp,correlationId?,headers?}}`. Adding fields
  to `metadata` is additive; removing requires a deprecation cycle.
- **HTTP API**: `POST /api/events`, `POST /api/events/bulk`, `GET /api/events`,
  `GET /api/events/:name`, `GET /api/topology` (E4). OpenAPI spec ships with E4.
- **Redis channel naming for signal**: producer's choice today, declared via
  `EventDeclaration.channel` in E3.
- **Queue naming for durable**: `eventNameToQueueName()` converts dot-form to
  hyphen-form (e.g., `social.post.created` → `social-post-created`); declared
  via `EventDeclaration.queue` in E3.

## Workflow conventions

- **Solo project, no PRs.** Stage, commit, push to `main` directly.
- **No destructive ops without explicit ask.** No git resets, force-pushes,
  destructive `aws` / `kubectl` commands.
- **TypeScript strict mode.**
- **Tests required for every exported symbol.** Vitest is the runner.

## Daily cap

**Default: up to 30 self-driven tasks per UTC day per agent session.**
Tracked via the hub: count `task.done` activity rows where `agent_name=self`
AND `detail` contains `[self-driven]` over the last 24 hours.

**Operator override:** if `$AGENT_HUB_ROOT/.budget-event-catalog` exists, read
its integer as today's cap. Read every `/clear` cycle.

When the cap is reached:
1. `append_log("daily cap reached at <N>; idling until next UTC day")`.
2. Optionally file a "daily summary" handoff to operator.
3. `/clear` and stop.

## Constitution review cadence

After every **5 self-driven `task.done` events**, run a constitution review:
1. Read this file.
2. Read the last 5 self-driven done summaries from the hub.
3. Decide: does the constitution still describe what's being built?
4. If YES → log it and continue.
5. If NO → propose an edit to this file via a handoff to operator.

Do NOT silently commit constitution changes.

## Kill-switch

If `$AGENT_HUB_ROOT/.no_self_driven` exists, do NOT enter the self-generation
step. Only execute dispatched work. Idle when the dispatched queue is empty.
