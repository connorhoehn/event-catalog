# Changelog

All notable changes to `@connorhoehn/event-catalog` will be documented in this
file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/)
and this project follows semantic-versioning intent (`MAJOR.MINOR.PATCH`),
though pre-1.0 minor bumps may carry breaking changes.

## [0.6.0] - 2026-09-07

Five sweeps that landed after the `0.5.0` entry was written and were never
recorded (`0661e49`, `6495870`, `5ab22b1`, `fc15060`, `e0b2e23`). The theme
is the same one `0.5.0` started — paths that reported success while losing
the thing they were asked to carry — but three of these are consumer-visible
breaks rather than internal repairs: the DLQ list changed shape, two read
endpoints stopped answering `200 []` on a dependency failure, and replication
now refuses schemas it used to install.

### BREAKING (replication — `src/server/registry-coordinator.ts`)

- **Replication no longer bypasses the schema-evolution gate.**
  `applyMutation` called `registry.declare()` directly, and `Registry.declare`
  computes compatibility but never refuses — so a schema the HTTP route turns
  down with a `409 COMPAT_VIOLATION` on replica A was installed unconditionally
  on replica B the moment the broadcast arrived. One stale replica accepting a
  write pushed a rejected schema across the cluster. The replication path now
  runs `passesCompatGate()`, which applies exactly the route's rule: it fires
  only when the *existing* entry is in strict mode (`compatMode: 'strict'`, or
  `EVENT_CATALOG_STRICT=true` with `compatMode` not `off`), an identical schema
  is still a no-op, and a refusal is recorded as a `compat-violation` conflict
  and logged. Nothing shipped in this package carries `compatMode`, so a
  default deployment sees no change in what is accepted.
- **Replicas converge instead of diverging.** Under a true concurrent
  interleaving — A declares `x` with `S1`, B with `S2`, each applies the
  other's broadcast — both replicas ended up holding the *other* one's schema.
  Not last-writer-wins: a mirrored, permanent disagreement about what a
  contract is. Mutations now carry a Lamport stamp and are ordered by
  `(ts, replicaId)` per conflict key. Four adjacent bugs went with it:
  `subscriber.add` and `deprecate` arriving before their `declare` were
  dropped, `subscriber.remove` before its `add` resurrected the subscriber, a
  first-sight replicated declare discarded the peer's subscriber list, and
  missed broadcasts were undetectable — the file's comment claiming a later
  declare re-syncs was false, so a partitioned replica served a truncated
  registry while reporting healthy. Out-of-order mutations now wait in a
  bounded TTL buffer and replay on their declare; a per-replica sequence gap
  marks the replica stale and triggers a delete-aware `Registry.reload()`.
- **`GET /health` reports the coordinator as `degraded` while a replica is
  stale**, so a diverged replica is drained rather than serving quietly.
- ~870 randomized 2–5-replica scenarios (`tests/fuzz-replica-convergence.test.ts`)
  found four further bugs in that Lamport code, all fixed: `peerSeq` regressed
  on redelivery so a delayed duplicate faked a gap and triggered a pointless
  full reload; concurrent declares left two replicas serving the identical
  contract under different version numbers; a parked `subscriber.add` survived
  a delete and attached a consumer to a fresh event; and discarded mutations
  left no stamp, so Redis redelivery re-applied them.
- The tie-break still trusts wall clocks. A CAS on the Redis hash was
  investigated and **declined** — reads never touch the hash, `addSubscriber`
  and `deprecate` blind-`hSet` the same field so there is no per-field
  granularity, Redis is optional on `Registry` so the Lamport path has to
  stay regardless, and an old replica's blind `hSet` after `EXEC` is an
  undetectable lost update during the rolling upgrade the scheme exists to
  survive. Characterized weakness over half-built protocol.
- **Subscribers are now persisted.** `addSubscriber`/`removeSubscriber` write
  through to the Redis hash; they were memory-only, so a restart — or the new
  resync, which reads that hash — silently lost "who consumes X?", the
  question the registry exists to answer.
- **`Registry.reload()` is new public API** — a delete-aware full-state resync
  from Redis, returning `false` when the registry has no Redis backing so the
  caller can tell "resynced" from "cannot resync". `load()` only ever
  overlaid.

### BREAKING (`GET /api/transports/durable/dlq` response shape)

- The endpoint returned **two different shapes under one `200`**: raw DynamoDB
  rows on the happy path, `DeadLetteredMessage` from the in-memory fallback.
  Both now normalize to a single `DlqWireEntry`: `{ id, eventName, payload,
  error, attempts, deadAt, expiresAt? }`.
- `pk` and `sk` are **gone** (a DynamoDB composite key, never client
  meaningful). `ttl` (epoch seconds) is replaced by **`expiresAt`** (ISO-8601,
  optional — present only when the answering source expires entries).
  **`source`** is populated on every entry rather than only on some.
- Nothing read the dropped fields. The admin UI's own `DLQEntry` type declares
  exactly the six that remain, which is how the bug surfaced: during a DynamoDB
  outage it had been rendering `undefined` for every column.
- The fallback also **ignored `?eventName=` and `?limit=`**, silently widening
  a filtered query to the whole mirror mid-outage, and it sliced from the head
  while the store returns newest-first — so `?limit=2` gave the two *oldest*
  during an outage and the two *newest* normally. Same request, silently
  inverted meaning. Both fixed; the mirror is sorted newest-first before
  slicing.
- **Raw AWS SDK and message-queue error text no longer reaches clients.** Table
  names, endpoint hostnames, credential-resolution chains and queue URLs went
  out in the `error` field. The detail goes to the (throttled) server log; the
  client gets a stable, actionable sentence. `findById` also sat outside the
  per-id `try`, so one throttled read aborted a whole batch replay with a bare
  `500`, and `clear()` discarded its partial count when a later page threw.

### BREAKING (`503` where `200 []` used to be)

- **`audit-log.recent()` and `SignalTransport.getHistory()` now throw on a
  Redis error instead of returning `[]`.** `GET /api/audit/recent` answered
  `200 {events: []}` during a Redis outage — indistinguishable from "nothing
  happened", which is the single worst answer to give someone reading an audit
  trail. Both now propagate, and the routes answer `503` with a body saying so:
  `GET /api/audit/recent` and `GET /api/events/:name/history`. An empty ring
  buffer and an unreachable Redis are different facts and no longer share a
  response shape. Same class already fixed for the DLQ list in `0.5.0`.

### Changed (client — `src/client/index.ts`)

- **A signal publish issued while Redis is disconnected is no longer counted as
  a success.** `SignalTransport.publish` returned normally and
  `EventCatalog.publish` then bumped `publishCount` and `lastPublishedAt`, so
  during `platform-api`'s background-reconnect window all 14 `publishSignal`
  route sites resolved, logged nothing, and the catalog reported rising
  throughput for events that reached nobody. Drops are now counted per event
  and per channel, counted as `errorCount` rather than `publishCount`, warned
  once per channel, and reported to the new **`onPublishDropped(drop)`** option
  (`DroppedPublish` carries the lost `envelope`, so a caller can buffer or
  re-emit). Exceptions from the callback are caught and logged; they never fail
  the publish.
