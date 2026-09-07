// src/declarations/client-frames.ts
//
// Wave A2 — declare the WebSocket CLIENT-frame contract.
//
// Two halves:
//
//   1. OUTBOUND (client → gateway): every `{ service, action, channel, ... }`
//      frame the `@connorhoehn/realtime-modules/client` hooks send over the
//      gateway WebSocket. Previously entirely undeclared (Wave A1, GAP 1).
//      Naming convention: client.<service>.<action>
//        namespace: 'client'
//        producer:  'realtime-modules-client'
//        tags:      ['gateway', 'signal', 'client-frame',
//                    'producer:realtime-modules-client', <service>]
//
//   2. INBOUND (gateway → client) additions: push frames the client hooks
//      consume that were missing from gateway-signal.ts (Wave A1, GAP 2).
//      Naming convention mirrors gateway-signal.ts: ws.<service>.<variant>
//      where the wire `type` is the colon form `<service>:<variant>`.
//
// RULE (Wave A2): declare what is ACTUALLY on the wire — no renames here.
//
// AMENDMENT (hub#1497, 2026-06-10): Wave A2 generated these declarations from
// realtime-modules hook HEADER COMMENTS — and hub#1492 proved headers lie.
// The chat / presence / reaction / activity / crdt declarations were
// re-audited against the gateway-instantiated services' handleAction
// implementations (websocket-gateway src/server.ts wiring + in-tree
// src/realtime-fanout/* + node_modules/@connorhoehn/realtime-modules/dist).
// Corrections (never-correct contracts, fixed to service ground truth):
//   - client.chat.subscribe      → client.chat.join (verb is join)
//   - client.chat.history        — limit now optional
//   - client.presence.subscribe  — channel now REQUIRED
//   - client.presence.set        — status REQUIRED; channel ignored by the
//                                  service (deprecated); channels[] added
//   - client.reaction.react      → client.reaction.send (verb is send);
//                                  position added; targetId deprecated (dropped
//                                  by the service)
//   - client.activity.*          — keyed on channelId (channel deprecated);
//                                  history verb is getHistory; no
//                                  auto-history-on-subscribe
// CRDT declarations matched ground truth — unchanged. The fileupload /
// videohangout / notification / generic-subscribe declarations remain
// client-hook contracts with no gateway service counterpart (notes below).
//
// BACKFILL (v0.3.57, 2026-06-10): the realtime-modules 0.14.0 contract test
// flagged gateway-verified verbs the services accept but this file did not
// declare. Re-verified against the gateway-installed service dist
// (handleAction + handlers) and added:
//   - client.chat.leave             (sent by useChat cleanup as of 0.14.0)
//   - client.reaction.subscribe     (sent by useReactions mount as of 0.14.0)
//   - client.reaction.unsubscribe   (sent by useReactions cleanup as of 0.14.0)
//   - client.reaction.getAvailable  (no hook sender today)
//   - client.presence.get           (no hook sender today)
//   - client.presence.heartbeat     (no hook sender today)
// With these, every verb in the verified handleAction sets for chat
// (join|leave|send|history), reaction (subscribe|unsubscribe|send|
// getAvailable) and presence (set|get|subscribe|unsubscribe|heartbeat)
// is declared.
//
// Known naming tensions are documented in declaration descriptions, not fixed:
//   - useVideoHangout consumes `videohangout:*` frames while the gateway's
//     call signaling emits `type:'call'` frames (declared as ws.call.* in
//     gateway-signal.ts).
//   - useFileUpload consumes `fileupload:*` frames while the gateway's upload
//     declarations use `type:'upload'` action frames (ws.upload.*); note also
//     `fileupload:scanning` (scan in-progress) is distinct from the existing
//     ws.upload.scanned (scan outcome).
//   - usePresence consumes `presence:joined` / `presence:left` while the
//     gateway presence service emits `type:'presence'` action frames.
//
// Cross-reference: realtime-modules client hooks scanned at Wave A1/A2:
//   src/client/{useChat,usePresence,useReactions,useActivity,useCRDT,
//   useFileUpload,useVideoHangout,useNotifications,useCapability,
//   useFeatureFlag,useWebSocket,useYjsDoc}.ts + GatewayProvider.ts +
//   GatewaySocketProvider.tsx
// Gateway emissions cross-checked against
//   websocket-gateway/src/observability/gateway-event-declarations.js

import type { EventDeclaration } from '../types/index';
import { annotateDeclarations, type FieldGlossary } from './field-glossary';

const CLIENT_PRODUCER = 'realtime-modules-client';
const CLIENT_BASE_TAGS = ['gateway', 'signal', 'client-frame', `producer:${CLIENT_PRODUCER}`];

const GATEWAY_PRODUCER = 'websocket-gateway';
const GATEWAY_BASE_TAGS = ['gateway', 'signal', `producer:${GATEWAY_PRODUCER}`];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an outbound client→gateway frame schema. Every outbound frame is a
 * JSON object with `service` + `action` literals plus per-action fields.
 * additionalProperties: true — the gateway's MessageValidator only enforces
 * service/action/channel structure, so extra fields pass through.
 */
