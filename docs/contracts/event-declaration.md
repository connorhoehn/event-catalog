# EventDeclaration & EventEnvelope — field reference

> **Audience:** engineers declaring a new cross-service event, or extending
> an existing one. Pairs with `docs/architecture.md` (the library/service
> split). Source of truth for the field semantics is `src/types/index.ts`.

Every cross-service event in the platform is described by an
`EventDeclaration` and travels in an `EventEnvelope`. Declarations live in
`src/declarations/` (this repo, for library-owned events) or in the
consuming service's own source tree, registered at process start via
`catalog.declare(...)`.

---

## 1. `EventDeclaration`

```ts
interface EventDeclaration {
  // --- always required ---
  name:        string;
  schema:      JsonSchema;
  transport:   'signal' | 'durable' | 'both';
  producer:    string | string[];

  // --- always optional ---
  description?:        string;
  tags?:               string[];
  version?:            number;
  compatibilityMode?:  'backward' | 'forward' | 'full' | 'none';
  compatMode?:         'off' | 'warn' | 'strict';

  // --- signal-only (transport: 'signal' | 'both') ---
  channel?:        string | ((payload) => string);
  discriminator?:  { field: string; values: string[] };

  // --- durable-only (transport: 'durable' | 'both') ---
  queue?:             string;
  retention?:         number;        // seconds
  fifo?:              boolean;
  partitionKey?:      (payload) => string;
  dlqAfterAttempts?:  number;

  // --- both transports ---
  aliases?:  { name: string; deprecated: true; until?: string }[];
}
```

### Always-required fields

| Field | Notes |
|---|---|
| `name` | Canonical, dot-form event name (e.g. `pipeline.approval.requested`). Used as the lookup key in the registry and as the default Redis channel / queue derivation. Deprecated alternates go in `aliases`, not `name`. |
| `schema` | JSON Schema (draft-07). Validated locally on every `publish()` via Ajv. Be specific — `additionalProperties: false` catches typo drift, but is breaking for evolution; pick deliberately. |
| `transport` | `'signal'` (Redis pub/sub, ephemeral), `'durable'` (HTTP → message-queue, persisted/retryable), or `'both'` (fan out to both in `publish()`). |
| `producer` | Service name(s) authorized to emit this event. String for single-producer events; array when an event has multiple authoritative producers (e.g. `pipeline.run.completed` is emitted by both `distributed-core` and `platform-api`). Producer name is recorded in `EventEnvelope.metadata.producer` at publish time. |

### Optional metadata

| Field | Notes |
|---|---|
| `description` | Prose explanation. Surfaces in the admin UI and OpenAPI spec. Write it for the consumer that has to integrate against the event, not the producer that emits it. |
| `tags` | Free-form classification for filtering (`?tag=approval` on `GET /api/events`). Conventional tags: domain (`pipeline`, `chat`, `presence`), priority (`p0`, `p1`), purpose (`audit`, `webhook`). |
| `version` | Server-managed. Bumped automatically by `POST /api/events` when the schema changes. Don't set manually in declarations. |
| `compatibilityMode` | Evolution semantics — what counts as a "compatible" schema change. Defaults to `'backward'` (new schema must accept all messages that satisfied the old one). `'full'` requires both directions; `'none'` disables checking. |
| `compatMode` | Per-event override for the server-side compat *gate* (whether a compat violation returns HTTP 409 or 201-with-advisory). Orthogonal to `compatibilityMode`. See `src/types/index.ts:46-61` for the precedence rules. |

### Signal-only fields

Only meaningful when `transport` is `'signal'` or `'both'`.

| Field | Notes |
|---|---|
| `channel` | Redis channel pattern to publish on. Static string (`'social:posts'`) or a function of the payload (`p => \`document:${p.documentId}\``). Optional — defaults to the event `name` as the channel. |
| `discriminator` | When the payload schema is a union over a sub-type field (e.g. `ingest:progress` carries 10 sub-shapes via `payload.type`), declare `{ field, values }` and the catalog validates the discriminator value at publish time. Catches drift the JSON schema can't (without a giant `oneOf`). |

### Durable-only fields

Only meaningful when `transport` is `'durable'` or `'both'`. Read by
`DurableTransport.ensureQueue()` on first publish to provision the
message-queue queue via idempotent `PUT /queues/{name}`.

| Field | Notes |
|---|---|
| `queue` | Override the default queue-name derivation. The default maps `pipeline.approval.requested` → `pipeline-approval-requested`. Set this when the queue name needs to differ from the event name (e.g. partition by tenant). |
| `retention` | Message retention in seconds. Maps to message-queue's `message_retention_period_seconds`. Pick based on consumer SLA: webhooks usually need ≥7d (604800); audit events 30d+ (2592000). |
| `fifo` | FIFO queue ordering — preserves per-`partitionKey` order. Defaults to false (standard at-least-once). Setting `true` requires `partitionKey`. |
| `partitionKey` | Extractor for the FIFO partition. `p => p.runId` is typical. Messages with the same partition key are delivered in order; different keys may interleave. |
| `dlqAfterAttempts` | Auto-route to DLQ after this many delivery attempts. Catalog ensures a paired DLQ queue named `${queue}-dlq` is provisioned alongside. |

### Cross-transport fields

| Field | Notes |
|---|---|
| `aliases` | Previous names this event was published under. Lets consumers continue to recognize the old name during cutover. Each entry is `{ name, deprecated: true, until? }`. `until` is an ISO-8601 cutoff after which the alias will be removed; absent means indefinite. Replaces hand-rolled suppression sets like the gateway's old `DEPRECATED_DUAL_EMIT_ALIASES`. |

---

