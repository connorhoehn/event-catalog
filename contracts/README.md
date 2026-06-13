# websocket-gateway machine-readable contracts

This directory ships the **adopter on-ramp** for the websocket-gateway: a
machine-readable description of both its WebSocket protocol and its REST
side-channel, so non-React / non-JS clients can integrate without reading the
`@connorhoehn/realtime-modules` hook source.

| File | Spec | Covers |
| --- | --- | --- |
| [`asyncapi.yaml`](./asyncapi.yaml) | AsyncAPI 2.6.0 | The multiplexed WebSocket protocol — every `client.*` outbound frame, every `ws.*` inbound send-back, plus the session-bootstrap welcome frame. |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1.0 | The HTTP side-channel — channel publish, presence/chat/activity history, capability + feature-flag queries, and user notifications. |
| [`registry.snapshot.json`](./registry.snapshot.json) | (existing) | Producer-CI drift snapshot of all declarations. Not a client contract. |

## What the AsyncAPI covers

The gateway multiplexes **every** frame over a single WebSocket connection
(there are no per-topic URLs), so the document has one channel, `/`, with:

- **`publish`** — frames the client SENDS to the gateway (`client.*`,
  31 frames): chat `join`/`leave`/`send`/`history`, presence
  `subscribe`/`unsubscribe`/`set`/`get`/`heartbeat`, reaction
  `subscribe`/`unsubscribe`/`send`/`getAvailable`, activity
  `subscribe`/`unsubscribe`/`getHistory`, crdt
  `subscribe`/`unsubscribe`/`update`/`awareness`, fileupload, videohangout,
  and the generic `subscribe` multiplexer.
- **`subscribe`** — frames the client RECEIVES from the gateway: the
  `SessionBootstrap` (`type:"session"`) welcome frame followed by every
  `ws.*` send-back / broadcast (chat, presence, reaction, activity, crdt,
  cursor, call, pipeline, upload, notification, capability, feature-flag, …).

Every message's `payload` is the **exact JSON Schema** from the
`@connorhoehn/event-catalog` declaration — the frame shapes are not
hand-written here.

> **Audience note.** AsyncAPI 2.x is application-centric: `publish` /
> `subscribe` are written from the *client adopter's* perspective (publish =
> what you send, subscribe = what you receive).

## Regenerating the AsyncAPI

The AsyncAPI is **generated** from the declarations so it stays in sync:

```bash
npm run generate-asyncapi
```

This runs [`scripts/generate-asyncapi.ts`](../scripts/generate-asyncapi.ts),
which imports the same `allDeclarations` set as `generate-types.ts`, partitions
it into `client.*` (outbound) and `ws.*` (inbound), and drops each
declaration's JSON Schema in verbatim. **Do not hand-edit `asyncapi.yaml`** —
edit the declarations in `src/declarations/` and regenerate.

Validate it (optional — requires network for the CLI):

```bash
npx @asyncapi/cli validate contracts/asyncapi.yaml
```

## The OpenAPI

`openapi.yaml` is hand-maintained (the REST routes live in `websocket-gateway`,
not in this package). Its component schemas cross-reference the event-catalog
declarations via `x-event-catalog-ref` extensions where the REST payload
mirrors a WS frame (e.g. `ChatMessage` ↔ `ws.chat.message`). Source of truth
for the route shapes:

- `websocket-gateway/src/realtime-fanout/api-routes.ts`
- `websocket-gateway/src/realtime-fanout/notification/notify-route.ts`

Lint it (optional):

```bash
npx @redocly/cli lint contracts/openapi.yaml
```

## Not yet expressible

A few WS frames have a **documented naming tension** in the declarations (the
client hook consumes a `videohangout:*` / `fileupload:*` type while the gateway
service emits a `type:"call"` / `type:"upload"` envelope). Both sides are
declared and therefore both appear in the AsyncAPI as distinct messages — the
spec faithfully reflects the wire, including those divergences. See the
declaration descriptions in `src/declarations/client-frames.ts` for the
per-frame notes.
