# FeatureBundle Design — Capability-Platform CRD Binding

**Status:** Design / pre-implementation  
**Date:** 2026-05-21  
**Scope:** event-catalog library + service

---

## 1. Problem Statement

The event-catalog today registers 115 events across four declaration files
(`gateway-signal.ts`, `ag-ui.ts`, `pipeline*.ts`) using a flat namespace
keyed only by dot/colon-prefixed names (e.g. `ws.chat.message`,
`pipeline:run:completed`). This is sufficient for event-level discovery and
schema drift detection.

It is **not** sufficient for the capability platform's CRD model.

When a CRD like `ChatRoom` is applied to a gateway replica it needs to
activate a coherent set of wire frames — joins, leaves, messages, history,
errors — not a hand-picked list of individual event names that an operator
must maintain in sync with evolving catalog versions. Three concrete pain
points drive this:

1. **CRD pinning is impossible at the event level.** An operator declaring a
   `ChatRoom` CR shouldn't need to know that `ws.chat.joined` is at schema
   version 4. They should pin to a bundle fingerprint that covers all five
   chat frames at once and gets invalidated atomically when any member event
   breaks backward compat.

2. **No capability boundary is expressed.** The registry knows `ws.chat.*`
   exists but not that those five frames constitute a deployable "Chat"
   feature. Discovery tooling, AsyncAPI generation, and the admin UI must
   reconstruct this grouping heuristically from tag prefixes — a leaky
   abstraction that breaks when a feature spans multiple namespaces (e.g.
   `ag-ui.*` + `ws.activity.*` together form the Agentic-Pipeline surface).

3. **Transport heterogeneity is unmodeled.** `ChatRoom` uses signal frames
   only. `AgenticPipeline` mixes signal frames (`ws.pipeline.*`) with
   durable events (`pipeline:run:*`). Today nothing in the catalog binds
   "these signal events and these durable events are all part of one
   deployable capability."

`FeatureBundle` is the grouping primitive that fills this gap.

---

## 2. Proposed Shape

```typescript
// src/bundles/FeatureBundle.ts

export interface EventReference {
  /** Canonical event name, e.g. "ws.chat.message". */
  name: string;
  /**
   * Pin to a specific event schema version. When omitted the bundle
   * accepts the current registered version. Consumers can use this to
   * opt-in to a specific schema shape without locking the whole registry.
   */
  version?: number;
  /**
   * When true this event MUST be registered before the bundle is
   * considered valid. Optional events (e.g. ws.cursor.modes) may be
   * omitted by a lightweight implementation.
   */
  required?: boolean;
}

export interface FeatureBundle {
  /** Short machine-readable identifier. Used as the CRD kind lower-case. */
  name: string;
  /** Semver string. Bumped when the event set or any required schema changes. */
  version: string;
  /**
   * Content-addressable fingerprint of the bundle: sha256 of the
   * stable-stringified { name, version, events } tuple. Recomputed on
   * every registerFeatureBundle() call. CRDs embed this to detect drift
   * without a live registry round-trip.
   *
   * Algorithm mirrors computeSchemaFingerprint() in
   * src/registry/fingerprint.ts — same stableStringify + sha256.
   */
  fingerprint: string;
  /** All events that make up this capability. Order is significant for display only. */
  events: EventReference[];
  /**
   * Aggregate transport: 'signal' if all events are signal, 'durable' if
   * all are durable, 'both' if mixed. Derived by validateBundle() from
   * registered event transports; declared here for CRD-layer gate checks
   * that run before a live catalog is available.
   */
  transport: 'signal' | 'durable' | 'both';
  description?: string;
  /**
   * Set when this bundle is superseded by a newer bundle. The old
   * bundle name keeps working; callers that query it receive the
   * deprecation annotation in the response.
   */
  deprecated?: {
    since: string;         // ISO 8601 or semver
    replacement?: string;  // name of the replacement bundle
  };
}
```

