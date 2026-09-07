# Published contract artifacts

Everything in this directory is a **shipped artifact** — committed, published
in the npm package, and meant to be read by someone outside this repo. Two of
the three are generated from `src/declarations/`; one is hand-maintained.

| File | Spec | Scope | Maintenance |
| --- | --- | --- | --- |
| [`asyncapi.yaml`](./asyncapi.yaml) | AsyncAPI 2.6.0 | The gateway's multiplexed WebSocket protocol — 31 `client.*` outbound frames and 79 `ws.*` inbound send-backs. **110 of the registry's 229 events**; see "What it does NOT cover" below. | Generated — `npm run generate-asyncapi` |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1.0 | The gateway's HTTP side-channel — channel publish, presence/chat/activity history, capability + feature-flag queries, user notifications. | Hand-maintained |
| [`registry.snapshot.json`](./registry.snapshot.json) | — | Fingerprint manifest of **all 229 declarations**. A drift baseline for producer CI, not a client contract. | Generated — `npm run snapshot:regen` |

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
- **`subscribe`** — the 80 frames the client RECEIVES: every `ws.*` send-back
  / broadcast (session, subscribe acks, chat, presence, reaction, activity,
  crdt, cursor, call, pipeline, upload, notification, capability,
  feature-flag, …) plus one hand-inlined `SessionBootstrap`, on which see
  below.

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

`asyncapi.yaml` is scoped to one protocol. The generator partitions on the
`client.` and `ws.` name prefixes, so **119 declarations are deliberately
absent**: `pipeline` (48), `sfu` (30), `ag-ui` (29), `orgiq` (6),
`transcription` (3), `call` (2), `activity` (1). They are not gateway frames.

For the whole-registry view, use the **live** spec the server renders:

```
GET /api/asyncapi              # AsyncAPI 3.0, every registered event
GET /api/asyncapi?namespace=sfu
```

That one is AsyncAPI **3.0.0** (`src/server/asyncapi.ts`), gives each
`(transport, event)` pair its own channel addressed by the declared Redis
channel or queue name, and marks a deprecated event with an `x-deprecated`
extension plus a synthetic `deprecated` tag. This static 2.6 file cannot
express deprecation at all — harmless today only because none of the 25
deprecated aliases in the registry is a `client.*` / `ws.*` frame, which
`tests/asyncapi.test.ts` asserts so the day that changes is loud.

### One frame is described twice

`scripts/generate-asyncapi.ts` hand-inlines the welcome frame as a message
called `SessionBootstrap`, with a comment explaining that it does so because
the frame "has no event-catalog declaration". As of 2026-09-07 it has one:
`ws.session.connected` (`src/declarations/gateway-signal/session.ts`), read
off the emit site at `realtime-examples/src/server.ts:2507` and stricter than
the inlined copy. Until the generator drops its inline block, the published
spec carries the same wire frame under two message names. Adopters should
follow `ws_session_connected`. `tests/asyncapi.test.ts` asserts this state so
it cannot drift, and that test should be deleted when the generator is fixed.

## Regenerating

```bash
npm run generate-asyncapi   # -> contracts/asyncapi.yaml
npm run snapshot:regen      # -> contracts/registry.snapshot.json
```

**Do not hand-edit either file** — edit `src/declarations/` and regenerate.
Validate the AsyncAPI (optional, needs network):

```bash
npx @asyncapi/cli validate contracts/asyncapi.yaml
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
