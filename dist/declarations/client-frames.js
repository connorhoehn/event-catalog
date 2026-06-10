"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientFrameDeclarations = exports.clientContractInboundDeclarations = exports.clientFrameOutboundDeclarations = exports.wsFeatureFlagUpdated = exports.wsCapabilityUpdated = exports.wsNotificationBulkUpdate = exports.wsNotificationRead = exports.wsNotificationNew = exports.wsVideohangoutMedia = exports.wsVideohangoutParticipant = exports.wsFileuploadCancelled = exports.wsFileuploadScanning = exports.wsFileuploadProgress = exports.wsPresenceLeft = exports.wsPresenceJoined = exports.clientSubscribeUnsubscribe = exports.clientSubscribeSubscribe = exports.clientVideohangoutToggleAudio = exports.clientVideohangoutToggleVideo = exports.clientVideohangoutEnd = exports.clientVideohangoutLeave = exports.clientVideohangoutJoin = exports.clientVideohangoutStart = exports.clientFileuploadCancel = exports.clientFileuploadComplete = exports.clientFileuploadRequestUpload = exports.clientCrdtAwareness = exports.clientCrdtUpdate = exports.clientCrdtUnsubscribe = exports.clientCrdtSubscribe = exports.clientActivityHistory = exports.clientActivityUnsubscribe = exports.clientActivitySubscribe = exports.clientReactionReact = exports.clientPresenceSet = exports.clientPresenceUnsubscribe = exports.clientPresenceSubscribe = exports.clientChatHistory = exports.clientChatSend = exports.clientChatSubscribe = void 0;
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
function clientFrameSchema(service, action, extra = {}, required = []) {
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
function inboundSchema(typeLiteral, extra = {}, required = []) {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', const: typeLiteral },
            timestamp: { type: 'string', description: 'ISO-8601' },
            ...extra,
        },
        required: ['type', ...required],
        additionalProperties: true,
    };
}
// ===========================================================================
// OUTBOUND — chat (useChat.ts + GatewaySocketProvider.tsx)
// ===========================================================================
/** Sent by GatewaySocketProvider when the 'chat' feature is active. */
exports.clientChatSubscribe = {
    namespace: 'client',
    name: 'client.chat.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to chat messages for a channel. Sent by GatewaySocketProvider on connect when the chat feature is declared; channel may be omitted when no channel is active.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'subscribe'),
};
/** Sent by useChat.sendMessage(). */
exports.clientChatSend = {
    namespace: 'client',
    name: 'client.chat.send',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to post a text chat message to a channel (useChat.sendMessage).',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'send', {
        message: { type: 'string' },
    }, ['channel', 'message']),
};
/** Sent by useChat.loadHistory(). */
exports.clientChatHistory = {
    namespace: 'client',
    name: 'client.chat.history',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for recent chat message history for a channel (useChat.loadHistory).',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'history', {
        limit: { type: 'number' },
    }, ['channel', 'limit']),
};
// ===========================================================================
// OUTBOUND — presence (usePresence.ts + GatewaySocketProvider.tsx)
// ===========================================================================
/** Sent by usePresence on mount and by GatewaySocketProvider on connect. */
exports.clientPresenceSubscribe = {
    namespace: 'client',
    name: 'client.presence.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to receive presence events for a channel. Sent by usePresence on mount and by GatewaySocketProvider on connect when the presence feature is declared; channel may be omitted when no channel is active.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'subscribe'),
};
/** Sent by usePresence on unmount/channel change. */
exports.clientPresenceUnsubscribe = {
    namespace: 'client',
    name: 'client.presence.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to stop receiving presence events for a channel (usePresence cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'unsubscribe', {}, ['channel']),
};
/** Sent by usePresence.setStatus() / updateMetadata(). */
exports.clientPresenceSet = {
    namespace: 'client',
    name: 'client.presence.set',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to set its presence entry. Two call sites: setStatus sends { status }, updateMetadata sends { metadata } — each field is therefore optional but at least one is present in practice.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'set', {
        status: { type: 'string', description: 'PresenceStatus, e.g. "online" | "away" | "busy"' },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel']),
};
// ===========================================================================
// OUTBOUND — reaction (useReactions.ts)
//
// NOTE: the useReactions header comment also documents an outbound
// `{ action: 'history' }` frame, but no code path in the hook sends it —
// only `react` is emitted. Declared per actual code, not the comment.
// ===========================================================================
/** Sent by useReactions.react(). */
exports.clientReactionReact = {
    namespace: 'client',
    name: 'client.reaction.react',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to send an emoji reaction to a channel (useReactions.react). targetId optionally scopes the reaction to an entity (messageId, articleId, …) and passes through the gateway opaquely.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'react', {
        emoji: { type: 'string' },
        targetId: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'emoji']),
};
// ===========================================================================
// OUTBOUND — activity (useActivity.ts)
// ===========================================================================
/** Sent by useActivity on mount. */
exports.clientActivitySubscribe = {
    namespace: 'client',
    name: 'client.activity.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to the activity feed for a channel (useActivity mount).',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'subscribe', {}, ['channel']),
};
/** Sent by useActivity on unmount/channel change. */
exports.clientActivityUnsubscribe = {
    namespace: 'client',
    name: 'client.activity.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to unsubscribe from the activity feed for a channel (useActivity cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'unsubscribe', {}, ['channel']),
};
/** Sent by useActivity.loadHistory(). */
exports.clientActivityHistory = {
    namespace: 'client',
    name: 'client.activity.history',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for prior activity events for a channel (useActivity.loadHistory).',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'history', {
        limit: { type: 'number' },
    }, ['channel', 'limit']),
};
// ===========================================================================
// OUTBOUND — crdt (useCRDT.ts, useYjsDoc.ts, GatewayProvider.ts)
// ===========================================================================
/** Sent by useCRDT/useYjsDoc when (re)connecting to a CRDT channel. */
exports.clientCrdtSubscribe = {
    namespace: 'client',
    name: 'client.crdt.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to a CRDT document channel (useCRDT/useYjsDoc). Gateway replies with crdt:subscribed and pushes the latest crdt:snapshot when one exists.',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'subscribe', {}, ['channel']),
};
/** Sent by useCRDT/useYjsDoc on unmount/channel change. */
exports.clientCrdtUnsubscribe = {
    namespace: 'client',
    name: 'client.crdt.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to unsubscribe from a CRDT document channel (useCRDT/useYjsDoc cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'unsubscribe', {}, ['channel']),
};
/** Sent by GatewayProvider doc-update handler and useCRDT.applyLocalEdit(). */
exports.clientCrdtUpdate = {
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
exports.clientCrdtAwareness = {
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
exports.clientFileuploadRequestUpload = {
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
exports.clientFileuploadComplete = {
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
exports.clientFileuploadCancel = {
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
exports.clientVideohangoutStart = {
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
exports.clientVideohangoutJoin = {
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
exports.clientVideohangoutLeave = {
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
exports.clientVideohangoutEnd = {
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
exports.clientVideohangoutToggleVideo = {
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
exports.clientVideohangoutToggleAudio = {
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
exports.clientSubscribeSubscribe = {
    namespace: 'client',
    name: 'client.subscribe.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Generic channel subscribe frame from the useWebSocket channel multiplexer (also re-sent on reconnect when autoResubscribe is enabled). Wire service is literally "subscribe".',
    tags: [...CLIENT_BASE_TAGS, 'subscribe'],
    schema: clientFrameSchema('subscribe', 'subscribe', {}, ['channel']),
};
/** Sent by useWebSocket.unsubscribe(). */
exports.clientSubscribeUnsubscribe = {
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
exports.wsPresenceJoined = {
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
exports.wsPresenceLeft = {
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
exports.wsFileuploadProgress = {
    namespace: 'ws',
    name: 'ws.fileupload.progress',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway\'s own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:progress', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        progress: { type: 'number', description: '0-100' },
    }, ['channel', 'id', 'progress']),
};
/** Consumed by useFileUpload: antivirus scan in progress. */
exports.wsFileuploadScanning = {
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
exports.wsFileuploadCancelled = {
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
exports.wsVideohangoutParticipant = {
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
exports.wsVideohangoutMedia = {
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
const notificationPayloadSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        type: { type: 'string', description: 'NotificationType — semantic category' },
        title: { type: 'string' },
        body: { type: 'string' },
        timestamp: { type: 'string', description: 'ISO-8601' },
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
exports.wsNotificationNew = {
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
exports.wsNotificationRead = {
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
exports.wsNotificationBulkUpdate = {
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
// --- capability / feature-flag (control-plane push) ----------------------------
/** Consumed by useCapability: a CRD-derived capability changed. */
exports.wsCapabilityUpdated = {
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
exports.wsFeatureFlagUpdated = {
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
exports.clientFrameOutboundDeclarations = [
    // chat
    exports.clientChatSubscribe,
    exports.clientChatSend,
    exports.clientChatHistory,
    // presence
    exports.clientPresenceSubscribe,
    exports.clientPresenceUnsubscribe,
    exports.clientPresenceSet,
    // reaction
    exports.clientReactionReact,
    // activity
    exports.clientActivitySubscribe,
    exports.clientActivityUnsubscribe,
    exports.clientActivityHistory,
    // crdt
    exports.clientCrdtSubscribe,
    exports.clientCrdtUnsubscribe,
    exports.clientCrdtUpdate,
    exports.clientCrdtAwareness,
    // fileupload
    exports.clientFileuploadRequestUpload,
    exports.clientFileuploadComplete,
    exports.clientFileuploadCancel,
    // videohangout
    exports.clientVideohangoutStart,
    exports.clientVideohangoutJoin,
    exports.clientVideohangoutLeave,
    exports.clientVideohangoutEnd,
    exports.clientVideohangoutToggleVideo,
    exports.clientVideohangoutToggleAudio,
    // generic channel multiplexer
    exports.clientSubscribeSubscribe,
    exports.clientSubscribeUnsubscribe,
];
/**
 * INBOUND gateway→client push-frame declarations added in Wave A2 (GAP 2) —
 * frames the client hooks consume that were missing from gateway-signal.ts.
 */
exports.clientContractInboundDeclarations = [
    // presence
    exports.wsPresenceJoined,
    exports.wsPresenceLeft,
    // fileupload
    exports.wsFileuploadProgress,
    exports.wsFileuploadScanning,
    exports.wsFileuploadCancelled,
    // videohangout
    exports.wsVideohangoutParticipant,
    exports.wsVideohangoutMedia,
    // notification
    exports.wsNotificationNew,
    exports.wsNotificationRead,
    exports.wsNotificationBulkUpdate,
    // capability / feature-flag
    exports.wsCapabilityUpdated,
    exports.wsFeatureFlagUpdated,
];
/** All Wave A2 client-frame contract declarations (outbound + inbound additions). */
exports.clientFrameDeclarations = [
    ...exports.clientFrameOutboundDeclarations,
    ...exports.clientContractInboundDeclarations,
];
//# sourceMappingURL=client-frames.js.map