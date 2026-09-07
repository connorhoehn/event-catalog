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

import type { EventDeclaration } from '../types/index';
import { annotateDeclarations, type FieldGlossary } from './field-glossary';

import {
    clientChatJoin,
    clientChatLeave,
    clientChatSend,
    clientChatHistory,
    clientPresenceSubscribe,
    clientPresenceUnsubscribe,
    clientPresenceGet,
    clientPresenceHeartbeat,
    clientPresenceSet,
    clientReactionSubscribe,
    clientReactionUnsubscribe,
    clientReactionSend,
    clientReactionGetAvailable,
    clientActivitySubscribe,
    clientActivityUnsubscribe,
    clientActivityGetHistory,
    clientCrdtSubscribe,
    clientCrdtUnsubscribe,
    clientCrdtUpdate,
    clientCrdtAwareness,
    clientSubscribeSubscribe,
    clientSubscribeUnsubscribe,
} from './client-frames/outbound-fanout';
import {
    clientFileuploadRequestUpload,
    clientFileuploadComplete,
    clientFileuploadCancel,
    clientVideohangoutStart,
    clientVideohangoutJoin,
    clientVideohangoutLeave,
    clientVideohangoutEnd,
    clientVideohangoutToggleVideo,
    clientVideohangoutToggleAudio,
} from './client-frames/outbound-media';
import {
    wsPresenceJoined,
    wsPresenceLeft,
    wsReactionUnsubscribed,
    wsReactionAvailable,
    wsCrdtAwareness,
} from './client-frames/inbound-fanout';
import {
    wsFileuploadProgress,
    wsFileuploadScanning,
    wsFileuploadCancelled,
    wsVideohangoutParticipant,
    wsVideohangoutMedia,
} from './client-frames/inbound-media';
import {
    wsNotificationNew,
    wsNotificationRead,
    wsNotificationBulkUpdate,
} from './client-frames/inbound-notification';
import {
    wsCapabilityUpdated,
    wsFeatureFlagUpdated,
} from './client-frames/inbound-control-plane';

// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------

export {
    clientChatJoin,
    clientChatLeave,
    clientChatSend,
    clientChatHistory,
    clientPresenceSubscribe,
    clientPresenceUnsubscribe,
    clientPresenceGet,
    clientPresenceHeartbeat,
    clientPresenceSet,
    clientReactionSubscribe,
    clientReactionUnsubscribe,
    clientReactionSend,
    clientReactionGetAvailable,
    clientActivitySubscribe,
    clientActivityUnsubscribe,
    clientActivityGetHistory,
    clientCrdtSubscribe,
    clientCrdtUnsubscribe,
    clientCrdtUpdate,
    clientCrdtAwareness,
    clientSubscribeSubscribe,
    clientSubscribeUnsubscribe,
} from './client-frames/outbound-fanout';
export {
    clientFileuploadRequestUpload,
    clientFileuploadComplete,
    clientFileuploadCancel,
    clientVideohangoutStart,
    clientVideohangoutJoin,
    clientVideohangoutLeave,
    clientVideohangoutEnd,
    clientVideohangoutToggleVideo,
    clientVideohangoutToggleAudio,
} from './client-frames/outbound-media';
export {
    wsPresenceJoined,
    wsPresenceLeft,
    wsReactionUnsubscribed,
    wsReactionAvailable,
    wsCrdtAwareness,
} from './client-frames/inbound-fanout';
export {
    wsFileuploadProgress,
    wsFileuploadScanning,
    wsFileuploadCancelled,
    wsVideohangoutParticipant,
    wsVideohangoutMedia,
} from './client-frames/inbound-media';
export {
    wsNotificationNew,
    wsNotificationRead,
    wsNotificationBulkUpdate,
} from './client-frames/inbound-notification';
export {
    wsCapabilityUpdated,
    wsFeatureFlagUpdated,
} from './client-frames/inbound-control-plane';

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
