// src/declarations/sfu/control-plane.ts
//
// The control-plane SIGNAL half of the `sfu.*` namespace:
// `streamEventsHub.emit(arn, type, data)`, fanned out cluster-wide on the
// Redis pub/sub topic `stream-events`.
//
// Split out of the former single-file `sfu.ts`; the three original
// declarations are unchanged. Four more were added 2026-09-07 — see the
// block comment below.
//
// The compose-job family (`recording.compose.*`) rides this same bus but
// lives in ./recording-compose.ts, because it is a self-contained job
// lifecycle rather than channel control-plane state.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS } from './_shared';

// ===========================================================================
// Control-plane events (signal) — streamEventsHub.emit(arn, type, data),
// fanned out cluster-wide on the Redis pub/sub topic `stream-events`.
//
// WHY THIS BUS COUNTS AS CROSS-SERVICE
// ------------------------------------
// `StreamEventsHub.emit` (ws/streamEvents.js:317) does two things with the
// same message, unconditionally: `_fanOutLocal` pushes it to every local
// subscriber socket — real WebSocket clients via ws/stageWsServer.js:193
// (`ws.send`) and the recordings dashboard via the SSE pseudo-socket at
// api/channels/index.js:1593 (`res.write`) — and `_publishCluster` (:333)
// republishes it to the OTHER pods on the Redis topic `stream-events`
// (and/or by PeerMessaging unicast, per STREAM_EVENTS_TRANSPORT). Every
// event in this file therefore leaves the emitting process on two separate
// paths. That is the same test the three original declarations passed.
//
// `participant.joined` is deliberately NOT here: it stays on the Socket.IO
// room-scoped path, delivered to per-client sockets only.
//
// `participant.left` USED to be in that same excluded group, and the
// original note here said so. That is no longer true: app.js:548 (added
// 2026-08-22) bridges RoomManager's `participantLeft` onto this hub after a
// 1.5s settle window. It is a real, undeclared event on this bus — recorded
// here rather than declared, because closing it was not in the scope that
// added the four below.
//
// ADDED 2026-09-07 — four events that were travelling this bus undeclared.
// Every payload below was read at its construction site, not taken from
// LVS's own `src/event-declarations.js`, which does not mention any of them.
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

/** A producer's runtime state was patched by its owner (or a moderator). */
export const sfuProducerStateChanged: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.producer.state-changed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A producer\'s runtime state was mutated through PATCH /api/channels/:arn/producers/:producerId/state '
        + '— force-mute and self-mute both land here. Emitted only when the patch actually changed a field; '
        + 'an idempotent no-op patch takes the else branch and emits nothing '
        + '(api/channels/producerState.js:214). The wire type is the short form `producer.state-changed`.',
    tags: [...BASE_TAGS, 'control-plane', 'producer'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            producerId: { type: 'string' },
            participantId: { type: 'string' },
            kind: {
                type: ['string', 'null'],
                enum: ['audio', 'video', null],
                description: 'Media kind the track carries; null when the room\'s producer index has no kind recorded for it.',
            },
            state: {
                type: 'object',
                properties: {
                    muted: { type: 'boolean' },
                },
                required: ['muted'],
                additionalProperties: true,
                description:
                    'The FULL merged runtime state after the patch, not just the changed keys — `{ ...current, ...patch }`. '
                    + 'Open on purpose: `muted` is the only mutable field today (PATCH_FIELDS, producerState.js:33) and more may be added.',
            },
        },
        required: ['channelArn', 'producerId', 'participantId', 'kind', 'state'],
        additionalProperties: false,
    },
};

