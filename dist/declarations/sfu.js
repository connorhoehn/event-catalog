"use strict";
// src/declarations/sfu.ts
//
// The `sfu.*` namespace — every cross-service event `live-video-streaming`
// (the SFU) emits: 12 durable webhook events, 7 control-plane signal events,
// 5 compose-job signal events, and 5 chat-bus signal events. Twenty-nine in
// total.
//
// 2026-09-07: nine of those are new. A cross-repo audit found nine events
// riding the SAME `stream-events` hub as the three already-declared
// control-plane events, declared nowhere — not here, and not in LVS's own
// `src/event-declarations.js` either. Each was read at its construction site
// and is justified in the header of the part file that holds it.
//
// WHY THEY LIVE HERE
// ------------------
// LVS best-effort-registers its own copy at boot (`src/event-declarations.js`
// → `POST /api/events/bulk`), which means the catalog only ever knew these
// contracts when the SFU happened to be up and reachable. That is discovery,
// not ownership. The declarations below are the canonical, shipped copy: they
// are in `allDeclarations`, in the registry snapshot, and in the generated
// types whether or not the SFU ever boots.
//
// WIRE ENVELOPE vs LOGICAL PAYLOAD
// --------------------------------
// The schemas describe the LOGICAL payload — `channelArn` joined onto the
// per-event `data` fields — which is what a `catalog.publish()` caller would
// supply if the SFU ever adopts the catalog publish path. On the wire today
// `channelArn` sits in the transport envelope, not in `data`:
//
//   durable / webhook  (services/webhookDispatcher.js:210, 216-222)
//       { id, type, channelArn, occurredAt, data }
//     …unless WEBHOOK_FORMAT=eventbridge, which flattens instead into
//       { version, id, detail-type, source, account, time, region, resources,
//         detail: { event_name, stream_id, ...data } }
//     — no `data`, no `occurredAt`, and `stream_id` carries the arn.
//
//   signal / stream-events hub  (ws/streamEvents.js:317)
//       { type, channelArn, occurredAt, sourceNodeId, eventId, data }
//
//   signal / chat-bus  (chat/ChatHub.js:161, Redis `chat-bus:<arn>`)
//       the payload IS the frame — no envelope at all, and the arn is only
//       in the Redis channel name. Hence no `channelArn` on those five.
//
// Note also that the type strings on the wire are the SHORT forms
// (`recording.completed`), not `sfu.`-prefixed; the `sfu.` namespace is a
// catalog-side qualification.
//
// FIVE SCHEMAS HERE DIVERGE FROM LVS'S OWN COPY, ON PURPOSE
// ---------------------------------------------------------
// Every emit site was read rather than trusted. LVS's copy is `additional
// Properties: false` throughout, so a field the producer sends but the schema
// omits is not a documentation gap — it is a payload the contract rejects.
// Five had one:
//
//   recording.completed  — producer sends SEVEN more fields than LVS declares
//                          (RecordingManager.js:1756-1785): thumbnailUrl,
//                          composedUrl, tracks, recordingProfile,
//                          profileVersion, composePerPeer, transcribe. The
//                          last four are unconditional. platform-api's
//                          lvsWebhooks route reads all seven.
//   recording.started    — the per-peer start path (RecordingManager.js:2426)
//                          adds `legCount`.
//   recording.state.changed — the pruned/zero-track finalize path
//                          (RecordingManager.js:1644) adds `pruned` + `reason`.
//   producer.added       — LVS declares `sourceNode` + `originalProducerId`,
//                          which NO emit site sends (the piped-producer fields
//                          live on MeshPipeManager's own `producerPiped`
//                          EventEmitter signal, which never reaches the hub),
//                          and omits `displayName`, `userId` and `state`,
//                          which api/channels/index.js:617-621 does send.
//   producer.removed     — LVS declares `isPiped` + `sourceNode`; neither emit
//                          site (index.js:624, transports.js:115) sends either.
//
// Fields the producer never sends are dropped rather than kept as aspirational
// documentation; fields it does send are added.
//
// FILE LAYOUT (2026-09-07 decomposition — declarations unchanged, fingerprints
// identical): the three groups above now live one file per bus under
// `./sfu/`:
//   webhook.ts           the 12 durable webhook events (HTTP POST → platform-api)
//   control-plane.ts     the 7 channel-state signal events (`stream-events`)
//   recording-compose.ts the 5 compose-job signal events (`stream-events`)
//   chat-bus.ts          the 5 chat-bus signal events (`chat-bus:<arn>`)
// This module stays the single public entry point: it re-exports every
// declaration under its original name, owns the aggregate array in its
// original order, and — critically — owns the ONE `annotateDeclarations()`
// call together with BOTH glossaries it applies (`FIELDS` and `FORMATS`).
// Keeping all three here is what guarantees the split cannot silently change
// which description or which lexical `format` lands on which event. Never call
// `annotateDeclarations` from a part file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sfuDeclarations = exports.sfuChatUserUnbanned = exports.sfuChatUserBanned = exports.sfuChatUserDisconnected = exports.sfuChatMessageDeleted = exports.sfuChatMessage = exports.sfuRecordingComposeCompleted = exports.sfuRecordingComposeFailed = exports.sfuRecordingComposeProgress = exports.sfuRecordingComposeStarted = exports.sfuRecordingComposeQueued = exports.sfuChatEvent = exports.sfuMemberOwnerChanged = exports.sfuParticipantDisconnected = exports.sfuProducerStateChanged = exports.sfuRecordingStateChanged = exports.sfuProducerRemoved = exports.sfuProducerAdded = exports.sfuChannelDeleted = exports.sfuChannelUpdated = exports.sfuChannelCreated = exports.sfuRecordingCompleted = exports.sfuRecordingStarted = exports.sfuStreamThumbnailUpdated = exports.sfuStreamHealthRecovered = exports.sfuStreamHealthDegraded = exports.sfuStreamEnded = exports.sfuStreamStarted = exports.sfuSessionEnded = exports.sfuSessionCreated = void 0;
const field_glossary_1 = require("./field-glossary");
const webhook_1 = require("./sfu/webhook");
const control_plane_1 = require("./sfu/control-plane");
const recording_compose_1 = require("./sfu/recording-compose");
const chat_bus_1 = require("./sfu/chat-bus");
// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------
var webhook_2 = require("./sfu/webhook");
Object.defineProperty(exports, "sfuSessionCreated", { enumerable: true, get: function () { return webhook_2.sfuSessionCreated; } });
Object.defineProperty(exports, "sfuSessionEnded", { enumerable: true, get: function () { return webhook_2.sfuSessionEnded; } });
Object.defineProperty(exports, "sfuStreamStarted", { enumerable: true, get: function () { return webhook_2.sfuStreamStarted; } });
Object.defineProperty(exports, "sfuStreamEnded", { enumerable: true, get: function () { return webhook_2.sfuStreamEnded; } });
Object.defineProperty(exports, "sfuStreamHealthDegraded", { enumerable: true, get: function () { return webhook_2.sfuStreamHealthDegraded; } });
Object.defineProperty(exports, "sfuStreamHealthRecovered", { enumerable: true, get: function () { return webhook_2.sfuStreamHealthRecovered; } });
Object.defineProperty(exports, "sfuStreamThumbnailUpdated", { enumerable: true, get: function () { return webhook_2.sfuStreamThumbnailUpdated; } });
Object.defineProperty(exports, "sfuRecordingStarted", { enumerable: true, get: function () { return webhook_2.sfuRecordingStarted; } });
Object.defineProperty(exports, "sfuRecordingCompleted", { enumerable: true, get: function () { return webhook_2.sfuRecordingCompleted; } });
Object.defineProperty(exports, "sfuChannelCreated", { enumerable: true, get: function () { return webhook_2.sfuChannelCreated; } });
Object.defineProperty(exports, "sfuChannelUpdated", { enumerable: true, get: function () { return webhook_2.sfuChannelUpdated; } });
Object.defineProperty(exports, "sfuChannelDeleted", { enumerable: true, get: function () { return webhook_2.sfuChannelDeleted; } });
var control_plane_2 = require("./sfu/control-plane");
Object.defineProperty(exports, "sfuProducerAdded", { enumerable: true, get: function () { return control_plane_2.sfuProducerAdded; } });
Object.defineProperty(exports, "sfuProducerRemoved", { enumerable: true, get: function () { return control_plane_2.sfuProducerRemoved; } });
Object.defineProperty(exports, "sfuRecordingStateChanged", { enumerable: true, get: function () { return control_plane_2.sfuRecordingStateChanged; } });
Object.defineProperty(exports, "sfuProducerStateChanged", { enumerable: true, get: function () { return control_plane_2.sfuProducerStateChanged; } });
Object.defineProperty(exports, "sfuParticipantDisconnected", { enumerable: true, get: function () { return control_plane_2.sfuParticipantDisconnected; } });
Object.defineProperty(exports, "sfuMemberOwnerChanged", { enumerable: true, get: function () { return control_plane_2.sfuMemberOwnerChanged; } });
Object.defineProperty(exports, "sfuChatEvent", { enumerable: true, get: function () { return control_plane_2.sfuChatEvent; } });
var recording_compose_2 = require("./sfu/recording-compose");
Object.defineProperty(exports, "sfuRecordingComposeQueued", { enumerable: true, get: function () { return recording_compose_2.sfuRecordingComposeQueued; } });
Object.defineProperty(exports, "sfuRecordingComposeStarted", { enumerable: true, get: function () { return recording_compose_2.sfuRecordingComposeStarted; } });
Object.defineProperty(exports, "sfuRecordingComposeProgress", { enumerable: true, get: function () { return recording_compose_2.sfuRecordingComposeProgress; } });
Object.defineProperty(exports, "sfuRecordingComposeFailed", { enumerable: true, get: function () { return recording_compose_2.sfuRecordingComposeFailed; } });
Object.defineProperty(exports, "sfuRecordingComposeCompleted", { enumerable: true, get: function () { return recording_compose_2.sfuRecordingComposeCompleted; } });
var chat_bus_2 = require("./sfu/chat-bus");
Object.defineProperty(exports, "sfuChatMessage", { enumerable: true, get: function () { return chat_bus_2.sfuChatMessage; } });
Object.defineProperty(exports, "sfuChatMessageDeleted", { enumerable: true, get: function () { return chat_bus_2.sfuChatMessageDeleted; } });
Object.defineProperty(exports, "sfuChatUserDisconnected", { enumerable: true, get: function () { return chat_bus_2.sfuChatUserDisconnected; } });
Object.defineProperty(exports, "sfuChatUserBanned", { enumerable: true, get: function () { return chat_bus_2.sfuChatUserBanned; } });
Object.defineProperty(exports, "sfuChatUserUnbanned", { enumerable: true, get: function () { return chat_bus_2.sfuChatUserUnbanned; } });
/**
 * SFU field vocabulary. Names whose meaning is platform-wide (`channelArn`,
 * `participantId`, `recordingId`, `durationMs`, `userId`, `reason` …) resolve
 * from COMMON_FIELDS; only the SFU-specific ones are pinned here.
 *
 * `type` and `name` are deliberately ABSENT: both mean something different on
 * `sfu.channel.created` than on the two ban events, so each carries its own
 * inline description rather than one glossary entry that would be wrong on
 * one side.
 */