function clientFrameSchema(
    service: string,
    action: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            service: { type: 'string', const: service },
            action: { type: 'string', const: action },
            channel: { type: 'string' },
            ...extra,
        },
        required: ['service', 'action', ...required],
        additionalProperties: true,
    };
}

/** Build an inbound gateway→client frame schema keyed by a colon-form `type`. */
function inboundSchema(
    typeLiteral: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', const: typeLiteral },
            timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
            ...extra,
        },
        required: ['type', ...required],
        additionalProperties: true,
    };
}

// ===========================================================================
// OUTBOUND — chat (useChat.ts + GatewaySocketProvider.tsx)
//
// GROUND TRUTH (hub#1497 re-audit): gateway ChatService.handleAction accepts
// join | leave | send | history. The previously declared `subscribe` action
// was never accepted ("Unknown chat action: subscribe") — corrected to `join`.
// ===========================================================================

/** Sent by GatewaySocketProvider when the 'chat' feature is active. */
export const clientChatJoin: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.join',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to join a chat channel and start receiving its messages. Sent by GatewaySocketProvider on connect when the chat feature is declared. GROUND TRUTH (hub#1497): the gateway ChatService verb is "join" — the previously declared "subscribe" was never accepted. channel is required; on success the gateway replies chat/joined and auto-pushes recent channel history.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'join', {}, ['channel']),
};

/** Sent by useChat cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export const clientChatLeave: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.leave',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to leave a chat channel and stop receiving its messages. Sent by useChat cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ChatService.handleLeaveChannel requires channel ("Channel name is required") and replies with a chat/left action frame; in distributed mode it also drops the message-router channel subscription.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'leave', {}, ['channel']),
};

/** Sent by useChat.sendMessage(). */
export const clientChatSend: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.send',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to post a text chat message to a channel (useChat.sendMessage). The gateway ChatService requires a prior join on the channel ("You must join the channel before sending messages"). metadata is optional and size-validated server-side.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'send', {
        message: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'message']),
};

/** Sent by useChat.loadHistory(). */
export const clientChatHistory: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.history',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for recent chat message history for a channel (useChat.loadHistory). limit is optional — the gateway ChatService falls back to its configured default history limit when omitted (hub#1497 re-audit: limit was wrongly declared required).',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'history', {
        limit: { type: 'number' },
    }, ['channel']),
};

// ===========================================================================
// OUTBOUND — presence (usePresence.ts + GatewaySocketProvider.tsx)
// ===========================================================================

/** Sent by usePresence on mount and by GatewaySocketProvider on connect. */
export const clientPresenceSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to receive presence events for a channel. Sent by usePresence on mount and by GatewaySocketProvider on connect when the presence feature is declared. GROUND TRUTH (hub#1497): the gateway PresenceService rejects the frame without channel ("Channel is required") — channel is REQUIRED, not optional as previously declared.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'subscribe', {}, ['channel']),
};

/** Sent by usePresence on unmount/channel change. */
export const clientPresenceUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to stop receiving presence events for a channel (usePresence cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'unsubscribe', {}, ['channel']),
};

/** No hook sender today — gateway-verified verb declared for contract completeness. */
export const clientPresenceGet: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.get',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to read presence data for a single client (targetClientId) or a whole channel (channel). GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleGetPresence requires AT LEAST ONE of targetClientId or channel ("Either targetClientId or channel is required" — an either-or constraint JSON-schema-encodable only via anyOf, which the type generator does not support, so both fields are declared optional here). targetClientId wins when both are present; unknown targetClientId yields "Client not found". Replies with a presence/presence action frame carrying the data. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'get', {
        targetClientId: {
            type: 'string',
            description: 'client id to fetch a single PresenceEntry for — takes precedence over channel',
        },
        channel: {
            type: 'string',
            description: 'channel to fetch the full channel-presence list for (used when targetClientId is absent)',
        },
    }),
};

/** No hook sender today — gateway-verified verb declared for contract completeness. */
export const clientPresenceHeartbeat: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.heartbeat',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client keep-alive that refreshes lastSeen/lastHeartbeat on its existing presence entry so the stale-presence sweep does not reap it. GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleHeartbeat reads NO payload fields beyond service/action (data is ignored) and sends no reply; it is a silent no-op when the client has no presence entry (set first). PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'heartbeat'),
};

/** Sent by usePresence.setStatus() / updateMetadata(). */
export const clientPresenceSet: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.set',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to set its presence entry (usePresence setStatus / updateMetadata). GROUND TRUTH (hub#1497): the gateway PresenceService requires status ("Status is required") and reads only { status, metadata, channels } — the channel field is sent by the hook but IGNORED by the service (presence pinning uses the channels array). Previously declared with channel required + status optional; both were wrong.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'set', {
        channel: {
            type: 'string',
            description: 'DEPRECATED: sent by usePresence but ignored by the gateway PresenceService — channel pinning uses the channels array',
            deprecated: true,
        },
        status: { type: 'string', description: 'PresenceStatus, e.g. "online" | "away" | "busy"' },
        metadata: { type: 'object', additionalProperties: true },
        channels: {
            type: 'array',
            items: { type: 'string' },
            description: 'channels to pin this presence entry to (defaults to [] server-side)',
        },
    }, ['status']),
};

