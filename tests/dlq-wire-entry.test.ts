// tests/dlq-wire-entry.test.ts
//
// Unit tests for `toDlqWireEntry` — the normalizer that gives
// GET /api/transports/durable/dlq a single response shape.
//
// Before it existed, the route returned DynamoDB rows normally and raw
// `DeadLetteredMessage` objects (`messageId`/`envelope`) from the
// in-process mirror when DynamoDB was down: two shapes under one 200,
// switching during an outage. These tests pin the mapping from both
// sources; tests/dlq-routes.test.ts pins it end-to-end over HTTP.

import { describe, it, expect } from 'vitest';
import { toDlqWireEntry, type DLQEntry } from '../src/server/dlq-store.js';
import type { DeadLetteredMessage } from '../src/client/durable.js';

function makeRow(overrides: Partial<DLQEntry> = {}): DLQEntry {
    return {
        id: 'id-1',
        pk: 'DLQ#orders.failed',
        sk: '2026-05-15T00:00:00.000Z#id-1',
        eventName: 'orders.failed',
        payload: { orderId: 'o1' },
        error: 'timeout',
        attempts: 3,
        deadAt: '2026-05-15T00:00:00.000Z',
        ttl: 1_700_000_000,
        ...overrides,
    };
}

function makeMessage(overrides: Partial<DeadLetteredMessage> = {}): DeadLetteredMessage {
    return {
        messageId: 'm-1',
        queueName: 'orders-failed',
        envelope: {
            eventName: 'orders.failed',
            payload: { orderId: 'o1' },
            metadata: { id: 'm-1', producer: 'worker', timestamp: 0 },
        },
        error: 'handler threw',
        attempts: 3,
        deadLetteredAt: '2026-05-15T00:00:00.000Z',
        ...overrides,
    } as DeadLetteredMessage;
}

describe('toDlqWireEntry — DynamoDB rows', () => {
    it('drops pk/sk and converts ttl to an ISO expiresAt', () => {
        expect(toDlqWireEntry(makeRow())).toEqual({
            id: 'id-1',
            eventName: 'orders.failed',
            payload: { orderId: 'o1' },
            error: 'timeout',
            attempts: 3,
            deadAt: '2026-05-15T00:00:00.000Z',
            expiresAt: '2023-11-14T22:13:20.000Z',
        });
    });

    it('omits expiresAt when the row has no usable ttl', () => {
        const wire = toDlqWireEntry(makeRow({ ttl: undefined as unknown as number }));
        expect(wire).not.toHaveProperty('expiresAt');
    });

    it('preserves a null payload rather than coercing it', () => {
        expect(toDlqWireEntry(makeRow({ payload: null })).payload).toBeNull();
    });
});

describe('toDlqWireEntry — in-memory DeadLetteredMessage', () => {
    it('maps messageId/envelope/deadLetteredAt onto the row field names', () => {
        expect(toDlqWireEntry(makeMessage())).toEqual({
            id: 'm-1',
            eventName: 'orders.failed',
            payload: { orderId: 'o1' },
            error: 'handler threw',
            attempts: 3,
            deadAt: '2026-05-15T00:00:00.000Z',
        });
    });

    it('never leaks the envelope or messageId onto the wire', () => {
        const wire = toDlqWireEntry(makeMessage());
        expect(wire).not.toHaveProperty('envelope');
        expect(wire).not.toHaveProperty('messageId');
        expect(wire).not.toHaveProperty('queueName');
        expect(wire).not.toHaveProperty('deadLetteredAt');
    });

    it('falls back to queueName when the envelope carries no eventName', () => {
        const message = makeMessage({
            envelope: { payload: {}, metadata: {} } as unknown as DeadLetteredMessage['envelope'],
        });
        expect(toDlqWireEntry(message).eventName).toBe('orders-failed');
    });

    it('reads a bare {id, eventName, payload} mirror entry without producing undefined fields', () => {
        const wire = toDlqWireEntry({ id: 'legacy', eventName: 'orders.failed', payload: { a: 1 } });
        expect(wire).toEqual({
            id: 'legacy',
            eventName: 'orders.failed',
            payload: { a: 1 },
            error: '',
            attempts: 0,
            deadAt: '',
        });
    });
});

describe('toDlqWireEntry — one shape from both sources', () => {
    it('produces the same key set apart from the optional expiresAt', () => {
        const fromRow = Object.keys(toDlqWireEntry(makeRow())).filter(k => k !== 'expiresAt').sort();
        const fromMessage = Object.keys(toDlqWireEntry(makeMessage())).sort();
        expect(fromMessage).toEqual(fromRow);
    });
});