- **`strictTransport?: boolean`** (default `false`) makes `publish()` and
  `publishSignal()` **reject** rather than drop when the signal transport is
  disconnected, matching what the durable transport already does. Off by
  default to preserve the v0.x contract — turning it on is a deliberate choice
  for a service where a lost realtime event is worse than a rejected request.
- **`getDroppedPublishCount()`** (overloaded: per-event `number`, or a `Map`)
  and **`getDroppedPublishStats()`** expose the counters.
  **`getInFlightPublishCount()`** exposes durable backpressure, which is
  deliberately still unbounded — a limiter would be a behavior change.
- **`logger?: CatalogLogger`** routes the library's own diagnostics into the
  host's pipeline instead of `console`. Two methods, `warn`/`error`, each
  `(message, fields?)`; `fields` carries the structured half (`eventName`,
  `channel`, `queue`, `attempt`, `status`, `suppressed`) so a sink never has to
  regex the message. Throttling stays *in front of* the sink — some lines sit
  on the publish path and an adapter cannot know which — so forward every call
  you receive. Omitting it leaves output byte-identical, asserted against full
  console-mock call arrays (count, arity, every argument) across eight sites.
  `CatalogLogger` and `LogFields` are re-exported from the root, alongside
  `EventCatalogClientOptions` and `DroppedPublish`.
- **`authToken?: string`** (defaulting to `process.env.EVENT_CATALOG_AUTH_TOKEN`)
  presents `Authorization: Bearer` on the four mutating registry calls the
  client makes. Documented in the `0.5.0` entry; repeated here because it is
  the half that makes `EVENT_CATALOG_AUTH_TOKEN` usable at all.
- `syncToRemoteRegistry` and the heartbeat POST **now check `res.ok`.** A
  registry answering `500` left the service believing it had registered; a
  rejected heartbeat ends with the server sweeping the subscriber at TTL.
  `pinManifest`, sitting beside them, already checked — these were omissions.
- The durable publish `fetch` **now has a timeout and an `AbortSignal`.** A
  queue that accepted the socket and never answered left the promise pending
  forever with nothing metered.
- **Caller-keyed maps are bounded.** `publishSignal()` takes an undeclared
  event name and a raw `channelId` straight from the caller — in
  `websocket-gateway` that means straight from client frames. Four structures
  were keyed off them and never pruned, and `warnedUndeclaredSignal` logged one
  line per distinct name: one input, both a leak and a log amplifier.
  Warn-once-per-key is not a bound when the key space is caller-controlled, so
  `LogThrottle` adds a per-window ceiling on top of per-key dedupe and still
  counts what it suppressed.
- **Lifecycle leaks that kept a container alive after SIGTERM**:
  `startHeartbeating`'s interval and the chained background-sync `setTimeout`
  survived `disconnect()`; concurrent `connect()` raced the guard and orphaned
  a re-sync interval; a rejected `connect()` left Redis clients reconnecting
  forever; two subscriptions on one queue orphaned an unstoppable poll loop.

### Changed (server)

- **Response compression is ON by default** (`src/server/compression.ts`, new).
  Real gzip/brotli/deflate with `Accept-Encoding` negotiation, `zlib` only, no
  dependency. Brotli q5 measured both smaller *and* ~1.5x cheaper than gzip L6
  on every payload, so the preference order is `br > gzip > deflate`.
  `/api/events` 325.6 → 39.4 KiB; `/api/metrics/history` 199.0 → 1.9 KiB. It
  engages only for a client that advertised the coding, so a caller that cannot
  decode keeps getting `identity` — Node's global `fetch` (undici) advertises
  and transparently decodes, `http.request` advertises nothing, browsers have
  handled this since 1997. **SSE is excluded structurally** —
  `flushHeaders()`/`write()` latch a flag — rather than by a path list, so a
  future streaming endpoint cannot be accidentally buffered.
- **Static admin assets are compressed too** (`src/server/static-compression.ts`,
  new): 628,918 → 195,687 bytes, 68.9%. Applied by wrapping `serveStatic`'s
  `writeHead`/`end` in a `Proxy` rather than reimplementing it, so its MIME
  table, cache policy and traversal defence are untouched.
- Three new boot-validated variables: **`EVENT_CATALOG_COMPRESSION`**
  (default `true`; `=false` is the full revert),
  **`EVENT_CATALOG_COMPRESSION_THRESHOLD`** (default `1024` bytes; `0`
  compresses everything, and a value under 128 warns because below ~200 bytes
  gzip makes a JSON body larger) and **`EVENT_CATALOG_COMPRESSION_LEVEL`**
  (`1`–`9`, default `6`).
- **`logger?: CatalogLogger` on `startServer`** — the same injectable sink the
  client got, threaded through every server component, with per-request and
  per-scrape paths throttled (a bulk declare went from 200 log lines per
  request to 1). Default output byte-identical, proven across 12 sites.
- **`/api/feature-bundles` was returning `{bundles: [], total: 0}` in
  production.** `src/server/index.ts` built a fresh empty `FeatureBundleRegistry`
  and never populated it, while 19 bundles sat declared in the source. It
  failed silently because `ec-lint-crd` reads bundles from the package rather
  than from the server, so nothing pointed at the HTTP surface. Now wired
  through an exported **`buildBundleRegistry()`**, which the e2e harness calls
  so the specs exercise production's wiring instead of a faithful copy.
- **`ProducerAttributionStore` was unbounded in both dimensions** and keyed by
  `envelope.metadata.producer` — a string any Redis publisher picks per
  message. No cap, no TTL, no removal on event delete, and
  `/api/events/attribution` re-serialized all of it per call. Now capped
  oldest-first with eviction counters, plus `forget()`.
- `recordSseRejected()` had **zero callers**, so `sse_streams_rejected_total`
  was never registered or rendered and SSE saturation was invisible. Wired.
- **A single non-2xx from the alert webhook lost the incident permanently.**
  `fire()` skips the cooldown so it can retry immediately, but `observeHealth`
  had already advanced `previousHealthState`, so every later probe
  short-circuited at `status === previous` — Redis down plus one webhook blip
  meant zero alerts, ever. State now advances only once a transition is
  actually reported, and a failed recovery leaves the incident open rather than
  going falsely green.
- `subscriberCount` counted the observer's own Redis connection, was written
  once at first subscribe, and never ran for durable-only events (so their
  count read `0` forever). Now derived from the registry and reconciled each
  poll tick. `DELETE /api/events/:name` leaked the observer's Redis
  subscription, so the server kept recording publishes for deleted events.
  `MetricsCollector` moved to the `event_catalog_stats` namespace — both
  registries had registered `publish_total` with different label sets, which is
  invalid exposition the moment anything renders them together.
- Admin UI: bundle list, bundle detail and a coverage view showing which events
  no operator can pin (84 of 229 across 7 namespaces), plus roughly twenty
  fixes to error handling, filtering and large-registry rendering.

### Added (HTTP)

- **`POST /api/events/bulk/export`**, body `{ names?: string[] }`. `?names=` on
  the `GET` is already a 5.8 KB URL at 225 events and grows with the registry,
  and a request line's length is not this process's to guarantee. The `GET` is
  kept: with no `?names=` it is the browser-download surface the admin UI uses,
  which a `POST` cannot be. Omitted or `null` `names` means "export everything",
  matching the `GET`; anything that is not an array of strings is a `400`
  rather than a silent 261 KB "successful narrow export".