// ===========================================================================
// OUTBOUND — reaction (useReactions.ts)
//
// GROUND TRUTH (hub#1497 re-audit): gateway ReactionService.handleAction
// accepts subscribe | unsubscribe | send | getAvailable. The previously
// declared `react` action was never accepted ("Unknown reaction action:
// react") — corrected to `send`. The useReactions header comment's outbound
// `{ action: 'history' }` frame remains unsent by any code path.
// ===========================================================================

/** Sent by useReactions on mount (channel subscribe) as of realtime-modules 0.14.0. */
export const clientReactionSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to receive emoji reactions for a channel. Sent by useReactions on mount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleSubscribeToReactions requires channel ("Channel name is required", length-validated 1..maxChannelNameLength) and runs the consumer authz hook; on success it replies with a reaction/reaction_subscribed success frame whose data includes the availableReactions emoji list.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'subscribe', {}, ['channel']),
};

/** Sent by useReactions cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export const clientReactionUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to stop receiving emoji reactions for a channel. Sent by useReactions cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleUnsubscribeFromReactions requires channel ("Channel name is required") and replies with a reaction/reaction_unsubscribed success frame.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'unsubscribe', {}, ['channel']),
};

/** Sent by useReactions.react() — the gateway verb is `send`. */
export const clientReactionSend: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.send',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to send an emoji reaction to a channel (useReactions.react). GROUND TRUTH (hub#1497): the gateway ReactionService verb is "send" — the previously declared "react" was never accepted. emoji must be in the gateway\'s available-reactions catalog; position is optional overlay placement; metadata passes through. NOTE: targetId is sent by useReactions for entity-scoped reactions but the current gateway ReactionService does NOT forward it to subscribers.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'send', {
        emoji: { type: 'string' },
        position: {
            type: 'object',
            additionalProperties: true,
            description: 'optional overlay placement, forwarded verbatim to subscribers',
        },
        targetId: {
            type: 'string',
            description: 'DEPRECATED: sent by useReactions but dropped by the current gateway ReactionService (not forwarded to subscribers)',
            deprecated: true,
        },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'emoji']),
};

/** No hook sender today — gateway-verified verb declared for contract completeness. */
export const clientReactionGetAvailable: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.getAvailable',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for the gateway\'s available-reactions catalog (emoji → effect map). GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleGetAvailableReactions reads NO payload fields beyond service/action (channel is ignored) and replies with a reaction/available_reactions success frame carrying the full reactions catalog. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 (subscribers get the emoji list in the reaction_subscribed reply instead) — declared as the gateway-verified verb for any WS client.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'getAvailable'),
};

// ===========================================================================
// OUTBOUND — activity (useActivity.ts)
//
// GROUND TRUTH (hub#1497, verified against realtime-modules a295f13 + the
// gateway-instantiated ActivityService): subscribe / unsubscribe / getHistory
// all key on `channelId` (NOT `channel`), the history verb is `getHistory`
// (NOT `history`), and there is NO auto-history-on-subscribe. The fixed
// useActivity hook still sends a legacy `channel` field alongside channelId
// for tolerance — declared optional + deprecated below.
// ===========================================================================

/** Legacy `channel` field the fixed useActivity hook still sends for tolerance. */
const activityLegacyChannelField = {
    channel: {
        type: 'string',
        description: 'DEPRECATED: legacy alias still sent by useActivity for old-server tolerance; the gateway ActivityService reads channelId only',
        deprecated: true,
    },
    channelId: { type: 'string', description: 'activity feed channel id — the field the gateway ActivityService reads' },
} as const;

/** Sent by useActivity on mount. */
export const clientActivitySubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.activity.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to the activity feed for a channel (useActivity mount). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read. No history is auto-pushed on subscribe; clients request it explicitly via client.activity.getHistory.',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'subscribe', { ...activityLegacyChannelField }, ['channelId']),
};

/** Sent by useActivity on unmount/channel change. */
export const clientActivityUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.activity.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to unsubscribe from the activity feed for a channel (useActivity cleanup). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read.',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'unsubscribe', { ...activityLegacyChannelField }, ['channelId']),
};

/** Sent by useActivity.loadHistory() — the gateway verb is `getHistory`. */
export const clientActivityGetHistory: EventDeclaration = {
    namespace: 'client',
    name: 'client.activity.getHistory',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for prior activity events for a channel (useActivity.loadHistory). GROUND TRUTH (hub#1497): the gateway verb is "getHistory" — the previously declared "history" action was rejected ("Unknown activity action"). Keys on channelId; limit is optional (server clamps to 1..maxHistoryItems, default 50).',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'getHistory', {
        ...activityLegacyChannelField,
        limit: { type: 'number', description: 'optional — server default 50, clamped to 1..maxHistoryItems' },
    }, ['channelId']),
};

