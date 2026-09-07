import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// CRDT frames — src/realtime-fanout/crdt-service.ts
// ===========================================================================

/** Subscription confirmation after a client subscribes to a CRDT channel. */
export const wsCrdtSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent when a client joins a CRDT channel.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation after a client leaves a CRDT channel. */
export const wsCrdtUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation sent when a client leaves a CRDT channel.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/**
 * Full Y.Doc state snapshot pushed to a client on subscribe or explicit getSnapshot.
 * Note: frame type is `crdt:snapshot`.
 */
export const wsCrdtSnapshot: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.snapshot',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Full Y.Doc state (base64 encoded) pushed to a client on channel subscribe or explicit snapshot request.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:snapshot', {
        channel: { type: 'string' },
        snapshot: { type: 'string', description: 'base64-encoded Y.js state update' },
    }, ['channel', 'snapshot']),
};

/**
 * CRDT update broadcast to all channel subscribers (excluding the sender).
 * Note: frame type is `crdt:update`.
 */
export const wsCrdtUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.update',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Y.js update broadcast to all CRDT channel subscribers, excluding the sender.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:update', {
        channel: { type: 'string' },
        update: { type: 'string', description: 'base64-encoded Y.js update' },
    }, ['channel', 'update']),
};

/**
 * Client-initiated request to sync Y.js state with a peer.
 * Note: frame type is `crdt:sync-request`.
 */
export const wsCrdtSyncRequest: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.sync-request',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Client-initiated Y.js state vector sent to the gateway to request missing updates from peers. NOTE (2026-06-12 dist re-audit): not emitted/handled by the realtime-modules dist CRDTService the gateway currently runs (sync flows via crdt:subscribed + the pushed crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:sync-request', {
        channel: { type: 'string' },
        stateVector: { type: 'string', description: 'base64-encoded Y.js state vector' },
    }, ['channel', 'stateVector']),
};

/**
 * Gateway response to a sync-request, containing the missing Y.js updates.
 * Note: frame type is `crdt:sync-response`.
 */
export const wsCrdtSyncResponse: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.sync-response',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Gateway response to a sync-request containing the Y.js updates needed to bring the client up to date. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:sync-response', {
        channel: { type: 'string' },
        update: { type: 'string', description: 'base64-encoded Y.js update diff' },
    }, ['channel', 'update']),
};

/**
 * Sent to all subscribers when a snapshot restore replaces the document.
 * Note: frame type is `crdt:doc-replaced`.
 */
export const wsCrdtDocReplaced: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.doc-replaced',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all CRDT channel subscribers when a snapshot restore replaces the document state.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:doc-replaced', {
        channel: { type: 'string' },
        snapshot: { type: 'string', description: 'base64-encoded restored state' },
    }, ['channel']),
};

/**
 * Emitted when the gateway persists a Y.Doc state snapshot to durable storage.
 * Used for recovery flows — clients can request the latest stored snapshot
 * instead of replaying the full update log.
 */
export const wsCrdtSnapshotStored: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.snapshot-stored',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast when a Y.Doc state snapshot is durably stored by the gateway. Carries the snapshot ID and byte size so clients can decide whether to fetch the new baseline. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs (snapshots are persisted silently; clients re-fetch via getSnapshot → crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [...BASE_TAGS, 'crdt', 'snapshot'],
    schema: wsSchema('crdt:snapshot-stored', {
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
export const wsCrdtAwarenessBatch: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.awareness-batch',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Batched Y.js awareness updates (cursor positions, user metadata) forwarded to CRDT channel subscribers in a single frame to reduce overhead. NOTE (2026-06-12 dist re-audit): the realtime-modules dist the gateway currently runs emits awareness as type:"crdt:awareness" with { channel, updates:[{ clientId, update }] } (declared as ws.crdt.awareness in client-frames.ts), NOT this "crdt:awareness-batch" / { clientId, awareness } shape — this declaration is a historical/in-tree-gateway surface, retained for back-compat.',
    tags: [...BASE_TAGS, 'crdt', 'awareness'],
    schema: wsSchema('crdt:awareness-batch', {
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