- Both forms cap `names` at **1000** (`MAX_BULK_EXPORT_NAMES`) — it was the one
  bulk surface with no bound. The `POST` caps *before* trimming and filtering,
  so the limit describes what the caller sent.
- Pagination and a `fields=` projection were both measured and declined: the
  302 KB body gzips to 42 KB while a schema-less projection only reaches 53 KB,
  and the admin UI filters the whole registry client-side from one fetch.

### Changed (contracts — published artifacts)

- **`contracts/asyncapi.registry.yaml` is a new published artifact.** The single
  `asyncapi.yaml` covered 110 of 229 events. It is split by transport on a
  structural fact rather than a name prefix: not one of the 110 gateway frames
  declares a channel or queue (they are multiplexed over one socket), while all
  119 others are broker-addressed. `asyncapi.yaml` keeps the gateway
  `client.*`/`ws.*` frames and now **states that scope in-file**;
  `asyncapi.registry.yaml` carries the broker-addressed remainder. Both ship in
  the tarball (`files` already includes `contracts`).
- Fixed a spec bug where durable addresses used the raw event name while
  `publish()` uses the derived queue name, and surfaced 25 previously-silent
  deprecated aliases. Meta-schema conformance is unverified — no validator is
  available offline.
- `contracts/registry.snapshot.json` regenerated: **194 → 229 events.** The
  additions are `activity.recorded`, `call:reaction.recorded`, all 20 `sfu.*`
  events, 9 undeclared control-plane and `recording.compose` bus events,
  `ws.session.connected` (the gateway welcome frame that gates all outbound
  traffic — a deployment missing it does not degrade, it silently sends
  nothing), the multiplexer's subscribe/unsubscribe acks, and
  `sfu.participant.left`. `{type:'pong'}` and `participant.joined` are
  deliberately left undeclared: the first is protocol plumbing, the second is
  Socket.IO room-scoped and never crosses a process boundary.
- **Seven new bundles** — `notifications`, `ag-ui-stream`, `call-captions`,
  `sfu-webhooks`, `sfu-control-plane`, `sfu-chat`, `gateway-session` — taking
  orphaned events from 148 to 83.
- `MQ_QUEUE_NAMES.ACTIVITY_RECORDED` corrected from `'activity.recorded'` to
  **`'activity-recorded'`**. Both publish and subscribe route through
  `DurableTransport.eventNameToQueueName`, which replaces `[:.]` with `-`, so
  the dotted value named a queue nothing ever created — anything configuring
  message-queue from this constant would have listened on an empty queue. No
  repo consumed it, so this closes a latent trap rather than changing live
  behaviour.

### Fixed (bundle tooling)

- `agentic-pipeline-durable@1.0.0` **shipped invalid against its own registry**:
  its approval events are `transport: 'both'` and `validateBundle` demanded the
  declared transport *equal* the inferred aggregate, when narrowing to one bus
  is the entire point of the signal/durable split. It is a satisfiability check
  now. The existing test file never called `validateBundle` on that bundle; it
  does now.
- `validateBundle` had two vacuous-truth holes — an empty `events[]` and an
  all-optional-unregistered member list both left `registeredMembers` empty, so
  the transport check never ran and any claim passed. `bundle.transport` was
  never runtime-checked either, so `"kafka"` validated as if it were `'both'`.
- `ec-bundle-diff` was missing transport, deprecation and member-pin changes
  entirely: a transport-only change printed `No changes.` and `bump: major`
  together and exited `0`. It also gained **`--exit-code`** (`3` differs, `1`
  failed) so "differs" is distinguishable from "failed to run" in CI.
- `ec-bundle-create` rejects undeclared events instead of scaffolding over a
  typo.
- **Both shipped CI templates were unusable.** They looped per file taking the
  *numeric max* of exit codes, so a deprecated bundle in one file masked a hard
  lint error in another — a bad CRD went through the old pre-commit hook and
  produced a green workflow step. Now one invocation over all files. Strict
  mode keyed on `2` and therefore did nothing. The GitHub workflow pinned
  `0.3.47` with no registry or auth, so the install 404'd. And `templates/` was
  **in no tarball** — `package.json#files` was `["dist", "contracts"]` while the
  README told operators to copy from it, which is why none of this was ever
  caught. `templates` is in `files` now.
- **`ec-lint-crd` warnings exit `3`, not `2`.** `2` is a usage error across
  every bin in this package, so the documented `|| [ $? -eq 2 ]` recipe was
  swallowing a typo'd path as clean-with-warnings. Recorded in the `0.5.0`
  migration notes; restated here because it shipped in that release and the
  README recipe changed with it.

### Migration from `v0.5.0`

Most of this needs nothing from a consumer. Taking the breaks in order:

1. **Replication gate — no action, and no behaviour change for anyone today.**
   The gate only refuses when the *existing* registry entry is in strict mode.
   No declaration this package ships sets `compatMode`, and no consumer sets
   `EVENT_CATALOG_STRICT`. If you do run strict multi-replica, the change is
   that a breaking schema is now refused on every replica instead of only the
   one that got the HTTP request — which is what you were already asking for.
2. **Replica convergence and subscriber persistence — no action.** Both are
   repairs to behaviour that was wrong; there is no API to adopt. One operator
   note: `/health` can now report the coordinator `degraded`. If you alert on
   `/health` being non-`healthy`, expect that state to appear during a partition
   and to clear on its own after the resync.
3. **DLQ list shape — action only if you parse the response yourself.** If you
   read `pk`, `sk` or `ttl` off `GET /api/transports/durable/dlq`, switch to
   `id` and `expiresAt` (ISO-8601, and optional). Nothing in the platform does:
   the admin UI already typed exactly the six surviving fields, and no consumer
   repo calls the endpoint. If you relied on the `error` string containing AWS
   detail, that detail is now in the server log instead.
4. **`503` from `/api/audit/recent` and `/api/events/:name/history` — action
   only if you treated `200 []` as "healthy and empty".** A dashboard that
   rendered an empty list will now need to render an error state. No consumer
   repo calls either endpoint.
5. **Compression — no action.** Content negotiation means a client that did not
   advertise an encoding still gets `identity`, so nothing that worked stops
   working. Set `EVENT_CATALOG_COMPRESSION=false` to revert wholesale if you
   have a proxy that already compresses and you would rather not pay twice.
6. **Signal-publish drops — no action, and the default is unchanged.** A
   publish issued while disconnected still resolves; it is now booked as an
   error rather than a success and reported to `onPublishDropped` if you supply
   one. Adopt `strictTransport: true` only if you want those publishes to
   reject — that *is* a behaviour change, which is why it is opt-in.
7. **`logger` and `authToken` — no action.** Both default to exactly the
   previous behaviour: `console` output byte-for-byte identical, and no
   `Authorization` header unless `EVENT_CATALOG_AUTH_TOKEN` is set.
8. **`MQ_QUEUE_NAMES.ACTIVITY_RECORDED` — no action.** No repo imports it. If
   you had copied the old dotted value into a message-queue config, you were
   listening on a queue that never existed; use `activity-recorded`.