// ===========================================================================
// OUTBOUND — crdt (useCRDT.ts, useYjsDoc.ts, GatewayProvider.ts)
// ===========================================================================

/** Sent by useCRDT/useYjsDoc when (re)connecting to a CRDT channel. */
export const clientCrdtSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to a CRDT document channel (useCRDT/useYjsDoc). Gateway replies with crdt:subscribed and pushes the latest crdt:snapshot when one exists.',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'subscribe', {}, ['channel']),
};

/** Sent by useCRDT/useYjsDoc on unmount/channel change. */
export const clientCrdtUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to unsubscribe from a CRDT document channel (useCRDT/useYjsDoc cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'unsubscribe', {}, ['channel']),
};

/** Sent by GatewayProvider doc-update handler and useCRDT.applyLocalEdit(). */
export const clientCrdtUpdate: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.update',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client broadcast of a local Y.js document update, base64-encoded (GatewayProvider update handler / useCRDT.applyLocalEdit).',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'update', {
        update: { type: 'string', description: 'base64-encoded Y.js update' },
    }, ['channel', 'update']),
};

/** Sent (debounced 50ms) by GatewayProvider awareness handler. */
export const clientCrdtAwareness: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.awareness',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client broadcast of local Y.js awareness state, base64-encoded and debounced (GatewayProvider). `mode` and `idle` are lifted out of awareness local state as top-level fields so the gateway DocumentPresenceService can update without decoding the Y.js binary.',
    tags: [...CLIENT_BASE_TAGS, 'crdt', 'awareness'],
    schema: clientFrameSchema('crdt', 'awareness', {
        update: { type: 'string', description: 'base64-encoded Y.js awareness update' },
        mode: { type: 'string', enum: ['editor', 'reviewer', 'reader'] },
        idle: { type: 'boolean' },
    }, ['channel', 'update']),
};

// ===========================================================================
// OUTBOUND — fileupload (useFileUpload.ts)
//
// NOTE: the websocket-gateway MessageValidator allow-list does not currently
// include the 'fileupload' service — these frames are the client-hook
// contract; the gateway-side service is pending (the gateway's own upload
// lifecycle is declared as ws.upload.* in gateway-signal.ts).
// ===========================================================================

/** Sent by useFileUpload.upload() step 1. */
export const clientFileuploadRequestUpload: EventDeclaration = {
    namespace: 'client',
    name: 'client.fileupload.request-upload',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for a presigned upload URL (useFileUpload.upload step 1). `id` is a client-generated upload identifier echoed back on all subsequent fileupload:* frames.',
    tags: [...CLIENT_BASE_TAGS, 'fileupload'],
    schema: clientFrameSchema('fileupload', 'request-upload', {
        id: { type: 'string', description: 'client-generated upload id' },
        filename: { type: 'string' },
        size: { type: 'number', description: 'file size in bytes' },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'id', 'filename', 'size']),
};

/** Sent by useFileUpload after the XHR PUT to the presigned URL completes. */
export const clientFileuploadComplete: EventDeclaration = {
    namespace: 'client',
    name: 'client.fileupload.complete',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that the presigned-URL PUT finished (useFileUpload.upload step 4). Gateway replies with fileupload:complete / fileupload:scanning depending on scan policy.',
    tags: [...CLIENT_BASE_TAGS, 'fileupload'],
    schema: clientFrameSchema('fileupload', 'complete', {
        id: { type: 'string' },
    }, ['channel', 'id']),
};

/** Sent by useFileUpload.cancel(). */
export const clientFileuploadCancel: EventDeclaration = {
    namespace: 'client',
    name: 'client.fileupload.cancel',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to cancel an in-flight upload (useFileUpload.cancel). Gateway acknowledges with fileupload:cancelled.',
    tags: [...CLIENT_BASE_TAGS, 'fileupload'],
    schema: clientFrameSchema('fileupload', 'cancel', {
        id: { type: 'string' },
    }, ['channel', 'id']),
};

// ===========================================================================
// OUTBOUND — videohangout (useVideoHangout.ts)
//
// NOTE: the websocket-gateway routes hangout/call invite signaling through
// the 'call' service (ws.call.* frames) and has no 'videohangout' service in
// its MessageValidator allow-list. The videohangout:* service is the
// client-hook (LVS session signaling) contract — naming tension documented
// here per Wave A2; no renames in this wave.
// ===========================================================================

/** Sent by useVideoHangout.start(). */
export const clientVideohangoutStart: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.start',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to start a video hangout/call session on a channel (useVideoHangout.start). Gateway replies with videohangout:created.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'start', {
        type: { type: 'string', enum: ['hangout', 'call'] },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel']),
};

/** Sent by useVideoHangout.join(). */
export const clientVideohangoutJoin: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.join',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to join an existing hangout session (useVideoHangout.join). Gateway replies with videohangout:joined.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'join', {
        sessionId: { type: 'string' },
    }, ['channel', 'sessionId']),
};

