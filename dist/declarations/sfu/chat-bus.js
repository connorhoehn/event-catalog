"use strict";
// src/declarations/sfu/chat-bus.ts
//
// The chat-bus SIGNAL half of the `sfu.*` namespace: the Redis channel
// `chat-bus:<channelArn>`.
//
// Split out of the former single-file `sfu.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sfuChatUserUnbanned = exports.sfuChatUserBanned = exports.sfuChatUserDisconnected = exports.sfuChatMessageDeleted = exports.sfuChatMessage = void 0;
const _shared_1 = require("./_shared");
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
exports.sfuChatMessage = {
    namespace: 'sfu',
    name: 'sfu.chat.message',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A chat message was sent by a participant, in IVS Chat wire-protocol shape. Persisted to '
        + 'the per-channel history list before fan-out; republished cross-pod on chat-bus so other '
        + 'pods can broadcast it to their local sockets (chat/ChatHub.js:206).',
    tags: [..._shared_1.BASE_TAGS, 'chat', 'ivs-parity'],
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
exports.sfuChatMessageDeleted = {
    namespace: 'sfu',
    name: 'sfu.chat.message_deleted',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A previously sent chat message was deleted by a moderator, in IVS Chat wire-protocol '
        + 'shape (chat/ChatHub.js:226).',
    tags: [..._shared_1.BASE_TAGS, 'chat', 'moderation', 'ivs-parity'],
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
exports.sfuChatUserDisconnected = {
    namespace: 'sfu',
    name: 'sfu.chat.user_disconnected',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A user was forcibly disconnected from a chat channel by a moderator, in IVS Chat '
        + 'wire-protocol shape. Subscribing pods close any local sockets held by the named user '
        + '(producer chat/ChatHub.js:238; the cross-pod consumer is chat/ChatHub.js:137).',
    tags: [..._shared_1.BASE_TAGS, 'chat', 'moderation', 'ivs-parity'],
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
exports.sfuChatUserBanned = {
    namespace: 'sfu',
    name: 'sfu.chat.user.banned',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A user was banned from chat on a channel — internal cross-pod propagation, NOT part of '
        + 'the IVS Chat wire protocol, so the keys are lowercase and no client ever sees it '
        + '(api/channels/chatBans.js:42).',
    tags: [..._shared_1.BASE_TAGS, 'chat', 'moderation', 'internal'],
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
exports.sfuChatUserUnbanned = {
    namespace: 'sfu',
    name: 'sfu.chat.user.unbanned',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A previously banned user was unbanned — internal cross-pod propagation, lowercase keys, '
        + 'no client visibility (api/channels/chatBans.js:90).',
    tags: [..._shared_1.BASE_TAGS, 'chat', 'moderation', 'internal'],
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
//# sourceMappingURL=chat-bus.js.map