9. **The new declarations and bundles are additive.** The `0.5.0` caution still
   stands: **do not adopt `sfuDeclarations`, `gatewayDurableDeclarations` or
   `callCaptionDeclarations` without diffing them against what your service
   already declares.** Registering both copies gets you a version bump and a
   violation list, and on a shared server the last writer decides which schema
   the message-queue workers validate against.
10. **`asyncapi.yaml` readers: check which document you want.** The file still
    exists at the same path with the same gateway frames in it, but it now says
    in-file that it covers only `client.*`/`ws.*`. Everything broker-addressed
    moved to `contracts/asyncapi.registry.yaml`. Codegen pointed at
    `asyncapi.yaml` produces the same 110 frames it did before.
11. **`ec-bundle-diff` callers: `--exit-code` is opt-in.** Without the flag the
    exit codes are what they were.

### Notes

- **Bundle pins pin the event set, not the contracts.** Bundle fingerprints
  hash `{name, version, events[]}` only, so they correctly do not move on an
  annotation sweep — and correspondingly a member event's schema can change
  breakingly without the pin noticing. Separately, `EventReference.version` pins
  a member's schema *revision* by exact equality, so a purely additive optional
  property breaks every pinned bundle. Both are now documented and pinned by
  tests.
- **Consumer contract drift, reported not fixed** (`tests/consumer-contract-drift.test.ts`,
  mutation-checked so it cannot decay into a restatement of the declarations).
  A systematic declared-vs-emitted-vs-read pass over the 36 high-risk
  declarations found four live defects in repos this session cannot edit:
  `ws.error.error` — the gateway emits a flat
  `{type, code, message, timestamp}` and both consumers gate on a nested
  envelope, so every gateway error frame is silently discarded (schema right,
  consumers wrong); `call:reaction.recorded.orgId` is never emitted and the
  consumer picks its DynamoDB tenant partition from it, so every row lands
  tenantless; `sfu.recording.completed`'s `tracks[].userId` is never set, so a
  departed user gets no fan-out row and never sees the recording; and
  `sfu.recording.compose.completed` passes both of `lvsWebhooks`' substring
  gates and would overwrite the recording row if ever sent as a webhook.
  `composedUrl` is likewise declared but assigned nowhere — compose runs after
  the webhook and writes `composedSegment` — recorded in the description rather
  than removed, since removing a property is breaking under this repo's own
  gate.
- **Reported, not fixed** in the coordinator: the parked-mutation TTL only runs
  on an incoming declare, `MAX_PENDING` bounds entries not bytes (32 MiB from
  one peer), `peerSeq` grows per pod restart forever, every sequence gap
  triggers an uncoalesced full registry reload, `Registry.remove()` orphans
  subscriber heartbeats, and `shutdown()` never destroys the DynamoDB client.
- Tests 1950 → 2807, admin 0 → 394 (`src/admin`, its own vitest config), e2e
  32 → 49. The declaration files were reorganized —
  `gateway-signal.ts` 1351 → a 334-line barrel plus 11 files, `client-frames.ts`
  1122 → 346 plus 7, `sfu.ts` 787 → 254, `ag-ui.ts` 682 → 206 — with
  fingerprints proven unmoved by a byte-identical JSON dump before any
  additions.

## [0.5.0] - 2026-09-07

Three hardening sweeps over the server, the CLI, the publish hot path and the
declarations. The library consumer surface (`EventCatalog`, the transports,
`Registry`, the generated types) keeps its shape, but two things change for
consumers regardless: the schema-evolution gate now rejects changes it used to
wave through, and the service refuses to boot without `$REDIS_URL`.

### BREAKING (schema-evolution gate — `src/registry/schema-compat.ts`)

- **The compat checker now recurses.** It was top-level-only and knew three
  keywords (property removal, `required`, `type`), while the validator that
  actually runs at publish time descends `properties`, `items` and schema-form
  `additionalProperties`. A `required` added three levels deep, or inside an
  array item, shipped silently. All three are descended now, to a depth bound
  of 16.
- **Four keyword families are gated that never were**: `enum` shrinks,
  `additionalProperties` `true` → `false`, an added or tightened `pattern`,
  and all six bounds (`minimum`/`maximum`, `minLength`/`maxLength`,
  `minItems`/`maxItems`). Every one of them is enforced by the fallback
  validator at publish time, so every one could already reject a payload the
  previous schema promised to accept.
- **Consequence: schema changes that deployed clean before are now refused.**
  `Registry.declare()` reports the violations, and in strict mode **throws at
  declare time** — for a service that declares at boot, that is a failed boot.
  `POST /api/events` returns `409` with both fingerprints. Consumers are
  SHA-pinned to `v0.3.59`, so the exposure is deferred until they re-pin, not
  absent: dry-run a candidate schema through
  `POST /api/events/:name/schema/check` before bumping the pin.
- **Deliberately NOT gated**: `format`, `multipleOf`, `const`,
  `oneOf`/`anyOf`/`$ref`, tuple-form `items`. The fallback validator ignores
  all of them, so a rule there would block deploys over a constraint nothing
  enforces.
- **Two false rejections fixed**: `integer` → `number` is a widening, and
  dropping `type` altogether is not a narrowing. Both used to be reported.
- `checkBackwardCompat` / `checkForwardCompat` keep their signatures and
  `CompatResult` shape; only the verdict changed.

### Changed (configuration — `src/cli/config.ts`, new)

- **`REDIS_URL` is now required.** The old default of
  `redis://localhost:6379` is right on a laptop and silently wrong in every
  container: the service came up, reported itself healthy, ran an empty
  in-memory registry and said nothing about why. Unset or malformed is now a
  labelled boot error and exit `2`. `--redis-url` overrides it.
- **`EVENT_CATALOG_PORT` is now actually read.** The code only ever looked at
  `$PORT`, so the variable the deploy notes have always named silently did
  nothing. `$PORT` still wins when both are set, and a disagreement warns.
- All 11 runtime variables are resolved and validated in one pure function
  before any socket is opened, and **every** problem is reported at once, so a
  container with three bad values needs one restart rather than three.
  `EVENT_CATALOG_STRICT` now accepts `1`/`yes`/`on` as well as `true` (it was
  `=== 'true'`, so `=1` quietly meant "not strict") and rejects anything else.
- The boot banner redacts credentials; it used to print `REDIS_URL` with its
  password into container logs.

### Changed (server hardening)

- **CORS is off by default.** `startServer` passed `corsOrigin: true`, which
  reflects any `Origin` — with no authentication on 20 mutating endpoints,
  that let any web page the operator had open rewrite the registry. No CORS
  headers are emitted unless `EVENT_CATALOG_CORS_ORIGIN` is set; `=*` restores
  the old behaviour, a string pins one origin. The admin UI is same-origin and
  non-browser callers (CI, `syncToRemoteRegistry`, curl) are unaffected.
- **The 1 MiB request body cap is now enforced.** `index.ts` passed
  `bodyLimits: { maxBodyBytes }` but the field is `maxBytes`, so the key was
  dropped and the server silently ran on distributed-core's 16 MiB default. A
  2 MiB body now gets a `413`.
