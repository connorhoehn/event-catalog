# Changelog

All notable changes to `@connorhoehn/event-catalog` will be documented in this
file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/)
and this project follows semantic-versioning intent (`MAJOR.MINOR.PATCH`),
though pre-1.0 minor bumps may carry breaking changes.

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
