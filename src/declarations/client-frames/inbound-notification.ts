// src/declarations/client-frames/inbound-notification.ts
//
// INBOUND (gateway → client) notification push frames. User-scoped rather
// than channel-scoped, which is why they get their own module and their own
// shared payload sub-schema.
//
// Sliced verbatim out of the former single-file client-frames.ts.

import type { EventDeclaration } from '../../types/index';
import { GATEWAY_PRODUCER, GATEWAY_BASE_TAGS, inboundSchema } from './_shared';

// --- notification (user-scoped, not channel-scoped) ---------------------------

const notificationPayloadSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        type: { type: 'string', description: 'NotificationType — semantic category' },
        title: { type: 'string' },
        body: { type: 'string' },
        timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
        read: { type: 'boolean' },
        channel: { type: 'string', description: 'origin channel for click-to-navigate' },
        payload: { type: 'object', additionalProperties: true },
        action: {
            type: 'object',
            properties: {
                label: { type: 'string' },
                href: { type: 'string' },
                onClickEvent: { type: 'string' },
            },
            required: ['label'],
            additionalProperties: true,
        },
    },
    required: ['id', 'type', 'title', 'timestamp'],
    additionalProperties: true,
};

/** Consumed by useNotifications: a new user-scoped notification arrived. */
export const wsNotificationNew: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.notification.new',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'New USER-scoped notification pushed to the client inbox — delivered regardless of which channel is open (useNotifications). NOTE: gateway-side emission is deferred (M3+ per the hook header); declared now so the client contract is in the catalog.',
    tags: [...GATEWAY_BASE_TAGS, 'notification', 'client-contract'],
    schema: inboundSchema('notification:new', {
        service: { type: 'string', const: 'notification' },
        payload: notificationPayloadSchema,
    }, ['payload']),
};

/** Consumed by useNotifications: a notification was marked read (e.g. from another tab/device). */
export const wsNotificationRead: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.notification.read',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Server push that a notification was marked read, so other tabs/devices converge (useNotifications). Gateway-side emission deferred (M3+); declared as the client contract.',
    tags: [...GATEWAY_BASE_TAGS, 'notification', 'client-contract'],
    schema: inboundSchema('notification:read', {
        service: { type: 'string', const: 'notification' },
        payload: {
            type: 'object',
            properties: {
                id: { type: 'string' },
            },
            required: ['id'],
            additionalProperties: true,
        },
    }, ['payload']),
};

/** Consumed by useNotifications: bulk replace/merge of the notification list. */
export const wsNotificationBulkUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.notification.bulk-update',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Bulk notification list update (e.g. inbox sync on reconnect) carrying an array of Notification objects (useNotifications). Gateway-side emission deferred (M3+); declared as the client contract.',
    tags: [...GATEWAY_BASE_TAGS, 'notification', 'client-contract'],
    schema: inboundSchema('notification:bulk-update', {
        service: { type: 'string', const: 'notification' },
        payload: {
            type: 'object',
            properties: {
                notifications: { type: 'array', items: notificationPayloadSchema },
            },
            required: ['notifications'],
            additionalProperties: true,
        },
    }, ['payload']),
};