/** Sent by useVideoHangout.leave(). */
export const clientVideohangoutLeave: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.leave',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that it is leaving the hangout session (useVideoHangout.leave).',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'leave', {
        sessionId: { type: 'string' },
    }, ['channel', 'sessionId']),
};

/** Sent by useVideoHangout.end(). */
export const clientVideohangoutEnd: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.end',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client (host) request to end the hangout session for all participants (useVideoHangout.end).',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'end', {
        sessionId: { type: 'string' },
    }, ['channel', 'sessionId']),
};

/** Sent by useVideoHangout.toggleVideo(). */
export const clientVideohangoutToggleVideo: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.toggle-video',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that it toggled its video feed on/off (useVideoHangout.toggleVideo). Gateway fans out videohangout:media.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'toggle-video', {
        sessionId: { type: 'string' },
        videoOn: { type: 'boolean' },
    }, ['channel', 'sessionId', 'videoOn']),
};

/** Sent by useVideoHangout.toggleAudio(). */
export const clientVideohangoutToggleAudio: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.toggle-audio',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that it toggled its audio feed on/off (useVideoHangout.toggleAudio). Gateway fans out videohangout:media.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'toggle-audio', {
        sessionId: { type: 'string' },
        audioOn: { type: 'boolean' },
    }, ['channel', 'sessionId', 'audioOn']),
};

// ===========================================================================
// OUTBOUND — generic channel subscribe multiplexer (useWebSocket.ts)
//
// NOTE: service is literally 'subscribe' on the wire. Not in the gateway
// MessageValidator allow-list today — declared as the client-hook contract.
// ===========================================================================

/** Sent by useWebSocket.subscribe() and the auto-resubscribe-on-reconnect path. */
export const clientSubscribeSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.subscribe.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Generic channel subscribe frame from the useWebSocket channel multiplexer (also re-sent on reconnect when autoResubscribe is enabled). Wire service is literally "subscribe".',
    tags: [...CLIENT_BASE_TAGS, 'subscribe'],
    schema: clientFrameSchema('subscribe', 'subscribe', {}, ['channel']),
};

/** Sent by useWebSocket.unsubscribe(). */
export const clientSubscribeUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.subscribe.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Generic channel unsubscribe frame from the useWebSocket channel multiplexer. Wire service is literally "subscribe".',
    tags: [...CLIENT_BASE_TAGS, 'subscribe'],
    schema: clientFrameSchema('subscribe', 'unsubscribe', {}, ['channel']),
};

// ===========================================================================
// INBOUND additions (Wave A1, GAP 2) — gateway → client push frames the
// client hooks consume that were missing from gateway-signal.ts.
// ===========================================================================

// --- presence ---------------------------------------------------------------

/** Consumed by usePresence: a client joined the presence channel. */
export const wsPresenceJoined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.joined',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Broadcast when a client joins a presence channel, carrying the joining client\'s PresenceEntry. NOTE: the gateway presence service currently emits type:"presence" action frames (ws.presence.update / ws.presence.offline); presence:joined is the usePresence hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'presence', 'client-contract'],
    schema: inboundSchema('presence:joined', {
        channel: { type: 'string' },
        client: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                status: { type: 'string' },
                metadata: { type: 'object', additionalProperties: true },
                channels: { type: 'array', items: { type: 'string' } },
                nodeId: { type: 'string' },
                timestamp: { type: 'string' },
                lastSeen: { type: 'string' },
                lastHeartbeat: { type: 'number' },
            },
            required: ['clientId', 'status'],
            additionalProperties: true,
        },
    }, ['channel', 'client']),
};

/** Consumed by usePresence: a client left the presence channel. */
export const wsPresenceLeft: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.left',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Broadcast when a client leaves a presence channel. NOTE: the gateway presence service currently emits type:"presence" action frames; presence:left is the usePresence hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'presence', 'client-contract'],
    schema: inboundSchema('presence:left', {
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['channel', 'clientId']),
};

// --- fileupload --------------------------------------------------------------

/** Consumed by useFileUpload: optional server-side upload progress. */
export const wsFileuploadProgress: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.progress',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway\'s own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:progress', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        progress: { type: 'number', description: 'Upload progress as a percentage, 0-100.' },
    }, ['channel', 'id', 'progress']),
};

/** Consumed by useFileUpload: antivirus scan in progress. */
export const wsFileuploadScanning: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.scanning',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Antivirus scan is IN PROGRESS for an uploaded file — distinct from the existing ws.upload.scanned declaration, which reports the scan OUTCOME (clean/infected). The scanning-vs-scanned naming tension is documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:scanning', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
    }, ['channel', 'id']),
};

/** Consumed by useFileUpload: cancel acknowledged. */
export const wsFileuploadCancelled: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.cancelled',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Acknowledgement that a client-requested upload cancellation completed (useFileUpload.cancel round-trip). Part of the fileupload:* hook contract — see ws.fileupload.progress for the upload-vs-fileupload naming note.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:cancelled', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
    }, ['channel', 'id']),
};

// --- videohangout ------------------------------------------------------------

