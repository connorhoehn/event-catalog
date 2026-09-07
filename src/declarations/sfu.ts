// src/declarations/sfu.ts
//
// The `sfu.*` namespace — every cross-service event `live-video-streaming`
// (the SFU) emits: 12 durable webhook events, 3 control-plane signal events,
// and 5 chat-bus signal events. Twenty in total.
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

import type { EventDeclaration } from '../types/index';
import {
    annotateDeclarations,
    type FieldGlossary,
    type FormatGlossary,
} from './field-glossary';

const PRODUCER = 'sfu-cluster';
const BASE_TAGS = ['sfu', `producer:${PRODUCER}`];

const DAY = 86400;

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
const FIELDS: FieldGlossary = {
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
const FORMATS: FormatGlossary = {
    url: 'uri',
    thumbnailUrl: 'uri',
    composedUrl: 'uri',
    SendTime: 'date-time',
    DeleteTime: 'date-time',
    DisconnectTime: 'date-time',
};

// ===========================================================================
// Webhook events (durable) — webhookDispatcher.emit(channelArn, type, data),
// delivered as HTTP POST. Consumed by platform-api's lvsWebhooks route.
// ===========================================================================

/** A WebRTC transport session opened for one participant. */
export const sfuSessionCreated: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.session.created',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A WebRTC transport session has been established for a participant on a channel. '
        + 'Emitted once per participant per session join (api/channels/index.js:412).',
    tags: [...BASE_TAGS, 'webhook', 'session', 'lifecycle'],
    queue: 'sfu-session-events',
    retention: 7 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            sessionId: { type: 'string' },
            participantId: { type: 'string' },
        },
        required: ['channelArn', 'sessionId', 'participantId'],
        additionalProperties: false,
    },
};

/** A WebRTC transport session closed. */
export const sfuSessionEnded: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.session.ended',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A WebRTC transport session has closed — the transport observer fired "close". '
        + 'Carries the whole session lifetime (api/channels/index.js:434).',
    tags: [...BASE_TAGS, 'webhook', 'session', 'lifecycle'],
    queue: 'sfu-session-events',
    retention: 7 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            sessionId: { type: 'string' },
            participantId: { type: 'string' },
            durationMs: { type: 'integer', minimum: 0 },
        },
        required: ['channelArn', 'sessionId', 'participantId', 'durationMs'],
        additionalProperties: false,
    },
};

/** A producer track was added — a live stream going online. */
export const sfuStreamStarted: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.stream.started',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A producer (one audio or video track) was added on a channel — the first track of a '
        + 'live stream going online. Emitted from api/channels/transports.js:137 and '
        + 'api/channels/index.js:641.',
    tags: [...BASE_TAGS, 'webhook', 'stream', 'lifecycle'],
    queue: 'sfu-stream-events',
    retention: 30 * DAY,
    dlqRetention: 90 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            participantId: { type: 'string' },
            kind: { type: 'string', enum: ['audio', 'video'] },
            producerId: { type: 'string' },
        },
        required: ['channelArn', 'kind', 'producerId'],
        additionalProperties: false,
    },
};

/** A producer track was removed. */
export const sfuStreamEnded: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.stream.ended',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A producer track was removed — the transport observer fired "close" on the live '
        + 'transport. Emitted from api/channels/transports.js:142 and api/channels/index.js:644.',
    tags: [...BASE_TAGS, 'webhook', 'stream', 'lifecycle'],
    queue: 'sfu-stream-events',
    retention: 30 * DAY,
    dlqRetention: 90 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            participantId: { type: 'string' },
            kind: { type: 'string', enum: ['audio', 'video'] },
            producerId: { type: 'string' },
        },
        required: ['channelArn', 'kind', 'producerId'],
        additionalProperties: false,
    },
};