### Fingerprint algorithm

The bundle fingerprint is `sha256(stableStringify({ name, version, events }))`.
Only `name`, `version`, and the sorted event reference list feed the hash —
`description` and `deprecated` are excluded so documentation edits don't
invalidate CRD pins.

`stableStringify` from `src/registry/fingerprint.ts` is reused directly;
no new dependency is introduced.

---

## 3. Composition — CRD References a Bundle

A CRD spec embeds the bundle name + fingerprint at authoring time:

```yaml
# Example: ChatRoom CRD applied to a gateway replica
apiVersion: realtime.platform/v1
kind: RealtimeChannel
metadata:
  name: support-room-42
spec:
  bundle:
    name: chat
    version: "1.0.0"
    fingerprint: "a3f1..."   # 12-char prefix is sufficient for display
  roomId: support-room-42
  maxMembers: 200
```

The gateway's CRD controller (Phase 3 work, not in scope here) calls
`getFeatureBundle("chat", "1.0.0")` at admission time and compares the
stored fingerprint to the one in the spec. A mismatch means the catalog
has drifted from when the CRD was authored — the controller rejects and
surfaces an actionable error: _"bundle 'chat' v1.0.0 fingerprint mismatch:
expected a3f1..., got b9c2... — re-author the CRD or pin to v1.1.0"_.

This is analogous to how Helm chart digests work, applied at the
event-schema level.

---

## 4. Storage — Where Bundles Live

```
src/
  bundles/
    FeatureBundle.ts          ← types + BundleRegistry class + API functions
  declarations/
    bundles/
      chat.ts                 ← FeatureBundle literal for "chat"
      presence.ts
      cursor.ts
      reactions.ts
      activity.ts
      agentic-pipeline.ts
      crdt-document.ts
      video-hangout.ts
      file-upload.ts
      index.ts                ← re-exports + allBundles[] aggregate
```

Bundles are **pure data** declared in TypeScript just like `EventDeclaration`s.
No database persistence is required for v1 — bundles are static and
fingerprint-stable; only dynamic subscriber state lives in Redis. A future
phase could persist bundle adoption metadata (which services have registered
a given bundle) to Redis using a separate hash key.

---

## 5. API Surface

### Library API (`src/bundles/FeatureBundle.ts`)

```typescript
/**
 * Add a bundle to the in-process bundle registry. Computes and stamps
 * the fingerprint automatically; caller need not supply it.
 * Throws if a bundle with the same name+version is already registered
 * with a different event set (fingerprint mismatch → likely a bug).
 */
function registerFeatureBundle(bundle: Omit<FeatureBundle, 'fingerprint'>): FeatureBundle;

/**
 * Look up a bundle. When version is omitted returns the highest semver
 * among all registered versions for that name.
 */
function getFeatureBundle(name: string, version?: string): FeatureBundle | undefined;

/** Returns all registered bundles, sorted by name then version. */
function listFeatureBundles(): FeatureBundle[];

/**
 * Validates that:
 *   1. Every required EventReference.name exists in the supplied registry.
 *   2. When EventReference.version is pinned, the registry entry's version matches.
 *   3. The declared transport matches the aggregate transport inferred from
 *      the referenced events' registered transports.
 * Returns a structured result so callers can surface errors gracefully
 * at boot rather than crashing.
 */
function validateBundle(
  bundle: FeatureBundle,
  registry: IRegistry,
): { valid: boolean; errors: string[] };

/**
 * Generates a minimal JSON Schema fragment suitable for embedding in a
 * Kubernetes CRD's `spec.versions[].schema.openAPIV3Schema`. The schema
 * covers the `bundle` field of the CRD spec with required name, version,
 * and fingerprint fields. Emitted as a plain object (no runtime schema
 * library dependency).
 *
 * Example output shape:
 *   { type: 'object', required: ['name','version','fingerprint'],
 *     properties: { name: { type: 'string', enum: ['chat'] },
 *                   version: { type: 'string' },
 *                   fingerprint: { type: 'string', minLength: 64 } } }
 */
function getCrdSchema(bundleName: string): Record<string, unknown> | undefined;
```

