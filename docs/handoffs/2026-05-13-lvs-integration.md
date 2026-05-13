# Handoff to live-video-streaming: event-catalog adoption + `/sessions` contract

**Date:** 2026-05-13
**From:** platform-api / event-catalog work session
**To:** live-video-streaming agent (owns `/Users/connorhoehn/Projects/live-video-streaming`)
**Scope:** documentation only — no LVS files were modified in this session
**Status:** open; pick up when LVS post-parity / distributed-core hardening work permits

This document captures three coordinated items that should land on the LVS
side. None of them are urgent enough to interrupt LVS's current focus
(distributed-core integration hardening + pod-kill race fixes); they should
be picked up in order when capacity permits.

---

## Background

This session shipped 12 phases across 4 sibling repos:
- **Phase 54** — `distributed-core` pin reconciled to `#v0.17.2` across gateway, platform-api, event-catalog, message-queue (all consumers aligned).
- **Phase 55** — `channel_message` envelope is a shared type in `event-catalog/src/types/envelopes.ts`. Both platform-api and gateway import the builder.
- **Phase E3 / E4** — `EventDeclaration` grew `transport: 'both'`, `producer: string[]`, `discriminator`, `aliases`, plus durable per-queue config fields (`queue`, `retention`, `fifo`, `partitionKey`, `dlqAfterAttempts`). Strict-mode enforcement (`EVENT_CATALOG_STRICT=true`) returns 409 on compat-breaking declarations.
- **Phase 57a/b/c** — first end-to-end M2 loop: gateway dual-publishes `activity.recorded` (signal+durable); platform-api consumer drains the durable queue → DDB. Gateway no longer holds activity persistence in production.

Three items on the LVS roadmap intersect with this work. They are
captured here so the LVS agent has a single read to align on.

---

## Item 1: `/sessions` contract spec (HANDOFF-FROM-WSG-FOLLOWUPS task #2)

The gateway frontend's `useVideoCall.ts` already calls platform-api's
`/api/video/sessions/*` proxy, which today forwards to VNL (AWS IVS).
Migrating the FE off VNL requires LVS to expose three routes matching the
contract that platform-api proxies through.

### Proposed shape

```http
POST /sessions
Content-Type: application/json

Request body: { documentId: string, ownerUserId: string }

Response 201:
{ sessionId: string, channelArn: string }
```

```http
POST /sessions/:sessionId/join
Content-Type: application/json

Request body: { userId: string }

Response 200:
{ token: string, participantId: string, userId: string }
```

The returned `token` is the load-bearing field. The FE passes it directly
into `new Stage(token, strategy)` from `@local-ivs/web-broadcast` (the
shim LVS already built in `live-video-streaming/web-broadcast-shim/`).
**The token format is task #3 of the HANDOFF-FROM-WSG-FOLLOWUPS** and is
still pending the LVS agent's design decision. Proposed shape (open for
revision):

```jsonc
{
  "arn": "arn:local:channels/<channel-id>",
  "participantId": "<ulid>",
  "userId": "<cognito-sub>",
  "capabilities": ["PUBLISH", "SUBSCRIBE"],
  "exp": 1716998400
}
```

```http
POST /sessions/:sessionId/end
Content-Type: application/json

Request body: { userId?: string }

Response 200:
{ remaining: number, ended: boolean }
```

End-session is idempotent: returns 200 even if already ended. When the last
participant leaves, `ended: true` triggers channel-reaper cleanup.

### Coordination notes

- These routes are an alias / convenience layer over `/api/channels/*`. They
  don't replace the channels API; they sit alongside it.
- platform-api's existing `videoSessions.ts` route handlers can be adapted
  to call these endpoints once they exist — the change on platform-api side
  is small (swap `VIDEO_API_URL` callsites).