/** A participant was forcibly disconnected from a channel. */
export const sfuParticipantDisconnected: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.participant.disconnected',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A participant was forcibly disconnected from a channel. Two emit sites, distinguished by `source`: '
        + 'the ops endpoint DELETE /api/admin/channels/:arn/sessions/:transportId '
        + '(api/admin/disconnect-session.js:100) and the cluster denylist watcher, which fires only once it has '
        + 'actually closed at least one local transport (workers/denyListWatcher.js:100). Clients that receive '
        + 'this event carrying their OWN participantId should treat it as terminal.',
    tags: [...BASE_TAGS, 'control-plane', 'participant', 'moderation'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            participantId: { type: 'string' },
            reason: { type: 'string' },
            source: {
                type: 'string',
                enum: ['admin-disconnect', 'denylist'],
                description: 'Which subsystem initiated the disconnect, and therefore which fields to expect.',
            },
            transportId: { type: 'string' },
        },
        // `transportId` is NOT required: only the admin-disconnect site has a
        // transport in hand (it is the route parameter). The denylist watcher
        // closes every matching transport at once and names none of them.
        required: ['channelArn', 'participantId', 'reason', 'source'],
        additionalProperties: false,
    },
};

/** Cross-tab owner arbitration resolved for one member. */
export const sfuMemberOwnerChanged: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.member.owner.changed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Server-arbitrated cross-tab ownership was assigned for a member on a channel. The first stage-WS tab to '
        + 'claim the per-member Redis lock becomes the owner; sibling tabs of the same member become silent '
        + 'observers and learn of the assignment from this frame (ws/stageWsServer.js:476). Emitted only for '
        + 'Wave-5+ tokens — a legacy JWT with no `mid` claim never triggers it, which keeps the per-channel '
        + 'eventId sequence stable for older replay-buffer consumers.',
    tags: [...BASE_TAGS, 'control-plane', 'member'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            memberId: { type: 'string' },
            userId: { type: 'string' },
            ownerClientId: { type: ['string', 'null'] },
            participantId: {
                type: ['string', 'null'],
                description:
                    'Per-tab participant id of the tab this frame is about, aliased alongside `memberId` so legacy '
                    + 'listeners can still tell which tab owns the member without speaking the `mid` vocabulary. '
                    + 'Null when the subscribe frame carried no participantId.',
            },
        },
        // `userId` is spread in conditionally — `...(userId ? { userId } : {})`
        // — so the key is absent entirely, not null, when the token has no
        // `sub` claim.
        required: ['channelArn', 'memberId', 'ownerClientId', 'participantId'],
        additionalProperties: false,
    },
};

/**
 * A custom application chat event.
 *
 * NOTE ON THE NAME: this is a `stream-events` bus event, NOT one of the five
 * `chat-bus:<arn>` frames in ./chat-bus.ts, despite sharing the `sfu.chat.`
 * prefix. The wire type is the colon form `chat:event`; the catalog name uses
 * a dot because a `:` inside an `sfu.`-prefixed name would mix separators.
 */
export const sfuChatEvent: EventDeclaration = {
    namespace: 'sfu',
    name: 'sfu.chat.event',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'A custom, application-defined chat event was published into a channel\'s live event stream via '
        + 'POST /api/channels/:arn/chat/events — the IVS Chat `SendEvent` equivalent (api/channels/chat-events.js:184). '
        + 'Rides the stream-events hub, not the chat-bus, so unlike the sfu.chat.* frames it carries channelArn '
        + 'and is fanned out to stage-WS subscribers and other pods rather than to IVS chat clients.',
    tags: [...BASE_TAGS, 'control-plane', 'chat'],
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            eventName: { type: 'string', minLength: 1, maxLength: 64 },
            attributes: {
                type: 'object',
                additionalProperties: true,
                description:
                    'Free-form attributes supplied with the event. The endpoint enforces at most 10 keys, each key '
                    + 'and each value a string of at most 256 characters, and substitutes `{}` when the caller '
                    + 'omits the field — so this is never absent and never null.',
            },
            publishedAt: { type: 'string' },
        },
        required: ['channelArn', 'eventName', 'attributes', 'publishedAt'],
        additionalProperties: false,
    },
};
