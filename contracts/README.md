# Published contract artifacts

Everything in this directory is a **shipped artifact** — committed, published
in the npm package, and meant to be read by someone outside this repo. Three
of the four are generated from `src/declarations/`; one is hand-maintained.

| File | Spec | Scope | Maintenance |
| --- | --- | --- | --- |
| [`asyncapi.yaml`](./asyncapi.yaml) | AsyncAPI 2.6.0 | The gateway's multiplexed WebSocket protocol — 31 `client.*` outbound frames and 79 `ws.*` inbound send-backs. **110 of 229 declarations.** | Generated — `npm run generate-asyncapi` |
| [`asyncapi.registry.yaml`](./asyncapi.registry.yaml) | AsyncAPI 3.0.0 | The broker-addressed backbone — every event on Redis pub/sub or the durable message-queue, one channel per event. **The other 119 declarations.** | Generated — `npm run generate-asyncapi` |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1.0 | The gateway's HTTP side-channel — channel publish, presence/chat/activity history, capability + feature-flag queries, user notifications. | Hand-maintained |
| [`registry.snapshot.json`](./registry.snapshot.json) | — | Fingerprint manifest of **all 229 declarations**. A drift baseline for producer CI, not a client contract. | Generated — `npm run snapshot:regen` |

**110 + 119 = 229, with no overlap.** Every declaration in the registry is
described in exactly one of the two AsyncAPI documents, and
`tests/asyncapi-structure.test.ts` asserts the union and the empty
intersection so that stays true.

## Why two AsyncAPI documents

They are different protocols with different addressing models, and one
document cannot describe both without lying about one of them.

- **Gateway frames** (`client.*`, `ws.*`) have **no broker address**. Look at
  the declarations: not one of the 110 sets `channel` or `queue`, because
  there is nothing to set — they are all multiplexed over a single WebSocket
  connection and discriminated in-band, by `{service, action}` outbound and by
  `type` inbound. AsyncAPI models that as **one** channel whose two operations
  each carry a `oneOf` over every frame.
- **Backbone events** (everything else) **are** broker-addressed: a Redis
  pub/sub channel or a message-queue queue, one address per event. AsyncAPI
  models that as **one channel per event**, each with its own address and its
  own server.

Merging them would put a `ws://` server next to a `redis://` and an `http://`
one, mix two incompatible channel styles in a single `channels` map, and give
codegen no way to tell which half it is looking at. The split is checked, not
assumed: `tests/asyncapi-structure.test.ts` fails if a `client.*` / `ws.*`
declaration ever grows a `channel` or a `queue`, because at that point the
stated rule would no longer be the real one.

Each document also carries its own scope in machine-readable form at
`info.x-event-catalog-coverage` — declaration counts, the companion file, and
the partition rule — so a reader who fetched only the raw YAML still learns
what it omits without finding this README.

## `registry.snapshot.json`

A flat, key-sorted `{ "<event name>": "<sha256>" }` map — one entry per event
in `allDeclarations`, written by
[`scripts/regen-registry-snapshot.ts`](../scripts/regen-registry-snapshot.ts).
Producers diff their own emitted shapes against it:

```bash
event-catalog drift --against=contracts/produced.snapshot.json \
  --registry-snapshot=node_modules/@connorhoehn/event-catalog/contracts/registry.snapshot.json
```

The fingerprint is `sha256(stableStringify(schema))` — key order does not
matter, but **everything else in the schema object does, descriptions and
`format` annotations included** (`src/registry/fingerprint.ts`). So a
documentation-only edit moves a fingerprint. That is deliberate: the
description is part of what a consumer was told, and a producer diffing
against a stale copy should notice.

Regenerate it after ANY declaration change, alongside
`npm run generate-types`.

## What `asyncapi.yaml` covers

The gateway multiplexes **every** frame over a single WebSocket connection
(there are no per-topic URLs), so the document has one channel, `/`, with:

- **`publish`** — the 31 frames the client SENDS: chat `join`/`leave`/`send`/
  `history`, presence `subscribe`/`unsubscribe`/`set`/`get`/`heartbeat`,
  reaction `subscribe`/`unsubscribe`/`send`/`getAvailable`, activity
  `subscribe`/`unsubscribe`/`getHistory`, crdt `subscribe`/`unsubscribe`/
  `update`/`awareness`, fileupload, videohangout, and the generic `subscribe`
  multiplexer.
- **`subscribe`** — the 79 frames the client RECEIVES: every `ws.*` send-back
  / broadcast (session, subscribe acks, chat, presence, reaction, activity,
  crdt, cursor, call, pipeline, upload, notification, capability,
  feature-flag, …). The first frame after connect is always
  `ws.session.connected`.

Every message's `payload` is the **exact JSON Schema** from the
`@connorhoehn/event-catalog` declaration, dropped in verbatim — including the
`format: date-time` / `format: uri` annotations that `field-glossary.ts`
stamps on. The frame shapes are not hand-written here.

> **Audience note.** AsyncAPI 2.x is application-centric: `publish` /
> `subscribe` are written from the *client adopter's* perspective (publish =
> what you send, subscribe = what you receive).

`tests/asyncapi.test.ts` holds the committed file to that claim: it asserts
every in-scope declaration is present, every payload equals its declaration's
schema, every summary equals its description, and that no message is defined
without being referenced (or referenced without being defined). If you edit a
declaration and forget to regenerate, that test fails.

### What it does NOT cover