- **Per-collection caps on what one in-budget request can create** — 1000
  events per `POST /api/events/bulk`, 1000 bulk-deprecate names, 100 DLQ
  replay ids, 5000 freshness/manifest entries, 1000 audit rows. A 35-byte
  declaration meant ~30 000 of them fit under the body cap; 20 000 were
  verified accepted before this.
- **`__proto__`, `constructor` and `prototype` are rejected as event names**
  (as are control characters and names over 512 chars). Declaring `__proto__`
  returned `201` and listed in `GET /api/events` while making
  `/api/fingerprints` and `/api/metrics/history` return `{}` — the exact
  endpoints a CI drift check reads. The response builders use null-prototype
  maps now as well.
- **SSE streams are capped at 256 concurrent** (`EVENT_CATALOG_MAX_SSE_STREAMS`,
  `0` disables), over-cap connections getting a `503`. Admission control
  releases its slot when the handler resolves, so it never gated `/api/flow`
  at all.
- **SIGTERM completes.** `admission.stop()` is `http.Server.close()`, so a
  single open SSE stream blocked it forever and `redisClient.quit()` never
  ran — every deploy was a hard kill. Shutdown now drains with a 10s bound.
- **`GET /health` reports dependencies**, returning `503` when Redis or
  message-queue is unhealthy. The image's `HEALTHCHECK` deliberately accepts
  any HTTP response, so a message-queue outage cannot restart the registry.
- **Repeated query keys are guarded.** `bulk/export?names=a&names=b` arrived
  as an array and exported the entire catalog.
- **`Registry.getTopology()` emits `namespace`** on event nodes, so the admin
  namespace filter and the E7 cluster overlay work rather than being stuck on
  "all".

### Changed (HTTP surface)

- **`POST /api/events/:name/schema/check` is the canonical form.** The `GET`
  variant originally required a JSON body on a `GET`, which browsers cannot
  send and many proxies drop; it now takes a URL-encoded `?schema=` instead,
  is marked `deprecated: true` in `openapi/event-catalog.yaml`, and still
  honours a body for existing callers. No consumer in the platform calls it.
- Unmatched repeated-key and over-limit requests return `400` with a message
  naming the field, not a partial success.

### Performance

- **`publish()` p50 13.4µs → 1.25µs (68.6k → 735k ops/sec).** Profiling put
  ~90% of a no-I/O publish in `ulid()`: the package's default PRNG draws
  `crypto.randomBytes(1)` sixteen times per id and rebuilds the same
  per-millisecond time prefix on every call. **`src/utils/hot-path.ts` (new)**
  exports `eventId()` and `nowIso()` — a pooled `randomFillSync` PRNG plus a
  memoized time prefix, built on the `ulid` package's own `encodeTime` /
  `encodeRandom`, so format, ordering, entropy source and the emitted ISO
  string are byte-identical. Plus an alias index for `resolve()` and a lazy
  `eventNameToQueueName` (two regex passes that signal-only publishes were
  paying for). Benchmark: `scripts/bench-publish.ts`.

### Changed (declarations)

- **143 `format` annotations** (137 `date-time`, 6 `uri`) and **~780 property
  `description`s** stamped on by the new `src/declarations/field-glossary.ts`,
  which resolves a field name (or dotted path) to its canonical meaning once
  instead of the same sentence being retyped 58 times. Annotation only ever
  fills an absent value; a hand-written one always wins.
- Both are documentary, not enforcing: `ajv` is not a dependency, so the
  hand-rolled fallback validator runs, and it ignores `format` entirely.
  Nothing that validated before is rejected now.
- **Fingerprints moved** — descriptions are part of the canonical
  serialization — and `contracts/registry.snapshot.json` was regenerated (194
  events). Verified against the real consumer repos that nothing pins or
  caches a schema fingerprint, so the churn is inert.
- `ws.pipeline.event` `$.emittedAt` and `ws.presence.joined`
  `$.client.lastHeartbeat` are epoch numbers, not ISO strings (traced to
  `EventBus.ts` and `PresenceService.ts`); the descriptions were wrong, the
  types were right.

### Fixed (build + tooling)

- **The Docker image never built.** `npm install` died with `spawn git ENOENT`
  (node:20-alpine has no git and `distributed-core` is a private `github:` SSH
  pin), `RUN npx tsc` never emitted `dist/cli/index.js` because the root
  tsconfig excludes `src/cli`, and the build context was a 15 GB parent
  directory. Now a three-stage build with `--mount=type=ssh`, a non-root
  runtime user, build-time asserts on `dist/cli/index.js` and
  `dist/admin/dist/index.html`, and a 774 MB → 5 MB context. Verified by
  building and running it.
- **`npm run lint` never typechecked the server or the CLI.** `tsconfig.json`
  excludes `src/server`, `src/cli` and `src/admin` from `include` — its
  exclude list is what makes `npm run build` emit exactly the committed
  `dist/` tree, so it is left alone. New **`tsconfig.lint.json`** +
  **`npm run lint:all`** cover all of `src` except `src/admin` (which has its
  own build). The nine real type errors that were hiding there are fixed with
  real types.
- The four CLI bins used `void fn().then(code => process.exit(code))` with no
  `catch`, so any throw surfaced as an unhandled rejection with a raw stack,
  and `process.exit()` immediately after `stdout.write()` truncated piped
  output — `snapshot > file` could silently lose data. They set
  `process.exitCode` now, share flag parsing in `src/cli/_args.ts`, and reject
  unknown flags instead of ignoring them.
- `validateBundle` never handled the legal `'both'` transport, so any
  all-`both` bundle reported invalid with `Bundle transport "both" does not
  match inferred transport "signal"`. `pipeline.approval.requested`/`.recorded`
  were affected; a CRD gate over those bundles would have failed at boot.
- The admin `/topology` and `/flow` routes were white screens: `@ui` aliases to
  ui-components' source, so `@xyflow/react` resolved twice and `AnimatedEdge`
  threw "you have not used ReactFlowProvider as an ancestor". Fixed with
  `resolve.dedupe`; the routes are also code-split now (initial JS 234 kB →
  74 kB gzipped).

### Migration from `v0.3.59` (`474ed44`)

**No consumer has to change a declaration.** `platform-api`,
`websocket-gateway` (in `realtime-examples`) and `live-video-streaming` are all
pinned to `474ed44`, and every declaration all three register is accepted
unchanged by the tightened gate. That was checked, not assumed:

- The gate only fires when one registry sees the *same* event name declared
  twice with *different* schemas. None of the three does that. `platform-api`'s
  only re-declaration is the four events `pipelineRaftStateMachineDeclarations`
  shares with `pipelineRaftDeclarations`, and those are the same object — the
  schema is byte-identical, so `declare()` takes the no-op path and never
  reaches the checker. The gateway's 23 names and LVS's 20 are each unique.
- Replaying every one of the 189 declarations this repo ships at `474ed44`
  against its `v0.5.0` counterpart produces **zero** backward and **zero**
  forward violations. The declaration sweeps added `description` and
  `format` and loosened six `additionalProperties`; no `enum`, `pattern`,
  `required` or bound was tightened on an existing event. `format` is inert —
  `ajv` is not in the tree, so the fallback validator runs.
