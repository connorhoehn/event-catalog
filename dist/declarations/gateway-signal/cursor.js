"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsCursorModes = exports.wsCursorList = exports.wsCursorBatch = exports.wsCursorClear = exports.wsCursorRemove = exports.wsCursorUpdate = exports.wsCursorUnsubscribed = exports.wsCursorSubscribed = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// CURSOR frames — src/realtime-fanout/cursor-service.ts
// ===========================================================================
/** Subscription confirmation + current snapshot of all cursors in the channel. */
exports.wsCursorSubscribed = {
    namespace: 'ws',
    name: 'ws.cursor.subscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Subscription confirmation sent with current cursors for the channel.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};
/** Unsubscription confirmation. */
exports.wsCursorUnsubscribed = {
    namespace: 'ws',
    name: 'ws.cursor.unsubscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Unsubscription confirmation from cursor channel.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/** Broadcast when a client moves their cursor (throttled). */
exports.wsCursorUpdate = {
    namespace: 'ws',
    name: 'ws.cursor.update',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to channel subscribers when a client updates their cursor position.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'update' },
        channel: { type: 'string' },
        cursor: { type: 'object', additionalProperties: true },
    }, ['action', 'channel', 'cursor']),
};
/** Broadcast when a client disconnects and their cursor should be removed. */
exports.wsCursorRemove = {
    namespace: 'ws',
    name: 'ws.cursor.remove',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast when a client disconnects and their cursor should be removed from the canvas.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'remove' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};
/** Broadcast to all channel subscribers when a client clears their cursor. */
exports.wsCursorClear = {
    namespace: 'ws',
    name: 'ws.cursor.clear',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to channel subscribers when a client clears (removes) their cursor from the canvas. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO clear action (cursor removal flows through the remove/update verbs) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'clear' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};
/** Batched cursor position update for multiple clients, sent as a single frame. */
exports.wsCursorBatch = {
    namespace: 'ws',
    name: 'ws.cursor.batch',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Batched cursor positions for multiple clients delivered in a single frame to reduce message volume. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO batch action (it broadcasts per-client cursor:update frames and returns the full list via cursor:subscribed/cursors) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'batch' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'cursors']),
};
/** Current cursor list for a channel, sent in response to a `get` request. */
exports.wsCursorList = {
    namespace: 'ws',
    name: 'ws.cursor.cursors',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Current cursor list for a channel, sent in response to a get request.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'cursors' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};
/** Supported cursor modes (freeform, table, text, canvas). */
exports.wsCursorModes = {
    namespace: 'ws',
    name: 'ws.cursor.modes',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Supported cursor tracking modes sent to a client on request.',
    tags: [..._shared_1.BASE_TAGS, 'cursor'],
    schema: (0, _shared_1.wsSchema)('cursor', {
        action: { type: 'string', const: 'modes' },
        modes: { type: 'object', additionalProperties: true },
    }, ['action']),
};
//# sourceMappingURL=cursor.js.map