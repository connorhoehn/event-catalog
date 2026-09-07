import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// CURSOR frames — src/realtime-fanout/cursor-service.ts
// ===========================================================================

/** Subscription confirmation + current snapshot of all cursors in the channel. */
export const wsCursorSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent with current cursors for the channel.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation. */
export const wsCursorUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation from cursor channel.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Broadcast when a client moves their cursor (throttled). */
export const wsCursorUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.update',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to channel subscribers when a client updates their cursor position.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'update' },
        channel: { type: 'string' },
        cursor: { type: 'object', additionalProperties: true },
    }, ['action', 'channel', 'cursor']),
};

/** Broadcast when a client disconnects and their cursor should be removed. */
export const wsCursorRemove: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.remove',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast when a client disconnects and their cursor should be removed from the canvas.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'remove' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};

/** Broadcast to all channel subscribers when a client clears their cursor. */
export const wsCursorClear: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.clear',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to channel subscribers when a client clears (removes) their cursor from the canvas. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO clear action (cursor removal flows through the remove/update verbs) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'clear' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};

/** Batched cursor position update for multiple clients, sent as a single frame. */
export const wsCursorBatch: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.batch',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Batched cursor positions for multiple clients delivered in a single frame to reduce message volume. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO batch action (it broadcasts per-client cursor:update frames and returns the full list via cursor:subscribed/cursors) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'batch' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'cursors']),
};

/** Current cursor list for a channel, sent in response to a `get` request. */
export const wsCursorList: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.cursors',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Current cursor list for a channel, sent in response to a get request.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'cursors' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};

/** Supported cursor modes (freeform, table, text, canvas). */
export const wsCursorModes: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.modes',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Supported cursor tracking modes sent to a client on request.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'modes' },
        modes: { type: 'object', additionalProperties: true },
    }, ['action']),
};