/** Stream health fell below thresholds. */
export const sfuStreamHealthDegraded: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.stream.health.degraded',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'Stream health metrics fell below their thresholds — bitrate drop, low fps, or an '
        + 'over-long keyframe gap. `reasons` enumerates every predicate that tripped '
        + '(services/streamHealthMonitor.js:99).',
    tags: [...BASE_TAGS, 'webhook', 'stream', 'health'],
    queue: 'sfu-stream-events',
    retention: 30 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            reasons: { type: 'array', items: { type: 'string' }, minItems: 1 },
            bitrateBps: { type: 'integer', minimum: 0 },
            fps: { type: ['number', 'null'] },
            keyframeGapSec: { type: ['number', 'null'] },
        },
        required: ['channelArn', 'reasons', 'bitrateBps', 'fps', 'keyframeGapSec'],
        additionalProperties: false,
    },
};

/** Stream health returned to nominal. */
export const sfuStreamHealthRecovered: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.stream.health.recovered',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'Stream health returned to nominal after a previous degraded state '
        + '(services/streamHealthMonitor.js:111).',
    tags: [...BASE_TAGS, 'webhook', 'stream', 'health'],
    queue: 'sfu-stream-events',
    retention: 30 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            bitrateBps: { type: 'integer', minimum: 0 },
            fps: { type: ['number', 'null'] },
        },
        required: ['channelArn', 'bitrateBps', 'fps'],
        additionalProperties: false,
    },
};

/** A new thumbnail snapshot was written. */
export const sfuStreamThumbnailUpdated: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.stream.thumbnail.updated',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A new thumbnail snapshot was written to storage for a live channel '
        + '(thumbnails/ThumbnailManager.js:266).',
    tags: [...BASE_TAGS, 'webhook', 'stream', 'thumbnail'],
    queue: 'sfu-stream-events',
    retention: 7 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            path: { type: 'string' },
            sizeBytes: { type: 'integer', minimum: 0 },
        },
        required: ['channelArn', 'path', 'sizeBytes'],
        additionalProperties: false,
    },
};

/** A recording session opened. */
export const sfuRecordingStarted: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.recording.started',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A recording session opened on a live stream. Emitted from both the single-file path '
        + '(recording/RecordingManager.js:943) and the per-peer path (:2426); only the latter '
        + 'carries `legCount`.',
    tags: [...BASE_TAGS, 'webhook', 'recording', 'lifecycle'],
    queue: 'sfu-recording-events',
    retention: 90 * DAY,
    dlqRetention: 365 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            startedAt: { type: 'string' },
            destination: { type: 'string' },
            legCount: { type: 'integer', minimum: 0 },
        },
        required: ['channelArn', 'recordingId', 'startedAt', 'destination'],
        additionalProperties: false,
    },
};

/**
 * A recording session finalized.
 *
 * The widest schema in the namespace, and the one LVS's own copy got most
 * wrong: seven producer fields were missing under `additionalProperties:
 * false`. platform-api's lvsWebhooks route is the live consumer and reads
 * every one of them.
 */
export const sfuRecordingCompleted: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.recording.completed',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A recording session finalized. Carries the segment manifest, the per-participant track '
        + 'manifest, total encoded size, duration, and the recording profile the run began under. '
        + 'Drained by platform-api\'s lvsWebhooks route into video-call-recordings '
        + '(recording/RecordingManager.js:1756).',
    tags: [...BASE_TAGS, 'webhook', 'recording', 'lifecycle'],
    queue: 'sfu-recording-events',
    retention: 90 * DAY,
    dlqRetention: 365 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            segments: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'Storage key of this segment, relative to the recording bucket.' },
                        url: { type: 'string' },
                        size: { type: 'integer', minimum: 0 },
                    },
                    required: ['key', 'url', 'size'],
                    additionalProperties: false,
                },
            },
            totalSize: { type: 'integer', minimum: 0 },
            durationMs: { type: 'integer', minimum: 0 },
            destination: { type: 'string' },
            thumbnailUrl: { type: 'string' },
            composedUrl: { type: 'string' },
            tracks: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        participantId: { type: 'string' },
                        userId: { type: 'string' },
                        key: { type: ['string', 'null'], description: 'Storage key of this participant\'s track, relative to the recording bucket. Null when the leg was never uploaded.' },
                        url: { type: ['string', 'null'], description: 'Fetchable URL of this participant\'s track. Null when the leg was neither uploaded nor written locally.' },
                        size: { type: 'integer', minimum: 0 },
                        kind: { type: 'string' },
                    },
                    required: ['participantId', 'kind'],
                    additionalProperties: true,
                },
            },
            recordingProfile: { type: 'string' },
            profileVersion: { type: 'number' },
            composePerPeer: { type: 'boolean' },
            transcribe: { type: 'boolean' },
        },
        required: [
            'channelArn', 'recordingId', 'segments', 'totalSize', 'durationMs', 'destination',
            'recordingProfile', 'profileVersion', 'composePerPeer', 'transcribe',
        ],
        additionalProperties: false,
    },
};