- None of the three sets `strict`, and none sets `EVENT_CATALOG_STRICT`.
  Server-side, `resolveCompatMode` defaults to `off`, so `POST /api/events`
  does not gate at all unless an event carries `compatMode`, the caller sends
  `x-event-catalog-strict`, or the operator sets `EVENT_CATALOG_STRICT`. No
  shipped declaration carries `compatMode`.

The rest of the list is likewise inert for these three: none calls
`SignalTransport.getHistory()` or the audit log's `recent()`, none reads the
DLQ list API, none runs `ec-lint-crd`, and none sets `strictTransport` (which
defaults off, so disconnected signal publishes still resolve — they are only
counted as errors rather than publishes now). The largest body any of them
POSTs is LVS's 20-event bulk registration at 15 KB, well under the 1 MiB cap
that is now actually enforced; a bulk POST of all 216 shipped declarations is
234 KB.

What an upgrading consumer must do, in order:

1. **Set `REDIS_URL` on the event-catalog service** before deploying the new
   image. This is the only step that can take the service down, and it is an
   operator change, not a code change: unset is now a boot error rather than a
   silent fall back to `redis://localhost:6379`.
2. **Set `EVENT_CATALOG_CORS_ORIGIN`** if anything reaches the API from a
   browser on another origin. The admin UI is served from the same origin and
   is unaffected; `syncToRemoteRegistry`, CI and `curl` never involved CORS.
3. **Re-pin and rebuild.** Exports are additive only — nothing was removed or
   renamed, and `publish()` keeps its old `(string, T)` overload alongside the
   new name-typed one, so existing call sites still compile.
4. **Afterwards, check `GET /api/events` returns the count you expect** and
   that the boot log carries no `compat-warn` lines. A `compat-warn` means the
   registry took a schema the gate would refuse under strict mode — advisory
   today, a `409` the moment anyone turns strict on.

Two things to be careful of, neither of which bites today:

- **Do not adopt the newly-shipped `sfuDeclarations`,
  `gatewayDurableDeclarations` or `callCaptionDeclarations` without diffing
  them first.** Those arrays cover 25 names that `platform-api` and LVS already
  declare themselves, and 11 of the two copies disagree in a way the gate
  reports: `sfu.recording.completed` (the whole `tracks[]` item schema), the
  five `sfu.chat.*` events (this repo writes the `type` discriminator as an
  enforced `enum`, LVS as an inert `const`), `sfu.recording.state.changed`,
  `transcription:job.queued` and `transcription:transcript.ready`. Nothing
  collides while each service declares only its own set, but a service that
  registers both gets a version bump and a violation list, and on a shared
  server the last writer decides which schema the message-queue workers
  validate against.
- **`ec-lint-crd` warnings now exit `3`, not `2`.** `2` is a usage error
  across every bin in this package, so the documented `|| [ $? -eq 2 ]` recipe
  was swallowing a typo'd path as clean-with-warnings. No consumer runs the
  binary today; fix the recipe before anyone does.

### Fixed (gratuitous break — `src/client/index.ts`)

- **`EventCatalog` can now present a bearer token.** `v0.5.0` added optional
  shared-secret auth to the server (`EVENT_CATALOG_AUTH_TOKEN`,
  `src/server/auth.ts`), which challenges every non-GET on `/api` — and the
  client had no way to answer it. Turning the feature on would have `401`'d
  every producer's boot-time `syncToRemoteRegistry`, its heartbeat, subscriber
  registration and `pinManifest`, and because the library never blocks on the
  registry, each service would have gone on reporting healthy while the
  inventory emptied and the topology, flow and "who consumes X" views went
  blank. The new `authToken` option — defaulting to
  `process.env.EVENT_CATALOG_AUTH_TOKEN` — sends `Authorization: Bearer` on
  those four calls. Unset, which is the default and what an unauthenticated
  server expects, sends no header and the requests are byte-for-byte what they
  were before.

### Notes

- Tests 1463 → 1950, plus 32 Playwright e2e specs. The 64 schema-gate tests
  each prove their case with a witness payload the old schema accepts and the
  new one rejects.
- The 20 mutating endpoints now have optional bearer auth (`src/server/auth.ts`,
  gated on `EVENT_CATALOG_AUTH_TOKEN`, off unless set) with the matching client
  credential above. DLQ handlers still return raw AWS SDK error text to clients.
- Known flake: the suite has a pre-existing ~1-in-6 `ECONNRESET` under parallel
  workers, measured at `v0.4.2` as well.

## [0.4.2] - 2026-08-25

- **`transcription:summary.ready`** declared (durable, producer
  `platform-api`): summary markdown persisted → projectors and summary-bound
  pipelines run. Light payload; consumers re-read `summaryMarkdown` from the
  recording row.
- **Fixed a `0.4.1` regression** — `callCaptionDeclarations` was re-exported
  from `./pipeline-image-vision`, a compile error for any consumer importing it
  from the declarations barrel. Now exported from `./call-captions` alongside
  the individual declarations. Snapshot regenerated (194 events).

## [0.4.1] - 2026-08-25

- **`call:caption:line`** declared — the live-caption signal event produced by
  the LVS live-captions sidecar and relayed to `captions:<channelArn>` WS
  subscribers, following the streaming-token conventions (per-speaker `seq`,
  hot-path tags, cheap-subscriber contract).
- Backfilled **`transcription:job.queued`** and
  **`transcription:transcript.ready`**, which had ridden declared queues as
  undeclared events since the 2026-08-24 transcription wave.

## [0.4.0] - 2026-08-16

Replace Express with distributed-core's HTTP transport, per the platform
standard: the admin server now runs on `AdmissionHttpServer` +
`serveStatic` from `distributed-core/server`. The library consumer
surface (`EventCatalog`, transports, registry, generated types) is
untouched — this release only changes how the `:3010` service serves HTTP.

### Changed (server transport)

- **`startServer` now boots `AdmissionHttpServer`** (bounded 1 MiB body
  reads matching the old `express.json` limit, slow-loris read timeouts,
  in-flight admission control) instead of an Express app. Binds
  `0.0.0.0` by default (`HOST` env to override) since AdmissionHttpServer
  alone defaults to `127.0.0.1`.
- **`src/server/http-router.ts` (new)** — minimal `:param` router +
  express-shaped `req`/`res` adapters. The ~45 handlers in `routes.ts` /
  `bundle-routes.ts` kept their bodies verbatim; only their `Router` /
  `Request` / `Response` imports moved.
- **Admin UI static serving + SPA fallback** now go through
  distributed-core's `serveStatic`.
- **CORS** is header injection in the request entrypoint (`cors` package
  dropped); `corsOrigin: true` reflects the request origin, a string pins
  it, `false` disables.
- **`startServer` return shape**: `{ address, shutdown }` (was
  `{ app, shutdown }` — there is no Express app anymore). Internal API;
  only the CLI consumed it.
- **`ServerConfig.authMiddleware`** is now a connect-style
  `Middleware` from `http-router.ts` instead of `express.RequestHandler`
  (same `(req, res, next)` shape).
- **Behavior change:** unmatched `/api/*` paths now return JSON 404
  instead of falling through to the SPA's `index.html`.
- **deps:** `express`, `cors`, `@types/express`, `@types/cors` removed;
  distributed-core bumped v0.39.0 → v0.41.0 (additive convergence
  release).

## [0.3.59] - 2026-06-13

