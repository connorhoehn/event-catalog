"use strict";
// src/declarations/gateway-durable.ts
//
// The websocket-gateway's DURABLE surface — the two business events it
// publishes through `catalog.publish()` onto message-queue, as opposed to
// the ~50 ephemeral WS push frames in ./gateway-signal.ts.
//
// WHY THIS FILE EXISTS
// --------------------
// These two events have live producers AND live consumers and had never
// been declared here. The gateway declared them locally in
// `src/observability/gateway-event-declarations.ts` (DOMAIN_EVENT_DECLARATIONS)
// and platform-api re-declared them a second time in `src/lib/event-catalog.ts`
// so it could `catalog.subscribe()`. Two copies of a contract with no owner
// is precisely the drift this repo exists to prevent, so the canonical
// declaration now lives here.
//
// COMPLETENESS
// ------------
// Two is the whole durable set, not a sample. Every `catalog.publish(...)`
// call site in the gateway was enumerated:
//   realtime-examples/src/realtime-fanout/activity/GatewayActivityService.ts:152
//       -> catalog.publish('activity.recorded', payload)
//   realtime-examples/src/server.ts:1058
//       -> catalog.publish('call:reaction.recorded', payload)
// There are no others, and `transport: 'durable' | 'both'` appears nowhere
// else in the gateway tree.
//
// SCHEMAS ARE TIGHTER THAN THE GATEWAY'S OWN COPY, DELIBERATELY
// -------------------------------------------------------------
// The gateway's mirror is loose by construction — `baseFrameSchema()` emits
// `required: ['type']` for every WS frame and the two domain events inherit
// the same habit. The declarations below instead state what the producer's
// object literal UNCONDITIONALLY constructs, verified at the emit site:
//
//   activity.recorded       — realtime-modules ActivityService.handlePublish
//                             (src/activity/ActivityService.ts:255-261) builds
//                             `enrichedPayload` with all five keys always set:
//                             `detail: event.detail || {}`,
//                             `timestamp: new Date().toISOString()`,
//                             `userId: … ?? null`,
//                             `displayName: … ?? userId ?? 'anonymous'`.
//                             The gateway forwards that exact object.
//   call:reaction.recorded  — realtime-examples/src/server.ts:1044-1056 builds
//                             `payload` with six keys always set, then adds
//                             `displayName` / `effect` only when defined —
//                             so those two, and only those two, are optional.
//
// `additionalProperties` stays `true` on both. It is not laziness: the
// call-reaction consumer already reads an `orgId` the producer does not yet
// stamp (platform-api/src/services/call-reaction-consumer.ts:27-28, "Absent
// today"), so closing the schema would block the tenancy fix rather than
// document it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatewayDurableDeclarations = exports.callReactionRecorded = exports.activityRecorded = void 0;
const field_glossary_1 = require("./field-glossary");
const PRODUCER = 'websocket-gateway';
/**
 * Meanings that are sharper here than the platform-wide default. Everything
 * else (`detail`, `timestamp`, `emoji`, `at`, …) comes from COMMON_FIELDS.
 */
const FIELDS = {
    eventType: 'Activity sub-type naming what the user did (e.g. `doc.created`, `post.liked`). Doubles as the pipeline-trigger key on the consumer side.',
    userId: 'Platform user id of the acting user, resolved server-side from the connection\'s authenticated context. Explicitly `null` for an anonymous or unresolvable sender.',
    displayName: 'Human-readable sender name stamped alongside `userId`. Falls back to the user id, then to the literal `anonymous`.',
    reactionId: 'Gateway-minted id, unique per reaction. The idempotency key consumers de-duplicate re-deliveries on.',
    channel: 'Gateway reaction channel the reaction was thrown in. Always `call:`-prefixed — the durable tap fires for in-call reactions only.',
    lobbyName: 'Real lobby name the reaction belongs to. Taken from the sender\'s `metadata.lobbyName` when present, else the `call:` prefix stripped off `channel`; the former is authoritative because the frontend hashes over-long channel names.',
    effect: 'Visual effect the client plays with the reaction (confetti, burst, …), resolved server-side from the channel\'s available-reactions catalog.',
};
/**
 * `activity.recorded` — every user-initiated activity-feed entry.
 *
 * Dual transport, and both halves are load-bearing:
 *   - durable: platform-api's activity-consumer drains the queue and writes
 *     the `user-activity` DDB table idempotently (sort key
 *     `<timestamp>#<envelope id>`), then re-dispatches the event as a
 *     pipeline trigger.
 *   - signal: the live `activity:event` WS frame subscribers already see.
 *
 * The durable copy is produced by intercepting the activity library's single
 * `historyStore.append()` call, so the persisted payload is byte-identical to
 * the one broadcast — no re-enrichment, no timestamp drift.
 */
exports.activityRecorded = {
    namespace: 'activity',
    name: 'activity.recorded',
    transport: 'both',
    producer: PRODUCER,
    description: 'A user-initiated activity-feed entry. Durable for analytics, replay and pipeline triggering '
        + '(platform-api drains it into the user-activity table); signal for the live activity feed. '
        + 'Anonymous entries (userId null) are dropped by the DDB writer but still fire pipeline triggers.',
    tags: ['gateway', 'activity', 'durable', `producer:${PRODUCER}`],
    schema: {
        type: 'object',
        properties: {
            eventType: { type: 'string', minLength: 1 },
            detail: { type: 'object', additionalProperties: true },
            timestamp: { type: 'string' },
            userId: { type: ['string', 'null'] },
            displayName: { type: 'string' },
        },
        required: ['eventType', 'detail', 'timestamp', 'userId', 'displayName'],
        additionalProperties: true,
    },
};
/**
 * `call:reaction.recorded` — durable capture of one in-call emoji reaction.
 *
 * Published from the ReactionService `onReaction` tap for `call:`-prefixed
 * channels only; targeted (message) reactions go to the reactions store
 * instead and never reach here. Live fan-out stays on the signal reaction
 * frames — this event exists so playback, retros and transcript injection
 * can query the exact [startedAt, endedAt] window of a recording.
 */
exports.callReactionRecorded = {
    namespace: 'call',
    name: 'call:reaction.recorded',
    transport: 'durable',
    producer: PRODUCER,
    description: 'An in-call emoji reaction, captured durably for playback, retro and transcript injection. '
        + 'Identity is stamped server-side at send time and is never trusted from the client frame. '
        + 'Drained by platform-api into the call-reactions table, keyed `<at>#<reactionId>`.',
    tags: ['gateway', 'call', 'reaction', 'durable', `producer:${PRODUCER}`],
    queue: 'call-reaction-recorded',
    fifo: false,
    retention: 7 * 24 * 60 * 60,
    dlqAfterAttempts: 3,
    schema: {
        type: 'object',
        properties: {
            reactionId: { type: 'string', minLength: 1 },
            channel: { type: 'string', pattern: '^call:' },
            lobbyName: { type: 'string' },
            userId: { type: ['string', 'null'] },
            displayName: { type: 'string' },
            emoji: { type: 'string', minLength: 1 },
            effect: { type: 'string' },
            at: { type: 'string' },
        },
        required: ['reactionId', 'channel', 'lobbyName', 'userId', 'emoji', 'at'],
        additionalProperties: true,
    },
};
/** Every durable business event the websocket-gateway publishes. */
exports.gatewayDurableDeclarations = [
    exports.activityRecorded,
    exports.callReactionRecorded,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions and formats only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.gatewayDurableDeclarations, FIELDS);
//# sourceMappingURL=gateway-durable.js.map