`EventCatalog` in `src/client/index.ts` gains two new methods that delegate to
the library API:

```typescript
// Convenience wrappers on the EventCatalog class:
catalog.declareBundle(bundle): FeatureBundle;
catalog.getBundle(name, version?): FeatureBundle | undefined;
```

### HTTP Routes (server — `src/server/routes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/feature-bundles` | `listFeatureBundles()` — all registered bundles. Supports `?name=chat` filter. |
| `GET` | `/api/feature-bundles/:name` | Latest version of the named bundle. |
| `GET` | `/api/feature-bundles/:name/:version` | Specific version. Returns 404 when not found. |
| `POST` | `/api/feature-bundles` | Register or re-register a bundle from a JSON body. Body shape: `Omit<FeatureBundle, 'fingerprint'>`. Fingerprint is computed server-side. Returns the persisted bundle with fingerprint. |
| `GET` | `/api/feature-bundles/:name/crd-schema` | Returns the `getCrdSchema()` output for embedding in a K8s CRD manifest. |

All bundle routes require the same `x-service-auth` header as existing admin
routes. No new auth mechanism needed.

---

## 6. Migration Story — Existing Apps

Existing event declarations in `allDeclarations` are **unchanged**. Bundles
are additive metadata on top of the flat event list.

**Phase 1 — Read-only discovery (zero code change for consumers):**
Bundles are declared in `src/declarations/bundles/*.ts` and registered in the
library at module load time. Existing `catalog.declare()` calls continue to
work. The `GET /api/feature-bundles` endpoint becomes queryable by the gateway
CRD controller and the admin UI.

**Phase 2 — Gateway adopts bundle validation at boot:**
The gateway's boot sequence calls `validateBundle(chatBundle, registry)` after
`catalog.connect()`. If the registry is missing any required event the gateway
fails fast with a descriptive message instead of silently degrading at the
first client message.

**Phase 3 — CRD admission webhooks:**
The gateway's admission controller (Kubernetes webhook or Tilt-based
equivalent) reads `FeatureBundle.fingerprint` from the CRD spec and compares
against the catalog at apply time. This is the full CRD-pinning flow; it
depends on gateway having a running catalog server to query.

**Flat event queries remain unchanged.** `registry.list()`, `registry.get()`,
`catalog.publish()` — all existing APIs work identically. Bundle awareness is
purely opt-in.

---

## 7. Initial Bundles to Define

The following bundles are proposed for initial declaration. Event lists are
drawn from the current `gatewaySignalDeclarations` in
`src/declarations/gateway-signal.ts` and the pipeline declaration files.
Exact event names and required flags are to be confirmed at implementation
time; counts here are approximate.

| Bundle name | Transport | Events (approx.) | Notes |
|---|---|---|---|
| `chat` | signal | 5 | `ws.chat.{joined,left,message,sent,history}` |
| `presence` | signal | 6 | `ws.presence.{set,update,subscribed,unsubscribed,data,offline}` |
| `cursor` | signal | 6 | `ws.cursor.{subscribed,unsubscribed,update,remove,cursors,modes}` |
| `reactions` | signal | 3 | `ws.reaction.{subscribed,received,sent}` |
| `activity` | signal | 5 | `ws.activity.{subscribed,unsubscribed,published,history,event}` |
| `agentic-pipeline` | both | ~12 | `ws.pipeline.*` (signal) + `pipeline:run:*` + approval events (durable) |
| `crdt-document` | signal | 5 | `ws.crdt.{subscribed,unsubscribed,snapshot,update,doc-replaced}` |
| `video-hangout` | signal | 5 | `ws.call.{invite,accepted,declined,cancelled,ended}` |
| `file-upload` | durable | TBD | Not yet declared; placeholder for upload lifecycle events |