Ship machine-readable contract specs for the websocket-gateway — closes the
"no AsyncAPI/OpenAPI exists" productization gap so non-React / non-JS adopters
can integrate without reading the `@connorhoehn/realtime-modules` hook source.
Specs live in `contracts/` (already in the published `files` allow-list).

### Added (contracts/)

- **`contracts/asyncapi.yaml`** — AsyncAPI 2.6.0 description of the gateway
  WebSocket protocol, **generated** from the declarations. One channel `/`
  (the gateway multiplexes every frame over a single connection): `publish` =
  31 `client.*` outbound frames, `subscribe` = the session-bootstrap welcome
  frame + 76 `ws.*` inbound send-backs (108 messages total). Each message's
  `payload` is the verbatim JSON Schema from the declaration — frame shapes are
  not re-derived. Validates clean under `@asyncapi/cli` (0 errors, 0 warnings).
- **`scripts/generate-asyncapi.ts`** + **`npm run generate-asyncapi`** — the
  generator. Reuses the same `allDeclarations` import as `generate-types.ts`;
  partitions into `client.*` / `ws.*`; declares the `{type:'session'}` welcome
  frame inline (it is emitted directly by `websocket-gateway src/server.ts`, not
  via the catalog). Re-run after any declaration change.
- **`contracts/openapi.yaml`** — OpenAPI 3.1.0 description of the gateway REST
  side-channel (8 routes): `POST /api/channels/:id/messages`,
  `GET /api/presence/:channel`, `GET /api/chat/:channel/history`,
  `GET /api/activity/:channel/history`, `GET /api/capabilities`,
  `GET /api/feature-flags`, `GET /api/feature-flags/:name`, `POST /api/notify`.
  Hand-maintained (routes live in `websocket-gateway`); component schemas
  cross-reference the declarations via `x-event-catalog-ref`. Validates clean
  under `@redocly/cli`.
- **`contracts/README.md`** — adopter index pointing at both specs + the
  regenerate command.

## [0.3.58] - 2026-06-12

Complete the WebSocket contract's INBOUND direction: declare the gateway
services' SEND-BACK envelopes per the service implementations the gateway
actually runs (`websocket-gateway/node_modules/@connorhoehn/realtime-modules/
dist/{chat,presence,reactions,cursor,activity,crdt}/`). Resolves divergence
note (b) in the realtime-modules contract test — the action-frame envelopes the
0.15.x hooks parse (`useChat`/`usePresence`/`useReactions`) are now fully
declared, so the inbound unions + `EventPayloadMap` cover the complete
send-back set (e.g. `reaction/reaction_received`, `presence/update`,
`reaction/reaction_unsubscribed`, `available_reactions`, `crdt:awareness`).
Strictly additive on names (3 new `ws.*`); existing send-back declarations
reconciled in place against dist ground truth.

### Added (gateway send-back envelopes, `client-frames.ts`)

- **`ws.reaction.unsubscribed`** — `{ type:"reaction",
  action:"reaction_unsubscribed", success:true, data:{ channel, message } }`
  (ReactionService.handleUnsubscribeFromReactions → sendSuccess). No `ws.*`
  declaration existed before.
- **`ws.reaction.available`** — `{ type:"reaction",
  action:"available_reactions", success:true, data:{ reactions } }`
  (handleGetAvailableReactions → sendSuccess); `reactions` is the emoji →
  `{ effect }` catalog.
- **`ws.crdt.awareness`** — `{ type:"crdt:awareness", channel,
  updates:[{ clientId, update }] }` (server/AwarenessCoalescer._broadcast).
  This is the frame the running dist emits — distinct from the historical
  `ws.crdt.awareness-batch` (different type literal + per-entry shape), which
  the current dist does NOT emit.

### Reconciled (existing send-back declarations vs dist ground truth)

- **`ws.reaction.subscribed`** — added `success: true` + `data.message`
  (data is `{ channel, message, availableReactions }`).
- **`ws.reaction.sent`** — added `success: true` + typed
  `data:{ reactionId, emoji, channel, timestamp }`.
- **`ws.error`** — now models BOTH wire shapes: the NESTED
  `error:{ code, message, service, clientId, timestamp }` envelope
  (chat/reaction/cursor/crdt via createErrorResponse) and the FLAT
  top-level `message` envelope (presence/activity).
- **Annotated as not-emitted-by-current-dist** (historical/in-tree-gateway
  surface, retained for back-compat, descriptions noted): `ws.reaction.removed`,
  `ws.reaction.list`, `ws.cursor.clear`, `ws.cursor.batch`,
  `ws.crdt.sync-request`, `ws.crdt.sync-response`, `ws.crdt.snapshot-stored`,
  `ws.crdt.awareness-batch`.

Verified send-backs that already matched dist ground truth (unchanged):
chat `joined`/`left`/`message`/`sent`/`history`; presence `set`/`update`/
`subscribed`/`unsubscribed`/`data`/`offline`; cursor `subscribed`/`update`/
`unsubscribed`/`cursors`/`remove`/`modes`; activity `subscribed`/
`unsubscribed`/`published`/`history`/`event`; crdt `subscribed`/
`unsubscribed`/`snapshot`/`update`/`doc-replaced`; reaction `reaction_received`.

## [0.3.57] - 2026-06-10

Backfill the gateway-verified verbs missing from the client-frame contract,
flagged by the realtime-modules 0.14.0 contract test (divergence notes b/c/d).
Strictly additive — 6 new `client.*` declarations, no existing fingerprint
changed. Each verb re-verified against the gateway-installed services'
`handleAction` + handler implementations.

### Added (client-frame contract backfill)

- **`client.chat.leave`** — `channel` required ("Channel name is required");
  gateway replies `chat/left`. Sent by `useChat` cleanup as of
  realtime-modules 0.14.0. Completes the verified chat verb set
  `join|leave|send|history`.
- **`client.reaction.subscribe`** — `channel` required + length-validated +
  authz-gated; gateway replies `reaction/reaction_subscribed` with the
  `availableReactions` list. Sent by `useReactions` mount as of 0.14.0.
- **`client.reaction.unsubscribe`** — `channel` required; gateway replies
  `reaction/reaction_unsubscribed`. Sent by `useReactions` cleanup as of
  0.14.0.
- **`client.reaction.getAvailable`** — no payload fields read beyond
  service/action (channel ignored); gateway replies
  `reaction/available_reactions` with the full catalog. No hook sender today.
  Completes the verified reaction verb set
  `subscribe|unsubscribe|send|getAvailable`.
- **`client.presence.get`** — at least one of `targetClientId` / `channel`
  required (either-or constraint documented in the description; the type
  generator does not support `anyOf`, so both are declared optional);
  `targetClientId` wins when both present. Gateway replies a
  `presence/presence` action frame. No hook sender today.
- **`client.presence.heartbeat`** — no payload fields read; refreshes
  lastSeen/lastHeartbeat, no reply, silent no-op without a prior `set`. No
  hook sender today. Completes the verified presence verb set
  `set|get|subscribe|unsubscribe|heartbeat`.

### Added (publishing)

- `publishConfig.registry` → `https://npm.pkg.github.com` (GitHub Packages
  publish prep).

## [0.3.56] - 2026-06-10

