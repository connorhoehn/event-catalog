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
//
// FILE LAYOUT (2026-09-07 decomposition — declarations unchanged, fingerprints
// identical): the frames now live under `./client-frames/`, split first by
// direction and then by whether the addressed service is a verified gateway
// fan-out service or a client-hook-only contract:
//   outbound-fanout.ts        chat / presence / reaction / activity / crdt
//                             + the generic `subscribe` multiplexer
//   outbound-media.ts         fileupload / videohangout (no gateway service)
//   inbound-fanout.ts         presence joined-left + the divergence-note-b
//                             reaction / crdt send-back envelopes
//   inbound-media.ts          fileupload / videohangout push frames
//   inbound-notification.ts   user-scoped notification push frames
//   inbound-control-plane.ts  capability / feature-flag push frames
// This module stays the single public entry point: it re-exports every
// declaration under its original name, owns the three aggregate arrays in
// their original order, and — critically — owns the ONE
// `annotateDeclarations()` call and the local field glossary it applies.
// Keeping both here is what guarantees the split cannot silently change which
// description lands on which property. Never call `annotateDeclarations` from
// a part file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsCapabilityUpdated = exports.wsNotificationBulkUpdate = exports.wsNotificationRead = exports.wsNotificationNew = exports.wsVideohangoutMedia = exports.wsVideohangoutParticipant = exports.wsFileuploadCancelled = exports.wsFileuploadScanning = exports.wsFileuploadProgress = exports.wsFileuploadStarted = exports.wsFileuploadFailed = exports.wsFileuploadComplete = exports.wsFileuploadUrl = exports.wsCrdtAwareness = exports.wsReactionAvailable = exports.wsReactionUnsubscribed = exports.wsPresenceLeft = exports.wsPresenceJoined = exports.clientVideohangoutToggleAudio = exports.clientVideohangoutToggleVideo = exports.clientVideohangoutEnd = exports.clientVideohangoutLeave = exports.clientVideohangoutJoin = exports.clientVideohangoutStart = exports.clientFileuploadCancel = exports.clientFileuploadComplete = exports.clientFileuploadRequestUpload = exports.clientSubscribeUnsubscribe = exports.clientSubscribeSubscribe = exports.clientCrdtAwareness = exports.clientCrdtUpdate = exports.clientCrdtUnsubscribe = exports.clientCrdtSubscribe = exports.clientActivityGetHistory = exports.clientActivityUnsubscribe = exports.clientActivitySubscribe = exports.clientReactionGetAvailable = exports.clientReactionSend = exports.clientReactionUnsubscribe = exports.clientReactionSubscribe = exports.clientPresenceSet = exports.clientPresenceHeartbeat = exports.clientPresenceGet = exports.clientPresenceUnsubscribe = exports.clientPresenceSubscribe = exports.clientChatHistory = exports.clientChatTyping = exports.clientChatSend = exports.clientChatLeave = exports.clientChatJoin = void 0;
exports.clientFrameDeclarations = exports.clientContractInboundDeclarations = exports.clientFrameOutboundDeclarations = exports.wsFeatureFlagUpdated = void 0;
const field_glossary_1 = require("./field-glossary");
const outbound_fanout_1 = require("./client-frames/outbound-fanout");
const outbound_media_1 = require("./client-frames/outbound-media");
const inbound_fanout_1 = require("./client-frames/inbound-fanout");
const inbound_media_1 = require("./client-frames/inbound-media");
const inbound_notification_1 = require("./client-frames/inbound-notification");
const inbound_control_plane_1 = require("./client-frames/inbound-control-plane");
// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------
var outbound_fanout_2 = require("./client-frames/outbound-fanout");
Object.defineProperty(exports, "clientChatJoin", { enumerable: true, get: function () { return outbound_fanout_2.clientChatJoin; } });
Object.defineProperty(exports, "clientChatLeave", { enumerable: true, get: function () { return outbound_fanout_2.clientChatLeave; } });
Object.defineProperty(exports, "clientChatSend", { enumerable: true, get: function () { return outbound_fanout_2.clientChatSend; } });
Object.defineProperty(exports, "clientChatTyping", { enumerable: true, get: function () { return outbound_fanout_2.clientChatTyping; } });
Object.defineProperty(exports, "clientChatHistory", { enumerable: true, get: function () { return outbound_fanout_2.clientChatHistory; } });
Object.defineProperty(exports, "clientPresenceSubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientPresenceSubscribe; } });
Object.defineProperty(exports, "clientPresenceUnsubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientPresenceUnsubscribe; } });
Object.defineProperty(exports, "clientPresenceGet", { enumerable: true, get: function () { return outbound_fanout_2.clientPresenceGet; } });
Object.defineProperty(exports, "clientPresenceHeartbeat", { enumerable: true, get: function () { return outbound_fanout_2.clientPresenceHeartbeat; } });
Object.defineProperty(exports, "clientPresenceSet", { enumerable: true, get: function () { return outbound_fanout_2.clientPresenceSet; } });
Object.defineProperty(exports, "clientReactionSubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientReactionSubscribe; } });
Object.defineProperty(exports, "clientReactionUnsubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientReactionUnsubscribe; } });
Object.defineProperty(exports, "clientReactionSend", { enumerable: true, get: function () { return outbound_fanout_2.clientReactionSend; } });
Object.defineProperty(exports, "clientReactionGetAvailable", { enumerable: true, get: function () { return outbound_fanout_2.clientReactionGetAvailable; } });
Object.defineProperty(exports, "clientActivitySubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientActivitySubscribe; } });
Object.defineProperty(exports, "clientActivityUnsubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientActivityUnsubscribe; } });
Object.defineProperty(exports, "clientActivityGetHistory", { enumerable: true, get: function () { return outbound_fanout_2.clientActivityGetHistory; } });
Object.defineProperty(exports, "clientCrdtSubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientCrdtSubscribe; } });
Object.defineProperty(exports, "clientCrdtUnsubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientCrdtUnsubscribe; } });
Object.defineProperty(exports, "clientCrdtUpdate", { enumerable: true, get: function () { return outbound_fanout_2.clientCrdtUpdate; } });
Object.defineProperty(exports, "clientCrdtAwareness", { enumerable: true, get: function () { return outbound_fanout_2.clientCrdtAwareness; } });
Object.defineProperty(exports, "clientSubscribeSubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientSubscribeSubscribe; } });
Object.defineProperty(exports, "clientSubscribeUnsubscribe", { enumerable: true, get: function () { return outbound_fanout_2.clientSubscribeUnsubscribe; } });
var outbound_media_2 = require("./client-frames/outbound-media");
Object.defineProperty(exports, "clientFileuploadRequestUpload", { enumerable: true, get: function () { return outbound_media_2.clientFileuploadRequestUpload; } });
Object.defineProperty(exports, "clientFileuploadComplete", { enumerable: true, get: function () { return outbound_media_2.clientFileuploadComplete; } });
Object.defineProperty(exports, "clientFileuploadCancel", { enumerable: true, get: function () { return outbound_media_2.clientFileuploadCancel; } });
Object.defineProperty(exports, "clientVideohangoutStart", { enumerable: true, get: function () { return outbound_media_2.clientVideohangoutStart; } });
Object.defineProperty(exports, "clientVideohangoutJoin", { enumerable: true, get: function () { return outbound_media_2.clientVideohangoutJoin; } });
Object.defineProperty(exports, "clientVideohangoutLeave", { enumerable: true, get: function () { return outbound_media_2.clientVideohangoutLeave; } });
Object.defineProperty(exports, "clientVideohangoutEnd", { enumerable: true, get: function () { return outbound_media_2.clientVideohangoutEnd; } });
Object.defineProperty(exports, "clientVideohangoutToggleVideo", { enumerable: true, get: function () { return outbound_media_2.clientVideohangoutToggleVideo; } });
Object.defineProperty(exports, "clientVideohangoutToggleAudio", { enumerable: true, get: function () { return outbound_media_2.clientVideohangoutToggleAudio; } });
var inbound_fanout_2 = require("./client-frames/inbound-fanout");
Object.defineProperty(exports, "wsPresenceJoined", { enumerable: true, get: function () { return inbound_fanout_2.wsPresenceJoined; } });
Object.defineProperty(exports, "wsPresenceLeft", { enumerable: true, get: function () { return inbound_fanout_2.wsPresenceLeft; } });
Object.defineProperty(exports, "wsReactionUnsubscribed", { enumerable: true, get: function () { return inbound_fanout_2.wsReactionUnsubscribed; } });
Object.defineProperty(exports, "wsReactionAvailable", { enumerable: true, get: function () { return inbound_fanout_2.wsReactionAvailable; } });
Object.defineProperty(exports, "wsCrdtAwareness", { enumerable: true, get: function () { return inbound_fanout_2.wsCrdtAwareness; } });
var inbound_media_2 = require("./client-frames/inbound-media");
Object.defineProperty(exports, "wsFileuploadUrl", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadUrl; } });
Object.defineProperty(exports, "wsFileuploadComplete", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadComplete; } });
Object.defineProperty(exports, "wsFileuploadFailed", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadFailed; } });
Object.defineProperty(exports, "wsFileuploadStarted", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadStarted; } });
Object.defineProperty(exports, "wsFileuploadProgress", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadProgress; } });
Object.defineProperty(exports, "wsFileuploadScanning", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadScanning; } });
Object.defineProperty(exports, "wsFileuploadCancelled", { enumerable: true, get: function () { return inbound_media_2.wsFileuploadCancelled; } });
Object.defineProperty(exports, "wsVideohangoutParticipant", { enumerable: true, get: function () { return inbound_media_2.wsVideohangoutParticipant; } });
Object.defineProperty(exports, "wsVideohangoutMedia", { enumerable: true, get: function () { return inbound_media_2.wsVideohangoutMedia; } });
var inbound_notification_2 = require("./client-frames/inbound-notification");
Object.defineProperty(exports, "wsNotificationNew", { enumerable: true, get: function () { return inbound_notification_2.wsNotificationNew; } });
Object.defineProperty(exports, "wsNotificationRead", { enumerable: true, get: function () { return inbound_notification_2.wsNotificationRead; } });
Object.defineProperty(exports, "wsNotificationBulkUpdate", { enumerable: true, get: function () { return inbound_notification_2.wsNotificationBulkUpdate; } });
var inbound_control_plane_2 = require("./client-frames/inbound-control-plane");
Object.defineProperty(exports, "wsCapabilityUpdated", { enumerable: true, get: function () { return inbound_control_plane_2.wsCapabilityUpdated; } });
Object.defineProperty(exports, "wsFeatureFlagUpdated", { enumerable: true, get: function () { return inbound_control_plane_2.wsFeatureFlagUpdated; } });
// ===========================================================================
// Aggregate exports
// ===========================================================================
/**
 * All OUTBOUND client→gateway frame declarations (namespace `client`).
 * Producer is the realtime-modules client hook layer; the gateway consumes.
 */
