"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsActivityEvent = exports.wsActivityHistory = exports.wsActivityPublished = exports.wsActivityUnsubscribed = exports.wsActivitySubscribed = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// ACTIVITY frames — src/realtime-fanout/activity-service.ts
// ===========================================================================
/** Subscription confirmation for an activity channel. */
exports.wsActivitySubscribed = {
    namespace: 'ws',
    name: 'ws.activity.subscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Subscription confirmation for an activity channel.',
    tags: [..._shared_1.BASE_TAGS, 'activity'],
    schema: (0, _shared_1.wsSchema)('activity', {
        action: { type: 'string', const: 'subscribed' },
        channelId: { type: 'string' },
    }, ['action', 'channelId']),
};
/** Unsubscription confirmation for an activity channel. */
exports.wsActivityUnsubscribed = {
    namespace: 'ws',
    name: 'ws.activity.unsubscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Unsubscription confirmation for an activity channel.',
    tags: [..._shared_1.BASE_TAGS, 'activity'],
    schema: (0, _shared_1.wsSchema)('activity', {
        action: { type: 'string', const: 'unsubscribed' },
        channelId: { type: 'string' },
    }, ['action', 'channelId']),
};
/** Confirmation sent to the publishing client after their activity event is broadcast. */
exports.wsActivityPublished = {
    namespace: 'ws',
    name: 'ws.activity.published',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Confirmation sent back to the client that published an activity event.',
    tags: [..._shared_1.BASE_TAGS, 'activity'],
    schema: (0, _shared_1.wsSchema)('activity', {
        action: { type: 'string', const: 'published' },
        eventType: { type: 'string' },
    }, ['action', 'eventType']),
};
/** History response for an activity channel. */
exports.wsActivityHistory = {
    namespace: 'ws',
    name: 'ws.activity.history',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Recent activity history delivered to a client on request.',
    tags: [..._shared_1.BASE_TAGS, 'activity'],
    schema: (0, _shared_1.wsSchema)('activity', {
        action: { type: 'string', const: 'history' },
        channelId: { type: 'string' },
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channelId', 'events']),
};
/**
 * Broadcast to all subscribers of `activity:broadcast` when an activity event fires.
 * Note: this frame uses type `activity:event`, not `activity`.
 */
exports.wsActivityEvent = {
    namespace: 'ws',
    name: 'ws.activity.event',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all subscribers of activity:broadcast when an activity event is published.',
    tags: [..._shared_1.BASE_TAGS, 'activity'],
    schema: (0, _shared_1.wsSchema)('activity:event', {
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
//# sourceMappingURL=activity.js.map