/** A new channel was created. */
export const sfuChannelCreated: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.channel.created',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A new IVS-style channel was created via POST /api/channels '
        + '(api/channels/index.js:1375).',
    tags: [...BASE_TAGS, 'webhook', 'channel', 'lifecycle'],
    queue: 'sfu-channel-events',
    retention: 365 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            name: { type: 'string', description: 'Human-readable channel name supplied at creation.' },
            type: {
                type: 'string',
                description: 'Channel quality tier — STANDARD, BASIC, ADVANCED_HD or ADVANCED_SD. Defaults to STANDARD when the create request omits it.',
            },
        },
        required: ['channelArn', 'name', 'type'],
        additionalProperties: false,
    },
};

/** A field on an existing channel was mutated. */
export const sfuChannelUpdated: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.channel.updated',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A configuration field on an existing channel was mutated. `field` names which one '
        + '(api/channels/index.js:1877, :1907).',
    tags: [...BASE_TAGS, 'webhook', 'channel', 'lifecycle'],
    queue: 'sfu-channel-events',
    retention: 365 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            field: { type: 'string' },
        },
        required: ['channelArn', 'field'],
        additionalProperties: false,
    },
};

/** A channel was hard-deleted. */
export const sfuChannelDeleted: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.channel.deleted',
    transport: 'durable',
    producer: PRODUCER,
    description:
        'A channel was hard-deleted via DELETE /api/channels/:arn. The wire `data` is empty; '
        + 'the envelope\'s channelArn identifies the removed channel (api/channels/index.js:2014).',
    tags: [...BASE_TAGS, 'webhook', 'channel', 'lifecycle'],
    queue: 'sfu-channel-events',
    retention: 365 * DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
        },
        required: ['channelArn'],
        additionalProperties: false,
    },
};

// ===========================================================================
// Control-plane events (signal) — streamEventsHub.emit(arn, type, data),
// fanned out cluster-wide on the Redis pub/sub topic `stream-events`.
//
// `participant.joined` / `participant.left` are deliberately NOT here: those
// are Socket.IO room-scoped frames delivered to per-client sockets, not
// service-to-service traffic.
// ===========================================================================

/** A mediasoup Producer was created on the cluster. */
export const sfuProducerAdded: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.producer.added',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A mediasoup Producer was created on the cluster. Emitted from the create-producer API '
        + 'path (api/channels/index.js:617), which stamps identity and initial state, and from '
        + 'the transport produce path (api/channels/transports.js:110), which does not.',
    tags: [...BASE_TAGS, 'control-plane', 'producer'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            producerId: { type: 'string' },
            kind: { type: 'string', enum: ['audio', 'video'] },
            participantId: { type: 'string' },
            displayName: { type: 'string' },
            userId: { type: 'string' },
            isPiped: { type: 'boolean' },
            state: {
                type: 'object',
                properties: {
                    muted: { type: 'boolean' },
                },
                required: ['muted'],
                additionalProperties: true,
            },
        },
        required: ['channelArn', 'producerId', 'kind', 'isPiped'],
        additionalProperties: false,
    },
};

