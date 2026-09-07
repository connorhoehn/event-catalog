"use strict";
// src/declarations/sfu/webhook.ts
//
// The DURABLE half of the `sfu.*` namespace: the twelve webhook events
// `webhookDispatcher.emit(channelArn, type, data)` delivers as an HTTP POST,
// consumed by platform-api's lvsWebhooks route.
//
// Split out of the former single-file `sfu.ts`; declarations unchanged.
// See ../sfu.ts for the wire-envelope-vs-logical-payload note and for the
// record of where these schemas deliberately diverge from LVS's own copy.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sfuChannelDeleted = exports.sfuChannelUpdated = exports.sfuChannelCreated = exports.sfuRecordingCompleted = exports.sfuRecordingStarted = exports.sfuStreamThumbnailUpdated = exports.sfuStreamHealthRecovered = exports.sfuStreamHealthDegraded = exports.sfuStreamEnded = exports.sfuStreamStarted = exports.sfuSessionEnded = exports.sfuSessionCreated = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// Webhook events (durable) — webhookDispatcher.emit(channelArn, type, data),
// delivered as HTTP POST. Consumed by platform-api's lvsWebhooks route.
// ===========================================================================
/** A WebRTC transport session opened for one participant. */
exports.sfuSessionCreated = {
    namespace: 'sfu',
    name: 'sfu.session.created',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A WebRTC transport session has been established for a participant on a channel. '
        + 'Emitted once per participant per session join (api/channels/index.js:412).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'session', 'lifecycle'],
    queue: 'sfu-session-events',
    retention: 7 * _shared_1.DAY,
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
exports.sfuSessionEnded = {
    namespace: 'sfu',
    name: 'sfu.session.ended',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A WebRTC transport session has closed — the transport observer fired "close". '
        + 'Carries the whole session lifetime (api/channels/index.js:434).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'session', 'lifecycle'],
    queue: 'sfu-session-events',
    retention: 7 * _shared_1.DAY,
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
exports.sfuStreamStarted = {
    namespace: 'sfu',
    name: 'sfu.stream.started',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A producer (one audio or video track) was added on a channel — the first track of a '
        + 'live stream going online. Emitted from api/channels/transports.js:137 and '
        + 'api/channels/index.js:641.',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'stream', 'lifecycle'],
    queue: 'sfu-stream-events',
    retention: 30 * _shared_1.DAY,
    dlqRetention: 90 * _shared_1.DAY,
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
exports.sfuStreamEnded = {
    namespace: 'sfu',
    name: 'sfu.stream.ended',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A producer track was removed — the transport observer fired "close" on the live '
        + 'transport. Emitted from api/channels/transports.js:142 and api/channels/index.js:644.',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'stream', 'lifecycle'],
    queue: 'sfu-stream-events',
    retention: 30 * _shared_1.DAY,
    dlqRetention: 90 * _shared_1.DAY,
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
exports.sfuStreamHealthDegraded = {
    namespace: 'sfu',
    name: 'sfu.stream.health.degraded',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'Stream health metrics fell below their thresholds — bitrate drop, low fps, or an '
        + 'over-long keyframe gap. `reasons` enumerates every predicate that tripped '
        + '(services/streamHealthMonitor.js:99).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'stream', 'health'],
    queue: 'sfu-stream-events',
    retention: 30 * _shared_1.DAY,
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
exports.sfuStreamHealthRecovered = {
    namespace: 'sfu',
    name: 'sfu.stream.health.recovered',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'Stream health returned to nominal after a previous degraded state '
        + '(services/streamHealthMonitor.js:111).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'stream', 'health'],
    queue: 'sfu-stream-events',
    retention: 30 * _shared_1.DAY,
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
exports.sfuStreamThumbnailUpdated = {
    namespace: 'sfu',
    name: 'sfu.stream.thumbnail.updated',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A new thumbnail snapshot was written to storage for a live channel '
        + '(thumbnails/ThumbnailManager.js:266).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'stream', 'thumbnail'],
    queue: 'sfu-stream-events',
    retention: 7 * _shared_1.DAY,
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
exports.sfuRecordingStarted = {
    namespace: 'sfu',
    name: 'sfu.recording.started',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A recording session opened on a live stream. Emitted from both the single-file path '
        + '(recording/RecordingManager.js:943) and the per-peer path (:2426); only the latter '
        + 'carries `legCount`.',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'recording', 'lifecycle'],
    queue: 'sfu-recording-events',
    retention: 90 * _shared_1.DAY,
    dlqRetention: 365 * _shared_1.DAY,
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
exports.sfuRecordingCompleted = {
    namespace: 'sfu',
    name: 'sfu.recording.completed',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A recording session finalized. Carries the segment manifest, the per-participant track '
        + 'manifest, total encoded size, duration, and the recording profile the run began under. '
        + 'Drained by platform-api\'s lvsWebhooks route into video-call-recordings '
        + '(recording/RecordingManager.js:1756).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'recording', 'lifecycle'],
    queue: 'sfu-recording-events',
    retention: 90 * _shared_1.DAY,
    dlqRetention: 365 * _shared_1.DAY,
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
exports.sfuChannelCreated = {
    namespace: 'sfu',
    name: 'sfu.channel.created',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A new IVS-style channel was created via POST /api/channels '
        + '(api/channels/index.js:1375).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'channel', 'lifecycle'],
    queue: 'sfu-channel-events',
    retention: 365 * _shared_1.DAY,
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
exports.sfuChannelUpdated = {
    namespace: 'sfu',
    name: 'sfu.channel.updated',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A configuration field on an existing channel was mutated. `field` names which one '
        + '(api/channels/index.js:1877, :1907).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'channel', 'lifecycle'],
    queue: 'sfu-channel-events',
    retention: 365 * _shared_1.DAY,
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
exports.sfuChannelDeleted = {
    namespace: 'sfu',
    name: 'sfu.channel.deleted',
    transport: 'durable',
    producer: _shared_1.PRODUCER,
    description: 'A channel was hard-deleted via DELETE /api/channels/:arn. The wire `data` is empty; '
        + 'the envelope\'s channelArn identifies the removed channel (api/channels/index.js:2014).',
    tags: [..._shared_1.BASE_TAGS, 'webhook', 'channel', 'lifecycle'],
    queue: 'sfu-channel-events',
    retention: 365 * _shared_1.DAY,
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
        },
        required: ['channelArn'],
        additionalProperties: false,
    },
};
//# sourceMappingURL=webhook.js.map