- Auth: gateway passes `Authorization: Bearer <Cognito IdToken>`. LVS should
  accept either Cognito tokens or LVS-minted service-account tokens
  (HANDOFF task #4). Simplest path: a `vnl-auth.ts` shim that no-ops in dev.

---

## Item 2: Declare SFU events in event-catalog (Phase E2.3)

The 2026-05-13 audit identified ~25 cross-service events the SFU emits today
that are not declared anywhere. event-catalog's `EventDeclaration` API is
now strict-mode-capable (Phase E4), so once these are declared with valid
schemas, drift is caught at deploy time instead of in production.

### Declarations to add (LVS-side)

LVS would add `@connorhoehn/event-catalog` as a dependency and create
`live-video-streaming/src/event-declarations.js` (or .ts) along these lines:

```ts
// Cross-pod chat-bus events (signal)
catalog.declare({
  name: 'sfu.chat.message',
  transport: 'signal',
  producer: 'sfu-cluster',
  channel: (p) => `chat-bus:${p.channelArn}`,
  schema: {
    type: 'object',
    properties: {
      type: { const: 'chat.message' },
      channelArn: { type: 'string' },
      participantId: { type: 'string' },
      content: { type: 'string' },
      timestamp: { type: 'string' },
    },
    required: ['type', 'channelArn', 'content'],
  },
});

// SFU control plane (signal)
catalog.declare({
  name: 'sfu.participant.joined',
  transport: 'signal',
  producer: 'sfu-cluster',
  schema: { /* participantId, channelArn, kind, timestamp */ },
});
// ... participant.left, producer.added/removed, sfu:router:created,
// sfu:pipe:created, sfu:pipe:connected, etc.

// Webhook events (DURABLE — these have replay value for billing/analytics)
catalog.declare({
  name: 'sfu.stream.started',
  transport: 'durable',
  producer: 'sfu-cluster',
  queue: 'sfu-stream-events',
  retention: 7 * 24 * 60 * 60, // 7 days
  schema: { /* channelArn, broadcasterId, kind, startedAt */ },
});
// ... stream.ended, stream.health.degraded, stream.health.recovered,
// stream.thumbnail.updated, recording.started, recording.completed,
// channel.created, channel.updated, channel.deleted, session.created, session.ended
```

Reference: gateway already declares its ~23 WS frame types this way in
`websocket-gateway/src/observability/gateway-event-declarations.js` —
that's the template.

### Why event-catalog rather than just docs

- Once declared, the events show up in `GET /api/topology?producer=sfu-cluster`
  and the future admin UI.
- Strict-mode publish (E4.1) catches schema drift between
  `chatBans.js` and `ChatHub.js` at compile/declare time — see item 3.
- Other agents (platform-api, gateway) can subscribe via the catalog using
  declared names, surviving future channel-name changes.

---

## Item 3: Fix chat-bus casing drift (drift hazard #3)

This is a **real, latent bug** identified in the 2026-05-13 audit:

- `live-video-streaming/src/api/channels/chatBans.js:44, 90` publishes:
  `JSON.stringify({ type: 'user.banned', userId, ... })` — **lowercase `type`**
- `live-video-streaming/src/chat/ChatHub.js:208` publishes:
  `{ Type: 'MESSAGE', Id: ..., Content: ... }` — **PascalCase `Type`**

Both publish to the same Redis channel pattern (`chat-bus:${arn}`).

- The subscriber `ChatHub._onBusMessage:137` reads `payload.Type === 'USER_DISCONNECTED'`.
- Because chatBans uses lowercase `type`, **chatBans events are silently dropped** by every consumer that checks `Type`.

### Recommended fix (LVS-side)

Pick a canonical casing convention (lowercase dotted is the platform default
elsewhere — `social:post`, `doc:comment_added`, etc.) and normalize both
publishers + subscriber to match:

```js
// chatBans.js — keep current shape
const event = { type: 'user.banned', userId, channelArn, timestamp };

// ChatHub.js:208 — change Type → type, normalize key names
const event = { type: 'chat.message', id, content, channelArn, timestamp };

// ChatHub.js:137 — change Type → type
if (payload.type === 'user.disconnected') { /* ... */ }
```

Once Item 2 ships, declaring these events in event-catalog with the
canonical schema gives strict-mode protection against future regressions.

### Why this matters

- Operators won't see chat-ban events in the chat history.
- Cross-pod ban propagation in distributed-core mode is broken.
- Audit trail for moderation is incomplete.

---

## Order of operations (suggested)

1. **Item 3 first** — small bug fix, doesn't depend on event-catalog. Closes
   a real production-shaped drift.
2. **Item 1 second** — `/sessions` contract spec. This unblocks the gateway
   FE migration off VNL, which is the top long-pending item.
3. **Item 2 third** — event-catalog adoption. Higher-effort but unlocks
   topology visibility, compat gating, and the future admin UI. Depends on
   token format (task #3) being decided since `sfu.session.started` will
   reference the token shape.

---

## Cross-references

- LVS `HANDOFF-FROM-WSG-FOLLOWUPS.md` — original 11-task list from WSG.
- event-catalog `ROADMAP.md` Phase E2.3 — "SFU declarations land via handoff
  to LVS agent. That repo has its own agent; respect the boundary."
- websocket-gateway `.planning/ROADMAP.md` v6.0 Phase 60 — references the
  `/sessions` contract for edge-gateway multiplexer routing.
- Audit memory `lvs-integration-state-2026-05-13.md` — current status snapshot.

## Contact / coordination

When picking this up, the platform-api / event-catalog / gateway sides will
not need any new work to integrate — they're already declared-and-ready.
The only ongoing coordination concern is the token format (Item 1), which
might motivate a small adjustment to platform-api's `videoSessions.ts`
route handlers once LVS finalizes it.