**Total: 9 bundles proposed.**

The `ag-ui` protocol events (29 events) are intentionally excluded from initial
bundles. They represent a streaming protocol rather than a deployable gateway
capability; a future `ag-ui-stream` bundle can be defined when OrgIQ's
realtime-modules adoption solidifies the canonical subset needed per feature.

---

## 8. Deprecation Policy

### Marking a bundle deprecated

A bundle version may be deprecated by setting the `deprecated` field:

```typescript
deprecated?: {
  since: string;        // ISO 8601 date or semver milestone, e.g. "2026-05-22" or "v0.3.42"
  replacement?: string; // Recommended upgrade path, e.g. "chat@2.0.0"
}
```

Deprecation is applied at runtime via the admin API rather than by modifying the
source declaration, so that:
1. Existing CRD fingerprints remain valid (deprecated is excluded from the hash).
2. The change is auditable via the admin API rather than requiring a library rebuild.
3. The lint CLI can surface warnings without any file change.

### Fingerprint stability guarantee

The `deprecated` field is **excluded from the fingerprint computation**. This
means marking a bundle deprecated does not invalidate any CRD that pins to that
bundle's fingerprint. Operators upgrading from a deprecated bundle to its
replacement must re-author their CRDs explicitly — they are never silently
invalidated.

### Lint integration

`ec-lint-crd` treats deprecated bundle references as **warnings (exit 2)**, not
errors. CRD operators receive actionable output:

```
CRD: ChatRoom/old-room (deploy/chatroom.yaml:14)
  ✓ eventBundle: chat@1.0.0 exists
  ! eventBundle: chat@1.0.0 — version is deprecated since 2026-05-22 — use chat@2.0.0 instead
```

Errors (bundle not found, fingerprint mismatch) remain exit code 1 and take
precedence — if a file has both deprecated and missing-bundle issues the exit
code is 1.

### Lifecycle

1. **Authoring**: `chat@1.0.0` ships. CRDs reference `chat@1.0.0`.
2. **Evolution**: `chat@2.0.0` ships with extended events.
3. **Deprecation**: Admin calls `PATCH /api/feature-bundles/chat/1.0.0` with `{ deprecated: { since: "2026-05-22", replacement: "chat@2.0.0" } }`.
4. **Discovery**: `ec-lint-crd --list-deprecated` shows the deprecated bundle.
5. **Migration**: CRD operators update their YAML to reference `chat@2.0.0` and run `ec-lint-crd --fix-fingerprints`.
6. **Retirement**: After all consumers have migrated, `chat@1.0.0` can be removed from declarations and the library bumped to a new minor version.

---

## 9. Open Questions

**Q1 — Versioning strategy: event-level vs. bundle-level.**
If `ws.chat.message` schema bumps to version 5, does the `chat` bundle
automatically get a new fingerprint, requiring all CRDs using the `chat` bundle
to be re-authored? Or do we adopt a looser model where the bundle fingerprint
only changes on explicit bundle version bumps? The fingerprint algorithm
proposed (hashing only `{name, version, events}`, not the underlying event
schemas) means the operator must bump `bundle.version` on any event schema
change they consider breaking. This is deliberate — it separates "I updated the
bundle members" (bundle author concern) from "the underlying schema evolved"
(registry concern) — but it requires bundle authors to track event schema drift
manually unless `validateBundle()` is wired into CI.

**Q2 — Cross-bundle dependencies and shared events.**
`ws.error` is relevant to every bundle (any service can emit it). Should shared
events like `ws.error` be `required: false` members of every bundle, or should
they live in a `core` bundle that all feature bundles implicitly extend? The
latter is more composable but introduces a dependency graph that `validateBundle()`
would need to resolve. For v1, the recommendation is to list shared events as
optional members in each bundle and defer cross-bundle inheritance.

