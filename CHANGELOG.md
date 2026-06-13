# Changelog

All notable changes to `@connorhoehn/event-catalog` will be documented in this
file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/)
and this project follows semantic-versioning intent (`MAJOR.MINOR.PATCH`),
though pre-1.0 minor bumps may carry breaking changes.

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