exports.clientFrameOutboundDeclarations = [
    // chat
    outbound_fanout_1.clientChatJoin,
    outbound_fanout_1.clientChatLeave,
    outbound_fanout_1.clientChatSend,
    outbound_fanout_1.clientChatTyping,
    outbound_fanout_1.clientChatHistory,
    // presence
    outbound_fanout_1.clientPresenceSubscribe,
    outbound_fanout_1.clientPresenceUnsubscribe,
    outbound_fanout_1.clientPresenceSet,
    outbound_fanout_1.clientPresenceGet,
    outbound_fanout_1.clientPresenceHeartbeat,
    // reaction
    outbound_fanout_1.clientReactionSubscribe,
    outbound_fanout_1.clientReactionUnsubscribe,
    outbound_fanout_1.clientReactionSend,
    outbound_fanout_1.clientReactionGetAvailable,
    // activity
    outbound_fanout_1.clientActivitySubscribe,
    outbound_fanout_1.clientActivityUnsubscribe,
    outbound_fanout_1.clientActivityGetHistory,
    // crdt
    outbound_fanout_1.clientCrdtSubscribe,
    outbound_fanout_1.clientCrdtUnsubscribe,
    outbound_fanout_1.clientCrdtUpdate,
    outbound_fanout_1.clientCrdtAwareness,
    // fileupload
    outbound_media_1.clientFileuploadRequestUpload,
    outbound_media_1.clientFileuploadComplete,
    outbound_media_1.clientFileuploadCancel,
    // videohangout
    outbound_media_1.clientVideohangoutStart,
    outbound_media_1.clientVideohangoutJoin,
    outbound_media_1.clientVideohangoutLeave,
    outbound_media_1.clientVideohangoutEnd,
    outbound_media_1.clientVideohangoutToggleVideo,
    outbound_media_1.clientVideohangoutToggleAudio,
    // generic channel multiplexer
    outbound_fanout_1.clientSubscribeSubscribe,
    outbound_fanout_1.clientSubscribeUnsubscribe,
];
/**
 * INBOUND gateway→client push-frame declarations added in Wave A2 (GAP 2) —
 * frames the client hooks consume that were missing from gateway-signal.ts.
 */