const FIELDS = {
    sessionId: 'Identifier of the WebRTC transport session — the mediasoup transport id, not the platform hangout session id.',
    kind: 'Media kind the track carries.',
    producerId: 'Identifier of the mediasoup Producer (one media track from one participant).',
    reasons: 'Which health predicates tripped, e.g. `bitrate_drop_40pct`, `low_fps_12`, `keyframe_gap_6.5s`. Never empty.',
    bitrateBps: 'Aggregate inbound bitrate across the channel\'s producers, in bits per second.',
    fps: 'Lowest frames-per-second observed across the channel\'s video producers; null when no video producer is publishing.',
    keyframeGapSec: 'Longest observed gap between keyframes, in seconds; null when no gap has been measured.',
    path: 'Storage-relative key of the written thumbnail file.',
    sizeBytes: 'Encoded size of the thumbnail image in bytes.',
    destination: 'Recording storage backend the segments were written to. `local` and `s3` are the two platform-api recognises; any other value is persisted as `local`.',
    startedAt: 'ISO-8601 timestamp at which the recording session opened.',
    segments: 'Ordered manifest of the written recording segments. Empty in multi-leg mode, where `tracks` is the real manifest and `composedUrl` is the playback target.',
    'segments.key': 'Storage key of this segment, relative to the recording bucket.',
    'segments.url': 'Fetchable URL of this segment.',
    'segments.size': 'Encoded size of this segment in bytes.',
    totalSize: 'Sum of every written segment\'s encoded size, in bytes.',
    legCount: 'Number of per-participant recording legs opened. Present only on the per-peer recording path.',
    thumbnailUrl: 'Poster-frame URL for the finished recording. Absent when no thumbnail was captured.',
    composedUrl: 'Playback URL of the composed single-file render. Absent when compose is disabled, not applicable, or failed.',
    tracks: 'Per-participant raw track manifest — the download and transcription view, as opposed to the composed playback render. Absent on the single-file path.',
    'tracks.key': 'Storage key of this participant\'s track, relative to the recording bucket.',
    'tracks.url': 'Fetchable URL of this participant\'s track.',
    'tracks.size': 'Encoded size of this track in bytes.',
    'tracks.kind': 'Media kind of this leg — `av` when the participant published both audio and video.',
    recordingProfile: 'Canonical recording-shape identifier (see recording-profiles.ts). Consumers branch on this instead of re-reading channel config.',
    profileVersion: 'Recording-profile registry version in force when the recording STARTED, so an in-flight recording finalizes under the semantics it began with.',
    composePerPeer: 'Legacy denormalization of the profile\'s compose-per-peer flag, kept for one release window while consumers migrate to `recordingProfile`.',
    transcribe: 'Legacy denormalization of the profile\'s transcribe flag, kept for one release window while consumers migrate to `recordingProfile`.',
    field: 'Which channel configuration field was mutated. `recordingConfiguration` and `webhookUrl` are the two the API mutates today.',
    isPiped: 'Whether this producer arrived by accepting a mesh pipe from another pod rather than being created locally. Always false on the stream-events bus today — cross-pod pipes are announced on MeshPipeManager\'s own `producerPiped` signal, which does not reach this bus.',
    state: 'Runtime producer state. Present only on the create-producer API path.',
    muted: 'Whether the producer is currently muted.',
    isRecording: 'Whether recording is now active on the channel — true on start, false on stop or prune.',
    pruned: 'Present and true only when the recording was discarded at finalize because it captured no tracks.',
    durationSeconds: 'How long the ban lasts, in seconds; null for a permanent ban.',
    // --- stream-events control plane (added 2026-09-07) --------------------
    transportId: 'Identifier of the mediasoup WebRTC transport the ops endpoint was asked to close.',
    source: 'Which subsystem produced this event, and therefore which optional fields to expect on it.',
    memberId: 'Deterministic member identity from the stage-WS token\'s `mid` claim. Stable across a person\'s browser tabs, unlike `participantId`, which is per-tab.',
    ownerClientId: 'Client id currently holding the per-member owner lock; null when no session store is wired to arbitrate, in which case every tab treats itself as the owner.',
    eventName: 'Caller-defined name of the custom chat event. At most 64 characters, never empty.',
    attributes: 'Free-form string attributes carried alongside the event.',
    publishedAt: 'ISO-8601 timestamp at which the SFU accepted and published the event.',
    // --- compose jobs (added 2026-09-07) -----------------------------------
    recordingStartedAt: 'ISO-8601 timestamp at which the recording being composed originally opened.',
    wallMs: 'Wall-clock milliseconds the compose job had been running when this event fired.',
    // --- IVS Chat wire-protocol frames (chat/ChatHub.js) -------------------
    // PascalCase because these payloads are ALSO broadcast verbatim to
    // IVS-style WebSocket clients. See the block comment on the chat
    // declarations below.
    Type: 'IVS Chat wire-protocol frame discriminator.',
    Id: 'IVS Chat message id. Also the cross-pod de-duplication key — a pod that published this id skips the echo.',
    RequestId: 'Client-supplied correlation id echoed back so a sender can match the broadcast to its own send. Absent when the sender supplied none.',
    Sender: 'Who sent the message, in IVS Chat wire shape.',
    'Sender.UserId': 'Platform user id of the sender, or the literal `server` for a server-originated message.',
    'Sender.Attributes': 'Free-form sender attributes forwarded verbatim from the authenticated user info.',
    Content: 'Message body text.',
    Attributes: 'Free-form per-message attributes supplied by the sender.',
    SendTime: 'ISO-8601 timestamp at which the message was accepted.',
    Reason: 'Moderator-supplied reason. Always present; empty string when none was given.',
    DeleteTime: 'ISO-8601 timestamp at which the message was deleted.',
    UserId: 'Platform user id of the affected user.',
    DisconnectTime: 'ISO-8601 timestamp at which the user was disconnected.',
};
/** Lexical formats for SFU names not in the platform-wide COMMON_FORMATS. */
const FORMATS = {
    url: 'uri',
    thumbnailUrl: 'uri',
    composedUrl: 'uri',
    publishedAt: 'date-time',
    recordingStartedAt: 'date-time',
    composedAt: 'date-time',
    SendTime: 'date-time',
    DeleteTime: 'date-time',
    DisconnectTime: 'date-time',
};
/** Every event the SFU emits: 12 durable webhook, 7 control-plane, 5 compose-job, 5 chat-bus. */
exports.sfuDeclarations = [
    // webhook (durable)
    webhook_1.sfuSessionCreated,
    webhook_1.sfuSessionEnded,
    webhook_1.sfuStreamStarted,
    webhook_1.sfuStreamEnded,
    webhook_1.sfuStreamHealthDegraded,
    webhook_1.sfuStreamHealthRecovered,
    webhook_1.sfuStreamThumbnailUpdated,
    webhook_1.sfuRecordingStarted,
    webhook_1.sfuRecordingCompleted,
    webhook_1.sfuChannelCreated,
    webhook_1.sfuChannelUpdated,
    webhook_1.sfuChannelDeleted,
    // control-plane (signal)
    control_plane_1.sfuProducerAdded,
    control_plane_1.sfuProducerRemoved,
    control_plane_1.sfuRecordingStateChanged,
    control_plane_1.sfuProducerStateChanged,
    control_plane_1.sfuParticipantDisconnected,
    control_plane_1.sfuMemberOwnerChanged,
    control_plane_1.sfuChatEvent,
    // compose jobs (signal)
    recording_compose_1.sfuRecordingComposeQueued,
    recording_compose_1.sfuRecordingComposeStarted,
    recording_compose_1.sfuRecordingComposeProgress,
    recording_compose_1.sfuRecordingComposeFailed,
    recording_compose_1.sfuRecordingComposeCompleted,
    // chat-bus (signal)
    chat_bus_1.sfuChatMessage,
    chat_bus_1.sfuChatMessageDeleted,
    chat_bus_1.sfuChatUserDisconnected,
    chat_bus_1.sfuChatUserBanned,
    chat_bus_1.sfuChatUserUnbanned,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions and formats only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.sfuDeclarations, FIELDS, FORMATS);
//# sourceMappingURL=sfu.js.map