/** Consumed by useVideoHangout: a participant joined or updated. */
export const wsVideohangoutParticipant: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.videohangout.participant',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Participant joined or updated in a hangout session, carrying the full HangoutParticipant. NOTE: the gateway currently signals hangout/call invites via type:"call" frames (ws.call.*); videohangout:* is the useVideoHangout hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'videohangout', 'client-contract'],
    schema: inboundSchema('videohangout:participant', {
        channel: { type: 'string' },
        participant: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                displayName: { type: 'string' },
                role: { type: 'string', enum: ['host', 'participant', 'viewer'] },
                videoOn: { type: 'boolean' },
                audioOn: { type: 'boolean' },
                joinedAt: { type: 'string' },
            },
            required: ['clientId', 'role'],
            additionalProperties: true,
        },
    }, ['channel', 'participant']),
};

/** Consumed by useVideoHangout: a participant toggled video/audio. */
export const wsVideohangoutMedia: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.videohangout.media',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Media-state change for a hangout participant (video/audio toggled). Part of the videohangout:* hook contract — see ws.videohangout.participant for the videohangout-vs-ws.call.* naming note.',
    tags: [...GATEWAY_BASE_TAGS, 'videohangout', 'client-contract'],
    schema: inboundSchema('videohangout:media', {
        channel: { type: 'string' },
        clientId: { type: 'string' },
        videoOn: { type: 'boolean' },
        audioOn: { type: 'boolean' },
    }, ['channel', 'clientId', 'videoOn', 'audioOn']),
};

// --- notification (user-scoped, not channel-scoped) ---------------------------

const notificationPayloadSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        type: { type: 'string', description: 'NotificationType — semantic category' },
        title: { type: 'string' },
        body: { type: 'string' },
        timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
        read: { type: 'boolean' },
        channel: { type: 'string', description: 'origin channel for click-to-navigate' },
        payload: { type: 'object', additionalProperties: true },
        action: {
            type: 'object',
            properties: {
                label: { type: 'string' },
                href: { type: 'string' },
                onClickEvent: { type: 'string' },
            },
            required: ['label'],
            additionalProperties: true,
        },
    },
    required: ['id', 'type', 'title', 'timestamp'],
    additionalProperties: true,
};

/** Consumed by useNotifications: a new user-scoped notification arrived. */
export const wsNotificationNew: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.notification.new',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'New USER-scoped notification pushed to the client inbox — delivered regardless of which channel is open (useNotifications). NOTE: gateway-side emission is deferred (M3+ per the hook header); declared now so the client contract is in the catalog.',
    tags: [...GATEWAY_BASE_TAGS, 'notification', 'client-contract'],
    schema: inboundSchema('notification:new', {
        service: { type: 'string', const: 'notification' },
        payload: notificationPayloadSchema,
    }, ['payload']),
};

/** Consumed by useNotifications: a notification was marked read (e.g. from another tab/device). */
export const wsNotificationRead: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.notification.read',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Server push that a notification was marked read, so other tabs/devices converge (useNotifications). Gateway-side emission deferred (M3+); declared as the client contract.',
    tags: [...GATEWAY_BASE_TAGS, 'notification', 'client-contract'],
    schema: inboundSchema('notification:read', {
        service: { type: 'string', const: 'notification' },
        payload: {
            type: 'object',
            properties: {
                id: { type: 'string' },
            },
            required: ['id'],
            additionalProperties: true,
        },
    }, ['payload']),
};

/** Consumed by useNotifications: bulk replace/merge of the notification list. */
export const wsNotificationBulkUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.notification.bulk-update',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Bulk notification list update (e.g. inbox sync on reconnect) carrying an array of Notification objects (useNotifications). Gateway-side emission deferred (M3+); declared as the client contract.',
    tags: [...GATEWAY_BASE_TAGS, 'notification', 'client-contract'],
    schema: inboundSchema('notification:bulk-update', {
        service: { type: 'string', const: 'notification' },
        payload: {
            type: 'object',
            properties: {
                notifications: { type: 'array', items: notificationPayloadSchema },
            },
            required: ['notifications'],
            additionalProperties: true,
        },
    }, ['payload']),
};

// --- gateway send-back envelopes (divergence note b) -------------------------
//
// GROUND TRUTH (2026-06-12): re-audited against the gateway-instantiated
// service dist the gateway actually runs — websocket-gateway/node_modules/
// @connorhoehn/realtime-modules/dist/{chat,presence,reactions,cursor,activity,
// crdt}/. These are the type:'<service>' / type:'<service>:<variant>' action-
// frame envelopes the gateway services emit to the client, which the 0.15.x
// realtime-modules hooks parse payload-first (useChat/usePresence/useReactions
// per divergence note b in the contract test). Most send-backs were ALREADY
// declared in gateway-signal.ts (ws.chat.*, ws.presence.*, ws.reaction.*,
// ws.cursor.*, ws.activity.*, ws.crdt.*) and those declarations were verified
// against the dist and RECONCILED there (see the correction notes in
// gateway-signal.ts). The three declarations below are the send-back frames
// the dist emits that had NO ws.* declaration anywhere — added here so the
// inbound unions + EventPayloadMap are complete and the contract test can
// assert the hooks' parsers against the full send-back set.