hub#1497 — correct `client.activity.*` + re-audit all `client.*` outbound
frame declarations against gateway service ground truth.

0.3.55's client-frame declarations were generated from realtime-modules hook
header comments; hub#1492 proved headers lie. Every chat / presence /
reaction / activity / crdt declaration was re-verified against the
websocket-gateway-instantiated services' `handleAction` implementations.
All corrections are on never-correct contracts (frames the gateway rejected
or fields it never read), so no working consumer can break.

### Changed (contract corrections — never-correct declarations)

- **`client.chat.subscribe` → `client.chat.join`** — the gateway
  `ChatService` verb is `join` (accepts `join|leave|send|history`);
  `subscribe` was always rejected ("Unknown chat action"). `channel` is
  required; the gateway auto-pushes recent history on join.
- **`client.chat.send`** — added optional `metadata` (accepted +
  size-validated server-side). Documented the join-before-send requirement.
- **`client.chat.history`** — `limit` is now optional (server defaults to
  its configured history limit); was wrongly declared required.
- **`client.presence.subscribe`** — `channel` is now REQUIRED (the gateway
  `PresenceService` rejects the frame without it); was declared optional.
- **`client.presence.set`** — `status` is now REQUIRED (service rejects
  without it); `channel` demoted to optional + deprecated (sent by
  usePresence but IGNORED by the service); added optional `channels[]`
  (the field the service actually reads for presence pinning).
- **`client.reaction.react` → `client.reaction.send`** — the gateway
  `ReactionService` verb is `send` (accepts
  `subscribe|unsubscribe|send|getAvailable`); `react` was always rejected.
  Added optional `position`; `targetId` kept but marked deprecated — the
  current service does NOT forward it to subscribers.
- **`client.activity.subscribe` / `client.activity.unsubscribe`** — keyed on
  `channelId` (REQUIRED); legacy `channel` kept optional + deprecated (the
  fixed useActivity hook still sends it for old-server tolerance; the
  gateway never reads it). No auto-history-on-subscribe.
- **`client.activity.history` → `client.activity.getHistory`** — the gateway
  verb is `getHistory` (`history` was rejected); keys on `channelId`
  (required); `limit` optional (server default 50, clamped to
  1..maxHistoryItems).

CRDT declarations (`client.crdt.subscribe/unsubscribe/update/awareness`)
matched service ground truth and are unchanged. fileupload / videohangout /
notification / generic-subscribe declarations remain client-hook contracts
with no gateway service counterpart (documented in-file). The `cursor`
service (`update|subscribe|unsubscribe|get|modes`) has no client.*
declarations and no realtime-modules client hook — nothing to correct.

Compat: `event-catalog drift` old→new registry snapshot reports
3 added / 3 removed / 6 changed — all within the `client.*` namespace.
No FeatureBundle references `client.*` events, so all bundle fingerprints
are unchanged (no bundle-level delta for `ec-bundle-diff`).

## [0.3.55] - 2026-06-10

Wave A2 — declare the WebSocket client-frame contract.
(Versions 0.3.2–0.3.54 predate the resumption of this changelog; see git
history for those releases.)

### Added

- **`src/declarations/client-frames.ts`** — 37 new declarations:
  - 25 OUTBOUND client→gateway frames (`client.<service>.<action>`,
    namespace `client`, producer `realtime-modules-client`, tag
    `client-frame`) covering every `{ service, action, channel, ... }`
    frame the `@connorhoehn/realtime-modules/client` hooks send:
    chat (3), presence (3), reaction (1), activity (3), crdt (4),
    fileupload (3), videohangout (6), generic `subscribe` multiplexer (2).
  - 12 INBOUND gateway→client push frames missing from
    `gateway-signal.ts` (namespace `ws`, tag `client-contract`):
    `ws.presence.joined`/`.left`, `ws.fileupload.progress`/`.scanning`/
    `.cancelled`, `ws.videohangout.participant`/`.media`,
    `ws.notification.new`/`.read`/`.bulk-update`,
    `ws.capability.updated`, `ws.feature-flag.updated`.
  - Known naming tensions (videohangout:* vs ws.call.*, fileupload:* vs
    ws.upload.*, scanning-vs-scanned, presence:joined vs type:"presence"
    action frames) are documented in declaration descriptions — no wire
    renames in this wave.
- **`src/generated/client-frames.ts`** (new typegen output) —
  `ClientFramePayloadMap`, `ClientFramePayload<K>`, plus per-service
  `<Service>OutboundFrame` (8) and `<Service>InboundFrame` (14) union
  types. Exported on the new `./client-frames` package subpath;
  `ClientFramePayloadMap`/`ClientFramePayload` and the three declaration
  arrays (`clientFrameDeclarations`,
  `clientFrameOutboundDeclarations`, `clientContractInboundDeclarations`)
  are also re-exported from the package root.
- `scripts/generate-types.ts` now emits both generated files.

### Notes

- `contracts/registry.snapshot.json` regenerated — strictly additive
  (37 added, 0 changed, 0 removed); 143 → 180 events.

## [0.3.1] - 2026-05-14

Fixup release for `0.3.0` — ship missing `dist/declarations/` compiled
output. `v0.3.0` was tagged without the declaration JS committed, so
downstream consumers got `Cannot find module './declarations/index'`
at require time. Tag `v0.3.0` left in place but consumers should pin
`v0.3.1` or later.

### Fixed

- Commit `dist/declarations/` (was untracked) so git-pin consumers
  resolve the `pipelineDeclarations` + `pipelineP1Declarations`
  exports.

## [0.3.0] - 2026-05-14

First release pinnable from downstream consumers as a real git tag (replacing
the temporary `file:../event-catalog` workspace pins used by `platform-api`
and `websocket-gateway`).

Significant API + service surface accumulated since `v0.1.1`; bumping straight
to `0.3.0` (skipping `0.2.0`) to signal the size of the jump.

### Added

- **Wave 1 — declarations + publish API**
  - `publishSignal()` library API for validated emits over Redis pub/sub
    (wave1-ec-3).
  - Declarations for `pipeline.approval.*` and `pipeline.run.checkpoint`
    events (wave1-ec-1).
  - Bulk declaration of 18 P1 pipeline events covering `pipeline:step:*`,
    `pipeline:llm:*`, and `pipeline:context:*` (wave1-ec-2).
- **Wave 2 — service + observability**
  - `/health` liveness endpoint and `/metrics` Prometheus-format endpoint
    (wave2-ec-5).
  - Admin UI additions: DLQ browser and `DeclarationViewer` component
    (wave2-ec-5).
- **Wave 3 — schema-fetch + compat-gate strict mode**
  - `GET /api/events/{name}?version=N` endpoint so downstream validators
    can fetch schemas without bundling the catalog (wave3-ec-6).
  - Compat-gate strict mode on `POST /api/events`, with per-event
    `compatMode` honored when evolving an existing declaration
    (wave3-ec-7).
  - `docs/architecture.md` — hybrid library + service reference
    (wave3-ec-8).

### Notes

- Peer dep on `@connorhoehn/message-queue` remains optional.
- `distributed-core` pinned to `v0.18.1` (unchanged since `0.1.1`).

## [0.1.1] - prior

DC v0.18.1 alignment release. See git history for details.
