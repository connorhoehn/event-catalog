import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// CHAT frames — src/realtime-fanout/chat-service.ts
// ===========================================================================

/** Sent to the joining client after they successfully join a chat channel. */
export const wsChatJoined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.joined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to a client when they successfully join a chat channel.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'joined' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Sent to the leaving client after they successfully leave a chat channel. */
export const wsChatLeft: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.left',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to a client when they leave a chat channel.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'left' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Broadcast to all channel subscribers when a new chat message is posted. */
export const wsChatMessage: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.message',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all channel subscribers when a new chat message is posted.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'message' },
        channel: { type: 'string' },
        message: { type: 'object', additionalProperties: true },
    }, ['action', 'channel', 'message']),
};

/** Confirmation sent to the message sender after their message is stored+broadcast. */
export const wsChatSent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.sent',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to the message sender after their message is stored and broadcast.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'sent' },
        channel: { type: 'string' },
        messageId: { type: 'string' },
    }, ['action', 'channel', 'messageId']),
};

/** Recent message history delivered to a client on join or explicit history request. */
export const wsChatHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Recent message history delivered to a client on channel join or explicit history request.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'history' },
        channel: { type: 'string' },
        messages: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'messages']),
};
