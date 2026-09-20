"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsCrdtSeeded = exports.wsCrdtPersistenceError = exports.wsCrdtPersisted = exports.wsCrdtAwarenessBatch = exports.wsCrdtSnapshotStored = exports.wsCrdtDocReplaced = exports.wsCrdtSyncResponse = exports.wsCrdtSyncRequest = exports.wsCrdtUpdate = exports.wsCrdtSnapshot = exports.wsCrdtUnsubscribed = exports.wsCrdtSubscribed = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// CRDT frames — src/realtime-fanout/crdt-service.ts
// ===========================================================================
/** Subscription confirmation after a client subscribes to a CRDT channel. */
exports.wsCrdtSubscribed = {
    namespace: 'ws',
    name: 'ws.crdt.subscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Subscription confirmation sent when a client joins a CRDT channel.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/** Unsubscription confirmation after a client leaves a CRDT channel. */
exports.wsCrdtUnsubscribed = {
    namespace: 'ws',
    name: 'ws.crdt.unsubscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Unsubscription confirmation sent when a client leaves a CRDT channel.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/**
 * Full Y.Doc state snapshot pushed to a client on subscribe or explicit getSnapshot.
 * Note: frame type is `crdt:snapshot`.
 */
exports.wsCrdtSnapshot = {
    namespace: 'ws',
    name: 'ws.crdt.snapshot',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Full Y.Doc state (base64 encoded) pushed to a client on channel subscribe or explicit snapshot request.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:snapshot', {
        channel: { type: 'string' },
        snapshot: { type: 'string', description: 'base64-encoded Y.js state update' },
    }, ['channel', 'snapshot']),
};
/**
 * CRDT update broadcast to all channel subscribers (excluding the sender).
 * Note: frame type is `crdt:update`.
 */
exports.wsCrdtUpdate = {
    namespace: 'ws',
    name: 'ws.crdt.update',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Y.js update broadcast to all CRDT channel subscribers, excluding the sender.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:update', {
        channel: { type: 'string' },
        update: { type: 'string', description: 'base64-encoded Y.js update' },
    }, ['channel', 'update']),
};
/**
 * Client-initiated request to sync Y.js state with a peer.
 * Note: frame type is `crdt:sync-request`.
 */
exports.wsCrdtSyncRequest = {
    namespace: 'ws',
    name: 'ws.crdt.sync-request',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Client-initiated Y.js state vector sent to the gateway to request missing updates from peers. NOTE (2026-06-12 dist re-audit): not emitted/handled by the realtime-modules dist CRDTService the gateway currently runs (sync flows via crdt:subscribed + the pushed crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:sync-request', {
        channel: { type: 'string' },
        stateVector: { type: 'string', description: 'base64-encoded Y.js state vector' },
    }, ['channel', 'stateVector']),
};
/**
 * Gateway response to a sync-request, containing the missing Y.js updates.
 * Note: frame type is `crdt:sync-response`.
 */
exports.wsCrdtSyncResponse = {
    namespace: 'ws',
    name: 'ws.crdt.sync-response',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Gateway response to a sync-request containing the Y.js updates needed to bring the client up to date. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:sync-response', {
        channel: { type: 'string' },
        update: { type: 'string', description: 'base64-encoded Y.js update diff' },
    }, ['channel', 'update']),
};
/**
 * Sent to all subscribers when a snapshot restore replaces the document.
 * Note: frame type is `crdt:doc-replaced`.
 */
exports.wsCrdtDocReplaced = {
    namespace: 'ws',
    name: 'ws.crdt.doc-replaced',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all CRDT channel subscribers when a snapshot restore replaces the document state.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:doc-replaced', {
        channel: { type: 'string' },
        snapshot: { type: 'string', description: 'base64-encoded restored state' },
    }, ['channel']),
};
/**
 * Emitted when the gateway persists a Y.Doc state snapshot to durable storage.
 * Used for recovery flows — clients can request the latest stored snapshot
 * instead of replaying the full update log.
 */