/**
 * Consumed by useReactions: confirmation that an unsubscribe was accepted.
 * GROUND TRUTH: ReactionService.handleUnsubscribeFromReactions →
 * sendSuccess('reaction_unsubscribed', { channel, message }) which wraps as
 * { type:'reaction', action:'reaction_unsubscribed', success:true, data }.
 * The sibling reaction_subscribed frame is declared as ws.reaction.subscribed
 * in gateway-signal.ts (reconciled there to add success + data.message).
 */
export const wsReactionUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.unsubscribed',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Confirmation sent to a client when their reaction unsubscribe is accepted. GROUND TRUTH (gateway dist ReactionService.handleUnsubscribeFromReactions → sendSuccess): wire frame is { type:"reaction", action:"reaction_unsubscribed", success:true, data:{ channel, message } }. No ws.* declaration existed for this verified send-back before — added per divergence note (b).',
    tags: [...GATEWAY_BASE_TAGS, 'reaction', 'send-back', 'client-contract'],
    schema: inboundSchema('reaction', {
        action: { type: 'string', const: 'reaction_unsubscribed' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                channel: { type: 'string' },
                message: { type: 'string' },
            },
            required: ['channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/**
 * Consumed by clients that send client.reaction.getAvailable: the emoji →
 * effect catalog. GROUND TRUTH: ReactionService.handleGetAvailableReactions →
 * sendSuccess('available_reactions', { reactions }) wrapping as
 * { type:'reaction', action:'available_reactions', success:true, data }.
 */
export const wsReactionAvailable: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.available',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'The gateway\'s available-reactions catalog (emoji → effect map), sent in reply to a getAvailable request. GROUND TRUTH (gateway dist ReactionService.handleGetAvailableReactions → sendSuccess): wire frame is { type:"reaction", action:"available_reactions", success:true, data:{ reactions } } where reactions maps each emoji to its { effect } config. No ws.* declaration existed before — added per divergence note (b).',
    tags: [...GATEWAY_BASE_TAGS, 'reaction', 'send-back', 'client-contract'],
    schema: inboundSchema('reaction', {
        action: { type: 'string', const: 'available_reactions' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                reactions: { type: 'object', additionalProperties: true, description: 'emoji → { effect } map' },
            },
            required: ['reactions'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/**
 * Broadcast to CRDT channel subscribers: coalesced Y.js awareness updates.
 * GROUND TRUTH: server/AwarenessCoalescer._broadcast → sendToChannel(channel,
 * { type:'crdt:awareness', channel, updates:[{ clientId, update }] }). This is
 * the frame the dist actually emits — distinct from the historical
 * ws.crdt.awareness-batch declaration in gateway-signal.ts (different type
 * literal `crdt:awareness-batch` and different per-entry shape
 * { clientId, awareness }), which the current dist does NOT emit (noted there).
 */
export const wsCrdtAwareness: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.awareness',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Coalesced Y.js awareness updates broadcast to all CRDT channel subscribers. GROUND TRUTH (gateway dist server/AwarenessCoalescer._broadcast): wire frame is { type:"crdt:awareness", channel, updates:[{ clientId, update }] } where each update is a base64-encoded Y.js awareness delta. This is the frame the running dist emits — distinct from the historical ws.crdt.awareness-batch (type "crdt:awareness-batch", per-entry { clientId, awareness }) which the current dist does NOT emit. Added per divergence note (b).',
    tags: [...GATEWAY_BASE_TAGS, 'crdt', 'awareness', 'send-back', 'client-contract'],
    schema: inboundSchema('crdt:awareness', {
        channel: { type: 'string' },
        updates: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    clientId: { type: 'string' },
                    update: { type: 'string', description: 'base64-encoded Y.js awareness delta' },
                },
                required: ['clientId', 'update'],
                additionalProperties: true,
            },
        },
    }, ['channel', 'updates']),
};

// --- capability / feature-flag (control-plane push) ----------------------------

/** Consumed by useCapability: a CRD-derived capability changed. */
export const wsCapabilityUpdated: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.capability.updated',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Control-plane push that a CRD-derived capability changed state, so useCapability consumers update without a remount. Payload mirrors CapabilityUpdatedPayload in useCapability.ts.',
    tags: [...GATEWAY_BASE_TAGS, 'capability', 'control-plane', 'client-contract'],
    schema: inboundSchema('capability:updated', {
        payload: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                channel: { type: 'string', description: 'optional channel scope' },
                version: { type: 'string', description: 'bundle version from the CRD' },
                metadata: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'enabled'],
            additionalProperties: true,
        },
    }, ['payload']),
};

/** Consumed by useFeatureFlag: an app-level feature flag changed. */
export const wsFeatureFlagUpdated: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.feature-flag.updated',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Gateway push that an app-level feature flag changed (kill-switch / A-B variant), so useFeatureFlag consumers update reactively. Payload mirrors FeatureFlagUpdatedPayload in useFeatureFlag.ts.',
    tags: [...GATEWAY_BASE_TAGS, 'feature-flag', 'control-plane', 'client-contract'],
    schema: inboundSchema('feature-flag:updated', {
        payload: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                variant: { type: 'string', description: 'variant id for multi-variant flags' },
                metadata: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'enabled'],
            additionalProperties: true,
        },
    }, ['payload']),
};