**Q3 — Backward compat for bundles across catalog versions.**
When event-catalog is published as a library and a consumer pins to `v0.3.33`,
the `chat` bundle fingerprint is baked into their installed package. If the
catalog service is upgraded to `v0.4.0` with a revised `chat` bundle, the
library-pinned fingerprint and the service-emitted fingerprint diverge. This
is the correct signal (drift!) but it may be surprising in a same-cluster
upgrade. Should `getFeatureBundle()` accept a `tolerance` flag that treats
fingerprint mismatch as a warning rather than an error during a rolling
upgrade window?

---

## 9. Implementation Phasing

### Minimal v1 (2–4 hours)

- Add `src/bundles/FeatureBundle.ts` with `FeatureBundle`, `EventReference`
  types, `BundleRegistry` (plain `Map<string, FeatureBundle[]>`),
  `registerFeatureBundle`, `getFeatureBundle`, `listFeatureBundles`.
- Add `validateBundle()` with event-existence and transport-coherence checks;
  no cross-bundle dependency resolution.
- Add `getCrdSchema()` emitting a static JSON Schema fragment.
- Add `src/declarations/bundles/*.ts` for the 9 bundles listed above (data
  only — no tests needed for literal declarations).
- Register all 9 bundles in `src/declarations/bundles/index.ts` and call
  `registerFeatureBundle()` for each at module load time.
- Add `GET /api/feature-bundles` and `GET /api/feature-bundles/:name` routes
  to `src/server/routes.ts`.

### Nice-to-haves (post-v1)

- `POST /api/feature-bundles` — dynamic registration from the catalog service
  (needed for live CRD admission without a library rebuild).
- `GET /api/feature-bundles/:name/crd-schema` — CRD JSON Schema fragment
  endpoint.
- `catalog.declareBundle()` convenience wrapper on `EventCatalog`.
- CI hook: `validateBundle()` called in `scripts/regen-registry-snapshot.ts`
  so bundle drift is caught at release time.
- Admin UI panel: "Bundles" tab listing registered bundles and their member
  events with fingerprint display.
- Bundle-level subscriber heartbeats: track which services have declared
  awareness of a bundle (for "who is using the chat capability?" queries).

---

## 10. Code Anchors — Implementation Landing Zones

| Concern | File |
|---|---|
| `FeatureBundle` / `EventReference` types + `BundleRegistry` class + all API functions | `src/bundles/FeatureBundle.ts` _(new)_ |
| Chat bundle declaration | `src/declarations/bundles/chat.ts` _(new)_ |
| Presence bundle declaration | `src/declarations/bundles/presence.ts` _(new)_ |
| Cursor bundle declaration | `src/declarations/bundles/cursor.ts` _(new)_ |
| Reactions bundle declaration | `src/declarations/bundles/reactions.ts` _(new)_ |
| Activity bundle declaration | `src/declarations/bundles/activity.ts` _(new)_ |
| Agentic-pipeline bundle declaration | `src/declarations/bundles/agentic-pipeline.ts` _(new)_ |
| CRDT-document bundle declaration | `src/declarations/bundles/crdt-document.ts` _(new)_ |
| Video-hangout bundle declaration | `src/declarations/bundles/video-hangout.ts` _(new)_ |
| File-upload bundle declaration (placeholder) | `src/declarations/bundles/file-upload.ts` _(new)_ |
| Aggregate re-export + boot-time registration | `src/declarations/bundles/index.ts` _(new)_ |
| HTTP routes for bundle endpoints | `src/server/routes.ts` — extend `RoutesDeps` and add `GET /api/feature-bundles*` handlers |
| `catalog.declareBundle()` / `catalog.getBundle()` convenience wrappers | `src/client/index.ts` — extend `EventCatalog` class |
| Fingerprint reuse (no new algorithm needed) | `src/registry/fingerprint.ts` — import `stableStringify` |
| Type export | `src/index.ts` — re-export `FeatureBundle`, `EventReference` from `./bundles/FeatureBundle` |