## 2. `EventEnvelope`

The wire shape every transport carries. Producers don't build it — `publish()`
does. Subscribers receive it directly.

```ts
interface EventEnvelope<TPayload = unknown> {
  eventName:  string;
  payload:    TPayload;
  metadata:   {
    id:              string;   // ULID assigned at publish time
    producer:        string;   // serviceName from EventCatalogConfig
    timestamp:       number;   // ms since epoch (PublishOptions.timestamp or Date.now())
    correlationId?:  string;
    headers?:        Record<string, string>;
  };
}
```

- `id` is always set, monotonic-ish per process via `ulid()`. Use it for
  idempotency keys downstream.
- `producer` is *not* the value from `EventDeclaration.producer` — it's the
  `serviceName` of the catalog instance that called `publish()`. The
  declaration's `producer` field is the *contract* (who's allowed to emit);
  the envelope's `metadata.producer` is the *fact* (who emitted this one).
- `correlationId` and `headers` are pass-through from `PublishOptions`.
  Convention: pass an incoming HTTP request's trace ID as the
  `correlationId` so downstream events stay correlated.

### Channel-message envelope (gateway signal path)

For `publishSignal(channelId, eventName, payload)` — the gateway broadcast
path — the inner `EventEnvelope` is wrapped in a `ChannelMessageEnvelope`
addressed to specific gateway nodes. See `src/types/envelopes.ts` for
that shape; it's not used by the bare `publish()` path.

---

## 3. Worked examples

### a. Signal-only

A WS frame type, ephemeral, no persistence.

```ts
{
  name: 'ws.presence.update',
  transport: 'signal',
  producer: 'websocket-gateway',
  description: 'A user\'s presence state changed (online/away/offline).',
  tags: ['presence', 'ws'],
  schema: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      state:  { type: 'string', enum: ['online', 'away', 'offline'] },
      at:     { type: 'string', format: 'date-time' },
    },
    required: ['userId', 'state', 'at'],
  },
}
```

### b. Durable-only

A webhook payload that must survive consumer downtime.

```ts
{
  name: 'stream.ended',
  transport: 'durable',
  producer: 'live-video-streaming',
  description: 'A live stream session has ended. Final stats payload.',
  tags: ['webhook', 'streaming'],
  retention: 604800,              // 7d
  dlqAfterAttempts: 5,
  schema: {
    type: 'object',
    properties: {
      streamId:    { type: 'string' },
      endedAt:     { type: 'string', format: 'date-time' },
      durationMs:  { type: 'integer', minimum: 0 },
      reason:      { type: 'string', enum: ['user-stopped', 'timeout', 'error'] },
    },
    required: ['streamId', 'endedAt', 'durationMs', 'reason'],
  },
}
```

### c. `'both'` — signal + durable fan-out

Approval events: the WS-connected operator UI needs them live (signal); the
worker that resumes the run needs them to survive a restart (durable). One
declaration, one `publish()`, two transports.

```ts
{
  name: 'pipeline.approval.requested',
  transport: 'both',
  producer: ['distributed-core', 'platform-api'],
  tags: ['pipeline', 'approval', 'p0'],
  aliases: [{ name: 'pipeline:approval:requested', deprecated: true }],
  schema: { /* see src/declarations/pipeline.ts:42 */ },
}
```

### d. Discriminator (envelope event with sub-types)

`ingest:progress` carries 10 sub-shapes via `payload.type`. One JSON Schema
can't usefully validate all 10 without a heavy `oneOf`; the discriminator
catches drift at the sub-type level.

```ts
{
  name: 'ingest.progress',
  transport: 'signal',
  producer: 'platform-api',
  discriminator: {
    field: 'type',
    values: ['queued', 'fetching', 'parsing', 'chunking',
             'embedding', 'indexing', 'persisting', 'complete',
             'failed', 'cancelled'],
  },
  schema: { /* a permissive base schema; per-type detail validated by the discriminator */ },
}
```

### e. FIFO durable with partition key

Ordered per-run delivery.

```ts
{
  name: 'pipeline.step.completed',
  transport: 'durable',
  producer: 'distributed-core',
  fifo: true,
  partitionKey: (p) => (p as { runId: string }).runId,
  retention: 2592000,             // 30d for audit
  schema: { /* ... */ },
}
```

---

## 4. Declaring vs. publishing

`declare()` is local-first and idempotent. It registers the schema in the
in-process `Registry` so `publish()` and `subscribe()` work. The server
half hears about it via `syncToRemoteRegistry()`, which runs once on
`connect()` and then periodically.

```ts
catalog.declare(streamEnded);
await catalog.connect();
await catalog.publish('stream.ended', { streamId, endedAt, durationMs, reason });
```

Declarations are validated on the way *in*:

- **Strict mode** (`EVENT_CATALOG_STRICT=true` or `config.strict: true`):
  `declare()` throws on compat violation against the registered history.
- **Default mode**: the violation is logged; the call returns. The server
  can still gate the registration via `compatMode: 'strict'` per event.

See `docs/architecture.md` §3 for the full compat-gate matrix.

---

## 5. Anti-patterns

- **Multiple declarations for "the same event in two shapes."** If a signal
  and durable emission carry the same payload, use one declaration with
  `transport: 'both'`. If they genuinely differ (different fields, different
  consumers), they're two events — name them accordingly.
- **Hardcoded deprecation-suppression sets in producer code.** Use
  `aliases` instead.
- **`additionalProperties: false` on hot-path events.** Breaks every additive
  evolution. Use it only where you've decided field shape is frozen.
- **Skipping `description`.** The admin UI is the discovery surface for
  every other team in the platform. An undescribed event is invisible.
