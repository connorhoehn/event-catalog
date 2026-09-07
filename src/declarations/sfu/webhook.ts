// src/declarations/sfu/webhook.ts
//
// The DURABLE half of the `sfu.*` namespace: the twelve webhook events
// `webhookDispatcher.emit(channelArn, type, data)` delivers as an HTTP POST,
// consumed by platform-api's lvsWebhooks route.
//
// Split out of the former single-file `sfu.ts`; declarations unchanged.
// See ../sfu.ts for the wire-envelope-vs-logical-payload note and for the
// record of where these schemas deliberately diverge from LVS's own copy.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, DAY } from './_shared';

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
        + '(recording/RecordingManager.js:1756). TWO declared properties are never actually emitted — '
        + '`composedUrl` and `tracks[].userId`; both are read by platform-api and both come back undefined. '
        + 'See their entries in the field glossary in ../sfu.ts. The mirror defect also exists and is NOT '
        + 'fixable from here: routes/lvsWebhooks.ts reads `startedAt`, `endedAt` and `totalBytes` off this '
        + 'payload, none of which is declared or sent — and since this schema is additionalProperties:false, '
        + 'they could not arrive even if LVS started sending them.',
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