// ===========================================================================
// Aggregate exports
// ===========================================================================

/**
 * All OUTBOUND client→gateway frame declarations (namespace `client`).
 * Producer is the realtime-modules client hook layer; the gateway consumes.
 */
export const clientFrameOutboundDeclarations: EventDeclaration[] = [
    // chat
    clientChatJoin,
    clientChatLeave,
    clientChatSend,
    clientChatHistory,
    // presence
    clientPresenceSubscribe,
    clientPresenceUnsubscribe,
    clientPresenceSet,
    clientPresenceGet,
    clientPresenceHeartbeat,
    // reaction
    clientReactionSubscribe,
    clientReactionUnsubscribe,
    clientReactionSend,
    clientReactionGetAvailable,
    // activity
    clientActivitySubscribe,
    clientActivityUnsubscribe,
    clientActivityGetHistory,
    // crdt
    clientCrdtSubscribe,
    clientCrdtUnsubscribe,
    clientCrdtUpdate,
    clientCrdtAwareness,
    // fileupload
    clientFileuploadRequestUpload,
    clientFileuploadComplete,
    clientFileuploadCancel,
    // videohangout
    clientVideohangoutStart,
    clientVideohangoutJoin,
    clientVideohangoutLeave,
    clientVideohangoutEnd,
    clientVideohangoutToggleVideo,
    clientVideohangoutToggleAudio,
    // generic channel multiplexer
    clientSubscribeSubscribe,
    clientSubscribeUnsubscribe,
];

/**
 * INBOUND gateway→client push-frame declarations added in Wave A2 (GAP 2) —
 * frames the client hooks consume that were missing from gateway-signal.ts.
 */
export const clientContractInboundDeclarations: EventDeclaration[] = [
    // presence
    wsPresenceJoined,
    wsPresenceLeft,
    // fileupload
    wsFileuploadProgress,
    wsFileuploadScanning,
    wsFileuploadCancelled,
    // videohangout
    wsVideohangoutParticipant,
    wsVideohangoutMedia,
    // notification
    wsNotificationNew,
    wsNotificationRead,
    wsNotificationBulkUpdate,
    // capability / feature-flag
    wsCapabilityUpdated,
    wsFeatureFlagUpdated,
    // gateway send-back envelopes (divergence note b)
    wsReactionUnsubscribed,
    wsReactionAvailable,
    wsCrdtAwareness,
];

/** All Wave A2 client-frame contract declarations (outbound + inbound additions). */
export const clientFrameDeclarations: EventDeclaration[] = [
    ...clientFrameOutboundDeclarations,
    ...clientContractInboundDeclarations,
];

/**
 * Field meanings for both halves of this module: the outbound
 * `{ service, action, channel }` request envelope and the inbound
 * colon-form `type` push envelope.
 */
const FIELDS: FieldGlossary = {
    // Neutral wording on purpose: this module declares both directions, so
    // `service` is a routing key on the way out and an origin label on the
    // way back in.
    service: 'Gateway fan-out service this frame belongs to. Paired with `action` it is the gateway\'s routing key.',
    action: 'Verb the addressed service should perform.',
    type: 'WebSocket frame type — names the gateway fan-out service that produced this frame.',
    // Root-level `id` on this module's frames is always an upload id; the
    // notification ids are reached by path and described separately.
    id: 'Client-generated upload id, echoed on every frame for that upload.',
    'payload.id': 'Identifier of the notification.',
    'payload.notifications.id': 'Identifier of the notification.',
    limit: 'Maximum number of history entries to return.',
    mode: 'Editing role the client is announcing for the collaborative document.',
    update: 'Base64-encoded Yjs update payload.',
    awareness: 'Yjs awareness state for one client (selection, cursor, user colour).',
    'updates.awareness': 'Yjs awareness state for the client named by this entry.',
    'updates.update': 'Base64-encoded Yjs update payload for the client named by this entry.',
    position: 'Anchor coordinates for the reaction within the target surface.',
    presence: 'Presence record(s) for the channel — who is here and what state they are in.',
    client: 'Presence record of the client that triggered this frame.',
    participant: 'Participant record describing one member of the hangout.',
    'payload.action': 'Optional call-to-action rendered with the notification.',
    'payload.action.onClickEvent': 'Event name the frontend dispatches when the action is clicked.',
    'payload.notifications.action': 'Optional call-to-action rendered with the notification.',
    'payload.notifications.action.onClickEvent': 'Event name the frontend dispatches when the action is clicked.',
    'payload.payload': 'Application-defined body of the notification.',
    'payload.notifications.payload': 'Application-defined body of the notification.',
    'payload.name': 'Identifier of the capability or feature flag whose state changed.',
};

// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
annotateDeclarations(clientFrameDeclarations, FIELDS);