exports.wsCrdtSnapshotStored = {
    namespace: 'ws',
    name: 'ws.crdt.snapshot-stored',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast when a Y.Doc state snapshot is durably stored by the gateway. Carries the snapshot ID and byte size so clients can decide whether to fetch the new baseline. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs (snapshots are persisted silently; clients re-fetch via getSnapshot → crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [..._shared_1.BASE_TAGS, 'crdt', 'snapshot'],
    schema: (0, _shared_1.wsSchema)('crdt:snapshot-stored', {
        docId: { type: 'string' },
        snapshotId: { type: 'string' },
        size: { type: 'number', description: 'Size in bytes of the stored snapshot' },
    }, ['docId', 'snapshotId', 'size']),
};
/**
 * Batched Y.js awareness updates forwarded to channel subscribers.
 * Coalescing multiple individual awareness ticks into a single frame reduces
 * WebSocket frame overhead for channels with many concurrent editors.
 */
exports.wsCrdtAwarenessBatch = {
    namespace: 'ws',
    name: 'ws.crdt.awareness-batch',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Batched Y.js awareness updates (cursor positions, user metadata) forwarded to CRDT channel subscribers in a single frame to reduce overhead. NOTE (2026-06-12 dist re-audit): the realtime-modules dist the gateway currently runs emits awareness as type:"crdt:awareness" with { channel, updates:[{ clientId, update }] } (declared as ws.crdt.awareness in client-frames.ts), NOT this "crdt:awareness-batch" / { clientId, awareness } shape — this declaration is a historical/in-tree-gateway surface, retained for back-compat.',
    tags: [..._shared_1.BASE_TAGS, 'crdt', 'awareness'],
    schema: (0, _shared_1.wsSchema)('crdt:awareness-batch', {
        docId: { type: 'string' },
        updates: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    clientId: { type: 'number' },
                    awareness: { type: 'object', additionalProperties: true },
                },
                required: ['clientId'],
                additionalProperties: true,
            },
            description: 'Array of per-client awareness state updates',
        },
    }, ['docId', 'updates']),
};
/** Correlated receipt: emitted only after SnapshotStore.putSnapshot resolves. */
exports.wsCrdtPersisted = {
    namespace: 'ws', name: 'ws.crdt.persisted', transport: 'signal', producer: _shared_1.PRODUCER,
    description: 'Durable commit receipt for one client update identifier. Initial snapshot sync is not this receipt.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:persisted', { channel: { type: 'string' }, updateId: { type: 'string', minLength: 1, maxLength: 160, description: 'Client update identifier echoed by the persistence result.' } }, ['channel', 'updateId']),
};
exports.wsCrdtPersistenceError = {
    namespace: 'ws', name: 'ws.crdt.persistence-error', transport: 'signal', producer: _shared_1.PRODUCER,
    description: 'An update failed authorization or durable persistence; the client retains its pending bytes for an explicit retry or reconnect.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:persistence-error', { channel: { type: 'string' }, updateId: { type: 'string', minLength: 1, maxLength: 160, description: 'Client update identifier echoed by the persistence result.' } }, ['channel', 'updateId']),
};
exports.wsCrdtSeeded = {
    namespace: 'ws', name: 'ws.crdt.seeded', transport: 'signal', producer: _shared_1.PRODUCER,
    description: 'Server-coordinated initial canvas seed and metadata are durably stored, or an identical source revision was already seeded.',
    tags: [..._shared_1.BASE_TAGS, 'crdt'],
    schema: (0, _shared_1.wsSchema)('crdt:seeded', { channel: { type: 'string' }, sourceRevision: { type: 'string', description: 'Authoritative source revision used for the initial import.' }, alreadySeeded: { type: 'boolean', description: 'Whether this source revision was already durably seeded.' }, requestId: { type: 'string', description: 'Caller correlation identifier echoed in the seed result.' } }, ['channel', 'sourceRevision', 'alreadySeeded']),
};
//# sourceMappingURL=crdt.js.map