exports.clientContractInboundDeclarations = [
    // presence
    inbound_fanout_1.wsPresenceJoined,
    inbound_fanout_1.wsPresenceLeft,
    // fileupload
    inbound_media_1.wsFileuploadUrl,
    inbound_media_1.wsFileuploadComplete,
    inbound_media_1.wsFileuploadFailed,
    inbound_media_1.wsFileuploadStarted,
    inbound_media_1.wsFileuploadProgress,
    inbound_media_1.wsFileuploadScanning,
    inbound_media_1.wsFileuploadCancelled,
    // videohangout
    inbound_media_1.wsVideohangoutParticipant,
    inbound_media_1.wsVideohangoutMedia,
    // notification
    inbound_notification_1.wsNotificationNew,
    inbound_notification_1.wsNotificationRead,
    inbound_notification_1.wsNotificationBulkUpdate,
    // capability / feature-flag
    inbound_control_plane_1.wsCapabilityUpdated,
    inbound_control_plane_1.wsFeatureFlagUpdated,
    // gateway send-back envelopes (divergence note b)
    inbound_fanout_1.wsReactionUnsubscribed,
    inbound_fanout_1.wsReactionAvailable,
    inbound_fanout_1.wsCrdtAwareness,
];
/** All Wave A2 client-frame contract declarations (outbound + inbound additions). */
exports.clientFrameDeclarations = [
    ...exports.clientFrameOutboundDeclarations,
    ...exports.clientContractInboundDeclarations,
];
/**
 * Field meanings for both halves of this module: the outbound
 * `{ service, action, channel }` request envelope and the inbound
 * colon-form `type` push envelope.
 */
const FIELDS = {
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
(0, field_glossary_1.annotateDeclarations)(exports.clientFrameDeclarations, FIELDS);
//# sourceMappingURL=client-frames.js.map