The 119 broker-addressed backbone events — `pipeline` (48), `sfu` (30),
`ag-ui` (29), `orgiq` (6), `transcription` (3), `call` (2), `activity` (1).
They are not gateway frames and they are not absent from the published
contracts: they are in
[`asyncapi.registry.yaml`](./asyncapi.registry.yaml), described below.

## What `asyncapi.registry.yaml` covers

Every declaration that moves over a broker, as AsyncAPI **3.0.0**. It is
produced by the same `buildAsyncApiSpec` (`src/server/asyncapi.ts`) that the
server renders live at `GET /api/asyncapi`, so the committed artifact and the
live endpoint cannot drift into describing the backbone differently.

**Servers.** Two, and each channel names the one its address is valid on:

- `signalRedis` — Redis pub/sub, the ephemeral `signal` transport.
  Fire-and-forget: no persistence, no retry, no delivery guarantee.
- `durableMessageQueue` — the `@connorhoehn/message-queue` service, the
  persisted retryable `durable` transport, at `/api/v1/queues`.

**Channels.** One per `(transport, event)`. A `transport: 'both'` event
appears twice, once per server, because it genuinely goes to both. The
`address` is what the publish path actually uses: the declared `channel` for
signal, and `queue ?? eventNameToQueueName(name)` for durable — the same
`:`/`.` → `-` derivation `EventCatalog.publish` applies, so `activity.recorded`
is addressed `activity-recorded`, not `activity.recorded`.

**Bindings, honestly.** AsyncAPI's bindings catalog has a `redis` entry
(reserved, no properties yet) and nothing at all for this platform's
message-queue. So signal channels carry the real, empty `redis` binding, and
durable channels carry **no** `bindings` object rather than an invented `mq`
protocol key that no tool recognizes. Both carry
`x-event-catalog-transport`, plus, for durable, `x-event-catalog-queue-source`
(`declared` vs `derived-from-event-name`) and the retention / FIFO / DLQ
settings from the declaration.

**Deprecation.** A message for an event with deprecated aliases carries
`x-aliases` — those names are still on the wire, and a consumer written from a
document that omitted them would silently ignore live messages. A deprecated
event (via the runtime `deprecate` API) additionally gets `x-deprecated` and a
synthetic `deprecated` tag. `asyncapi.yaml` emits `x-aliases` too; no gateway
frame has one today, and the test asserts the capability rather than the
absence, so the first one to appear is carried rather than dropped.

For a filtered view, ask a running server:

```
GET /api/asyncapi                 # AsyncAPI 3.0, every registered event
GET /api/asyncapi?namespace=sfu
```

Note the live endpoint is unfiltered by design: it renders whatever is
registered, gateway frames included. The committed artifact excludes them
(`excludeNamespaces: ['client','ws']`) precisely because addressing a
multiplexed WebSocket frame as a Redis channel would be a claim that is not
true.

## Regenerating

```bash
npm run generate-asyncapi   # -> contracts/asyncapi.yaml + asyncapi.registry.yaml
npm run snapshot:regen      # -> contracts/registry.snapshot.json
```

`npm run generate-asyncapi` writes **both** AsyncAPI documents.

**Do not hand-edit any of them** — edit `src/declarations/` and regenerate.
`tests/asyncapi.test.ts` re-renders both documents and deep-compares them
against the committed files, so forgetting to regenerate fails the suite.

### Validation

`tests/asyncapi-structure.test.ts` checks what can be checked without adding a
dependency: the YAML parses with no errors or warnings (which is how a
duplicate mapping key gets caught), required fields are present, **every
`$ref` resolves** by JSON-pointer walk, nothing defined is unreferenced (no
orphan messages, schemas or servers), component keys match AsyncAPI's
`^[A-Za-z0-9_\-.]+$` pattern, and every payload is a structurally valid JSON
Schema per the registry's own `validateSchemaShape`.

That is **not** meta-schema conformance. A misspelled spec key (`mesages:`)
would read as an unknown extension and pass every check above. For that you
need a real validator, which needs network:

```bash
npx @asyncapi/cli validate contracts/asyncapi.yaml
npx @asyncapi/cli validate contracts/asyncapi.registry.yaml
```

## The OpenAPI

`openapi.yaml` is hand-maintained: the REST routes are not declared in this
package. Its component schemas cross-reference the event-catalog declarations
via five `x-event-catalog-ref` extensions where the REST payload mirrors a WS
frame (e.g. `ChatMessage` ↔ `ws.chat.message`). Source of truth for the route
shapes — these moved out of `websocket-gateway` into `realtime-examples`:

- `realtime-examples/src/realtime-fanout/api-routes.ts`
- `realtime-examples/src/realtime-fanout/notification/notify-route.ts`

Lint it (optional):

```bash
npx @redocly/cli lint contracts/openapi.yaml
```

## Not shipped here

**Feature bundles** (`src/declarations/bundles/`) are versioned groupings of
events for capability negotiation. They ship as code and over the server's
bundle routes, not as a file in this directory — don't go looking for a
`bundles.json`.

## Not yet expressible

A few WS frames have a **documented naming tension** in the declarations (the
client hook consumes a `videohangout:*` / `fileupload:*` type while the gateway
service emits a `type:"call"` / `type:"upload"` envelope). Both sides are
declared and therefore both appear in the AsyncAPI as distinct messages — the
spec faithfully reflects the wire, including those divergences. See the
declaration descriptions under `src/declarations/client-frames/` (re-exported
by `client-frames.ts`) for the per-frame notes.
