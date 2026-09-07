import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// PRESENCE frames — src/realtime-fanout/presence-service.ts
// ===========================================================================

/** Sent to the client when their presence is successfully set/updated. */
export const wsPresenceSet: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.set',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to a client when their presence status is successfully set.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'set' },
        presence: { type: 'object', additionalProperties: true },
    }, ['action']),
};

/** Broadcast to channel subscribers when a client's presence changes. */
export const wsPresenceUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.update',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to presence channel subscribers when a client\'s presence status changes.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'update' },
        presence: { type: 'object', additionalProperties: true },
    }, ['action']),
};

/** Subscription confirmation + current presence snapshot for the channel. */
export const wsPresenceSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation with current presence snapshot for the channel.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
        presence: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation from a presence channel. */
export const wsPresenceUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation from a presence channel.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Presence data response to a get request (specific client or channel). */
export const wsPresenceData: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.data',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presence data returned in response to a get-presence request.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'presence' },
        data: {},
    }, ['action']),
};

/** Broadcast when a client goes offline (disconnects or times out). */
export const wsPresenceOffline: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.offline',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to presence channel subscribers when a client disconnects or times out.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'offline' },
        clientId: { type: 'string' },
    }, ['action', 'clientId']),
};
