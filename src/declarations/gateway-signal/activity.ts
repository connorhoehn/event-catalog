import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// ACTIVITY frames — src/realtime-fanout/activity-service.ts
// ===========================================================================

/** Subscription confirmation for an activity channel. */
export const wsActivitySubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation for an activity channel.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'subscribed' },
        channelId: { type: 'string' },
    }, ['action', 'channelId']),
};

/** Unsubscription confirmation for an activity channel. */
export const wsActivityUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation for an activity channel.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'unsubscribed' },
        channelId: { type: 'string' },
    }, ['action', 'channelId']),
};

/** Confirmation sent to the publishing client after their activity event is broadcast. */
export const wsActivityPublished: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.published',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent back to the client that published an activity event.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'published' },
        eventType: { type: 'string' },
    }, ['action', 'eventType']),
};

/** History response for an activity channel. */
export const wsActivityHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Recent activity history delivered to a client on request.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'history' },
        channelId: { type: 'string' },
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channelId', 'events']),
};

/**
 * Broadcast to all subscribers of `activity:broadcast` when an activity event fires.
 * Note: this frame uses type `activity:event`, not `activity`.
 */
export const wsActivityEvent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.event',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all subscribers of activity:broadcast when an activity event is published.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity:event', {
        payload: {
            type: 'object',
            properties: {
                eventType: { type: 'string' },
                detail: { type: 'object', additionalProperties: true },
                timestamp: { type: 'string' },
                userId: { type: ['string', 'null'] },
                displayName: { type: 'string' },
            },
            required: ['eventType'],
            additionalProperties: true,
        },
    }, ['payload']),
};
