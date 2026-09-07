"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsChatHistory = exports.wsChatSent = exports.wsChatMessage = exports.wsChatLeft = exports.wsChatJoined = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// CHAT frames — src/realtime-fanout/chat-service.ts
// ===========================================================================
/** Sent to the joining client after they successfully join a chat channel. */
exports.wsChatJoined = {
    namespace: 'ws',
    name: 'ws.chat.joined',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Confirmation sent to a client when they successfully join a chat channel.',
    tags: [..._shared_1.BASE_TAGS, 'chat'],
    schema: (0, _shared_1.wsSchema)('chat', {
        action: { type: 'string', const: 'joined' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/** Sent to the leaving client after they successfully leave a chat channel. */
exports.wsChatLeft = {
    namespace: 'ws',
    name: 'ws.chat.left',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Confirmation sent to a client when they leave a chat channel.',
    tags: [..._shared_1.BASE_TAGS, 'chat'],
    schema: (0, _shared_1.wsSchema)('chat', {
        action: { type: 'string', const: 'left' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/** Broadcast to all channel subscribers when a new chat message is posted. */
exports.wsChatMessage = {
    namespace: 'ws',
    name: 'ws.chat.message',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all channel subscribers when a new chat message is posted.',
    tags: [..._shared_1.BASE_TAGS, 'chat'],
    schema: (0, _shared_1.wsSchema)('chat', {
        action: { type: 'string', const: 'message' },
        channel: { type: 'string' },
        message: { type: 'object', additionalProperties: true },
    }, ['action', 'channel', 'message']),
};
/** Confirmation sent to the message sender after their message is stored+broadcast. */
exports.wsChatSent = {
    namespace: 'ws',
    name: 'ws.chat.sent',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Confirmation sent to the message sender after their message is stored and broadcast.',
    tags: [..._shared_1.BASE_TAGS, 'chat'],
    schema: (0, _shared_1.wsSchema)('chat', {
        action: { type: 'string', const: 'sent' },
        channel: { type: 'string' },
        messageId: { type: 'string' },
    }, ['action', 'channel', 'messageId']),
};
/** Recent message history delivered to a client on join or explicit history request. */
exports.wsChatHistory = {
    namespace: 'ws',
    name: 'ws.chat.history',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Recent message history delivered to a client on channel join or explicit history request.',
    tags: [..._shared_1.BASE_TAGS, 'chat'],
    schema: (0, _shared_1.wsSchema)('chat', {
        action: { type: 'string', const: 'history' },
        channel: { type: 'string' },
        messages: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'messages']),
};
//# sourceMappingURL=chat.js.map