/** A mediasoup Producer was closed. */
export const sfuProducerRemoved: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.producer.removed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A mediasoup Producer was closed — the underlying transport observer fired "close". '
        + 'Emitted from api/channels/index.js:624 and api/channels/transports.js:115.',
    tags: [...BASE_TAGS, 'control-plane', 'producer'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            producerId: { type: 'string' },
            kind: { type: 'string', enum: ['audio', 'video'] },
            participantId: { type: 'string' },
        },
        required: ['channelArn', 'producerId', 'kind'],
        additionalProperties: false,
    },
};

/** Recording started or stopped for a channel. */
export const sfuRecordingStateChanged: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.recording.state.changed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Recording started or stopped for a channel. Pushed onto the per-channel stream-events '
        + 'bus so stage-WS subscribers can drop their GET /:arn/recording poll. Emitted from '
        + 'recording/RecordingManager.js via _emitStateChange (:501) on start (:948), per-peer '
        + 'start (:2433), stop (:1837) and zero-track prune (:1644).',
    tags: [...BASE_TAGS, 'control-plane', 'recording'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            isRecording: { type: 'boolean' },
            recordingId: { type: 'string' },
            startedAt: { type: 'string' },
            pruned: { type: 'boolean' },
            reason: { type: 'string' },
        },
        required: ['channelArn', 'isRecording'],
        additionalProperties: false,
    },
};

// ===========================================================================
// Chat-bus events (signal) — Redis channel `chat-bus:<channelArn>`.
//
// Two wire conventions coexist here BY DESIGN, not by drift:
//
//   * chat/ChatHub.js (message / message_deleted / user_disconnected) uses
//     IVS Chat wire-protocol PascalCase — Type, Id, Sender, Content,
//     SendTime. These exact objects are ALSO broadcast to IVS-style
//     WebSocket clients on /api/channels/:arn/chat (ChatHub._broadcast is
//     handed the same object it publishes at :161), so the key casing is
//     an external protocol's, not ours to normalise. LVS is the IVS
//     replacement target; reshaping these breaks IVS parity.
//
//   * api/channels/chatBans.js (user.banned / user.unbanned) uses lowercase
//     `type` — internal cross-pod sync only, never seen by a client.
//
// The PascalCase keys are the reason `FOREIGN_WIRE_PROTOCOL_FIELDS` exists in
// tests/declaration-hygiene.test.ts. See the note there.
// ===========================================================================

/** A chat message was sent. */
export const sfuChatMessage: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.chat.message',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A chat message was sent by a participant, in IVS Chat wire-protocol shape. Persisted to '
        + 'the per-channel history list before fan-out; republished cross-pod on chat-bus so other '
        + 'pods can broadcast it to their local sockets (chat/ChatHub.js:206).',
    tags: [...BASE_TAGS, 'chat', 'ivs-parity'],
    schema: {
        type: 'object',
        properties: {
            Type: { type: 'string', enum: ['MESSAGE'], description: 'IVS Chat wire-protocol frame discriminator. Always `MESSAGE`.' },
            Id: { type: 'string' },
            RequestId: { type: 'string' },
            Sender: {
                type: 'object',
                properties: {
                    UserId: { type: 'string' },
                    Attributes: { type: 'object', additionalProperties: true },
                },
                required: ['UserId', 'Attributes'],
                additionalProperties: true,
            },
            Content: { type: 'string' },
            Attributes: { type: 'object', additionalProperties: true },
            SendTime: { type: 'string' },
        },
        required: ['Type', 'Id', 'Sender', 'Content', 'Attributes', 'SendTime'],
        additionalProperties: true,
    },
};

