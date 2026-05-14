# Changelog

All notable changes to `@connorhoehn/event-catalog` will be documented in this
file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/)
and this project follows semantic-versioning intent (`MAJOR.MINOR.PATCH`),
though pre-1.0 minor bumps may carry breaking changes.

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