/** A chat message was deleted by a moderator. */
export const sfuChatMessageDeleted: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.chat.message_deleted',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A previously sent chat message was deleted by a moderator, in IVS Chat wire-protocol '
        + 'shape (chat/ChatHub.js:226).',
    tags: [...BASE_TAGS, 'chat', 'moderation', 'ivs-parity'],
    schema: {
        type: 'object',
        properties: {
            Type: { type: 'string', enum: ['MESSAGE_DELETED'], description: 'IVS Chat wire-protocol frame discriminator. Always `MESSAGE_DELETED`.' },
            Id: { type: 'string' },
            Reason: { type: 'string' },
            DeleteTime: { type: 'string' },
        },
        required: ['Type', 'Id', 'Reason', 'DeleteTime'],
        additionalProperties: true,
    },
};

/** A user was forcibly disconnected from chat. */
export const sfuChatUserDisconnected: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.chat.user_disconnected',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A user was forcibly disconnected from a chat channel by a moderator, in IVS Chat '
        + 'wire-protocol shape. Subscribing pods close any local sockets held by the named user '
        + '(producer chat/ChatHub.js:238; the cross-pod consumer is chat/ChatHub.js:137).',
    tags: [...BASE_TAGS, 'chat', 'moderation', 'ivs-parity'],
    schema: {
        type: 'object',
        properties: {
            Type: { type: 'string', enum: ['USER_DISCONNECTED'], description: 'IVS Chat wire-protocol frame discriminator. Always `USER_DISCONNECTED`.' },
            UserId: { type: 'string' },
            Reason: { type: 'string' },
            DisconnectTime: { type: 'string' },
        },
        required: ['Type', 'UserId', 'Reason', 'DisconnectTime'],
        additionalProperties: true,
    },
};

/** A user was banned from chat. */
export const sfuChatUserBanned: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.chat.user.banned',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A user was banned from chat on a channel — internal cross-pod propagation, NOT part of '
        + 'the IVS Chat wire protocol, so the keys are lowercase and no client ever sees it '
        + '(api/channels/chatBans.js:42).',
    tags: [...BASE_TAGS, 'chat', 'moderation', 'internal'],
    schema: {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['user.banned'], description: 'Chat-bus frame discriminator. Always `user.banned`.' },
            userId: { type: 'string' },
            reason: { type: 'string' },
            durationSeconds: { type: ['integer', 'null'], minimum: 0 },
        },
        required: ['type', 'userId', 'reason', 'durationSeconds'],
        additionalProperties: false,
    },
};

/** A previously banned user was unbanned. */
export const sfuChatUserUnbanned: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.chat.user.unbanned',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A previously banned user was unbanned — internal cross-pod propagation, lowercase keys, '
        + 'no client visibility (api/channels/chatBans.js:90).',
    tags: [...BASE_TAGS, 'chat', 'moderation', 'internal'],
    schema: {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['user.unbanned'], description: 'Chat-bus frame discriminator. Always `user.unbanned`.' },
            userId: { type: 'string' },
        },
        required: ['type', 'userId'],
        additionalProperties: false,
    },
};

/** Every event the SFU emits: 12 durable webhook, 3 control-plane, 5 chat-bus. */
export const sfuDeclarations: EventDeclaration[] = [
    // webhook (durable)
    sfuSessionCreated,
    sfuSessionEnded,
    sfuStreamStarted,
    sfuStreamEnded,
    sfuStreamHealthDegraded,
    sfuStreamHealthRecovered,
    sfuStreamThumbnailUpdated,
    sfuRecordingStarted,
    sfuRecordingCompleted,
    sfuChannelCreated,
    sfuChannelUpdated,
    sfuChannelDeleted,
    // control-plane (signal)
    sfuProducerAdded,
    sfuProducerRemoved,
    sfuRecordingStateChanged,
    // chat-bus (signal)
    sfuChatMessage,
    sfuChatMessageDeleted,
    sfuChatUserDisconnected,
    sfuChatUserBanned,
    sfuChatUserUnbanned,
];

// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions and formats only). See ./field-glossary.ts.
annotateDeclarations(sfuDeclarations, FIELDS, FORMATS);
