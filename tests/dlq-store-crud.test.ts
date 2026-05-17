// tests/dlq-store-crud.test.ts
//
// Tests for DLQStore.list(), .findById(), .remove(), and .clear() —
// the four methods left untested in dlq-store-retention.test.ts.
// These become load-bearing when M2 (durable backbone) ships.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    PutCommand,
    QueryCommand,
    DeleteCommand,
    BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DLQStore, type DLQEntry } from '../src/server/dlq-store.js';

function makeEntry(overrides: Partial<DLQEntry> = {}): DLQEntry {
    return {
        id: 'id-1',
        pk: 'DLQ#orders.failed',
        sk: '2026-05-15T00:00:00.000Z#id-1',
        eventName: 'orders.failed',
        payload: { orderId: 'o1' },
        error: 'timeout',
        attempts: 3,
        deadAt: '2026-05-15T00:00:00.000Z',
        ttl: 1_700_000_000 + 30 * 86400,
        ...overrides,
    };
}

function makeMockClient(responses: unknown[]): DynamoDBDocumentClient {
    let call = 0;
    const send = vi.fn().mockImplementation(() => {
        const resp = responses[call++] ?? {};
        return Promise.resolve(resp);
    });
    return { send } as unknown as DynamoDBDocumentClient;
}

describe('DLQStore.list()', () => {
    afterEach(() => vi.restoreAllMocks());

    it('issues a ScanCommand when no eventName filter is provided', async () => {
        const entry = makeEntry();
        const client = makeMockClient([{ Items: [entry] }]);
        const store = new DLQStore(client, 'test-dlq');

        const result = await store.list();

        expect(result).toHaveLength(1);
        expect(result[0]!.eventName).toBe('orders.failed');
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        const cmd = send.mock.calls[0]![0];
        // ScanCommand has no KeyConditionExpression
        expect(cmd).not.toBeInstanceOf(QueryCommand);
    });

    it('issues a QueryCommand when eventName filter is provided', async () => {
        const entry = makeEntry();
        const client = makeMockClient([{ Items: [entry] }]);
        const store = new DLQStore(client, 'test-dlq');

        const result = await store.list({ eventName: 'orders.failed' });

        expect(result).toHaveLength(1);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        const cmd = send.mock.calls[0]![0];
        expect(cmd).toBeInstanceOf(QueryCommand);
        expect((cmd.input as { KeyConditionExpression: string }).KeyConditionExpression).toBe('pk = :pk');
    });

    it('returns empty array when scan returns no Items', async () => {
        const client = makeMockClient([{ Items: [] }]);
        const store = new DLQStore(client, 'test-dlq');
        const result = await store.list();
        expect(result).toHaveLength(0);
    });

    it('respects the limit option', async () => {
        const client = makeMockClient([{ Items: [] }]);
        const store = new DLQStore(client, 'test-dlq');
        await store.list({ limit: 5 });
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        const cmd = send.mock.calls[0]![0];
        expect((cmd.input as { Limit: number }).Limit).toBe(5);
    });
});

describe('DLQStore.findById()', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns the entry when found', async () => {
        const entry = makeEntry({ id: 'target-id' });
        const client = makeMockClient([{ Items: [entry] }]);
        const store = new DLQStore(client, 'test-dlq');

        const found = await store.findById('target-id');
        expect(found).not.toBeNull();
        expect(found!.id).toBe('target-id');
        expect(found!.eventName).toBe('orders.failed');
    });

    it('returns null when entry is not found', async () => {
        const client = makeMockClient([{ Items: [] }]);
        const store = new DLQStore(client, 'test-dlq');

        const found = await store.findById('no-such-id');
        expect(found).toBeNull();
    });

    it('scans with FilterExpression matching the id', async () => {
        const entry = makeEntry({ id: 'abc-123' });
        const client = makeMockClient([{ Items: [entry] }]);
        const store = new DLQStore(client, 'test-dlq');

        await store.findById('abc-123');
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        const cmd = send.mock.calls[0]![0];
        expect((cmd.input as { FilterExpression: string }).FilterExpression).toBe('id = :id');
    });

    it('does not cap the Scan with Limit:1 (would silently skip filtered items past the first page)', async () => {
        const entry = makeEntry({ id: 'abc-123' });
        const client = makeMockClient([{ Items: [entry] }]);
        const store = new DLQStore(client, 'test-dlq');

        await store.findById('abc-123');
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        const cmd = send.mock.calls[0]![0];
        expect((cmd.input as { Limit?: number }).Limit).toBeUndefined();
    });

    it('paginates with ExclusiveStartKey when the match is past the first scanned page', async () => {
        const entry = makeEntry({ id: 'late-id' });
        const page1Key = { pk: 'DLQ#orders.failed', sk: '2026-05-15T00:00:00.000Z#prev' };
        // Page 1: empty (filter matched nothing on this page, but more to scan)
        // Page 2: contains the match, no LastEvaluatedKey (table exhausted)
        const client = makeMockClient([
            { Items: [], LastEvaluatedKey: page1Key },
            { Items: [entry] },
        ]);
        const store = new DLQStore(client, 'test-dlq');

        const found = await store.findById('late-id');

        expect(found).not.toBeNull();
        expect(found!.id).toBe('late-id');
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        expect(send).toHaveBeenCalledTimes(2);
        const secondCmd = send.mock.calls[1]![0];
        expect((secondCmd.input as { ExclusiveStartKey?: unknown }).ExclusiveStartKey).toEqual(page1Key);
    });

    it('returns null after scanning every page without a match', async () => {
        const page1Key = { pk: 'DLQ#a', sk: '1#a' };
        const page2Key = { pk: 'DLQ#b', sk: '1#b' };
        const client = makeMockClient([
            { Items: [], LastEvaluatedKey: page1Key },
            { Items: [], LastEvaluatedKey: page2Key },
            { Items: [] }, // no more pages
        ]);
        const store = new DLQStore(client, 'test-dlq');

        const found = await store.findById('ghost');

        expect(found).toBeNull();
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        expect(send).toHaveBeenCalledTimes(3);
    });
});

describe('DLQStore.remove()', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns true and issues DeleteCommand when entry exists', async () => {
        const entry = makeEntry({ id: 'del-id' });
        // First call: findById scan → returns entry
        // Second call: DeleteCommand → success
        const client = makeMockClient([
            { Items: [entry] },
            {},
        ]);
        const store = new DLQStore(client, 'test-dlq');

        const result = await store.remove('del-id');

        expect(result).toBe(true);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        expect(send).toHaveBeenCalledTimes(2);
        const deleteCmd = send.mock.calls[1]![0];
        expect(deleteCmd).toBeInstanceOf(DeleteCommand);
        expect((deleteCmd.input as { Key: Record<string, string> }).Key).toEqual({
            pk: entry.pk,
            sk: entry.sk,
        });
    });

    it('returns false without issuing DeleteCommand when entry is not found', async () => {
        const client = makeMockClient([{ Items: [] }]);
        const store = new DLQStore(client, 'test-dlq');

        const result = await store.remove('ghost-id');

        expect(result).toBe(false);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        // Only the findById scan should have been called
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe('DLQStore.clear()', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns 0 when there are no entries to delete', async () => {
        const client = makeMockClient([{ Items: [] }]);
        const store = new DLQStore(client, 'test-dlq');

        const deleted = await store.clear();
        expect(deleted).toBe(0);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        // No BatchWriteCommand should have been issued
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('batch-deletes entries and returns correct count', async () => {
        const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' }), makeEntry({ id: 'c' })];
        const client = makeMockClient([
            { Items: entries }, // scan/list response
            {}, // BatchWriteCommand response
        ]);
        const store = new DLQStore(client, 'test-dlq');

        const deleted = await store.clear();

        expect(deleted).toBe(3);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        expect(send).toHaveBeenCalledTimes(2);
        const batchCmd = send.mock.calls[1]![0];
        expect(batchCmd).toBeInstanceOf(BatchWriteCommand);
    });

    it('uses QueryCommand (not Scan) when eventName is provided', async () => {
        const entries = [makeEntry()];
        const client = makeMockClient([
            { Items: entries },
            {},
        ]);
        const store = new DLQStore(client, 'test-dlq');

        const deleted = await store.clear('orders.failed');

        expect(deleted).toBe(1);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        const listCmd = send.mock.calls[0]![0];
        expect(listCmd).toBeInstanceOf(QueryCommand);
    });

    it('splits large deletes into batches of 25', async () => {
        const entries = Array.from({ length: 30 }, (_, i) =>
            makeEntry({ id: `id-${i}`, sk: `2026-05-15T00:00:00.000Z#id-${i}` }),
        );
        // scan + 2 BatchWriteCommands (25 + 5)
        const client = makeMockClient([{ Items: entries }, {}, {}]);
        const store = new DLQStore(client, 'test-dlq');

        const deleted = await store.clear();

        expect(deleted).toBe(30);
        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        expect(send).toHaveBeenCalledTimes(3); // 1 scan + 2 batches
    });
});

describe('DLQStore.put()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('returns a DLQEntry with the expected shape', async () => {
        const client = makeMockClient([{}]);
        const store = new DLQStore(client, 'test-table');

        const input = {
            eventName: 'orders.failed',
            payload: { orderId: 'o1' },
            error: 'processing failed',
            attempts: 3,
            deadAt: '2026-05-16T00:00:00.000Z',
        };

        const entry = await store.put(input);

        expect(typeof entry.id).toBe('string');
        expect(entry.pk).toBe('DLQ#orders.failed');
        expect(entry.sk).toContain(entry.id);
        expect(entry.sk).toContain(input.deadAt);
        expect(entry.eventName).toBe('orders.failed');
        expect(entry.payload).toEqual({ orderId: 'o1' });
        expect(entry.error).toBe('processing failed');
        expect(entry.attempts).toBe(3);
        expect(entry.deadAt).toBe(input.deadAt);
    });

    it('issues a PutCommand to the DynamoDB client', async () => {
        const client = makeMockClient([{}]);
        const store = new DLQStore(client, 'test-table');

        await store.put({
            eventName: 'ship.event',
            payload: {},
            error: 'err',
            attempts: 1,
            deadAt: '2026-05-16T00:00:00.000Z',
        });

        const { send } = client as unknown as { send: ReturnType<typeof vi.fn> };
        expect(send).toHaveBeenCalledOnce();
        const cmd = send.mock.calls[0][0] as PutCommand;
        expect(cmd).toBeInstanceOf(PutCommand);
        expect((cmd.input as { TableName: string }).TableName).toBe('test-table');
    });

    it('uses the default 30-day TTL when retentionSeconds is omitted', async () => {
        vi.useFakeTimers();
        const now = new Date('2026-05-16T00:00:00.000Z').getTime();
        vi.setSystemTime(now);

        const client = makeMockClient([{}]);
        const store = new DLQStore(client, 'test-table');

        const entry = await store.put({
            eventName: 'ev.a',
            payload: {},
            error: 'e',
            attempts: 1,
            deadAt: '2026-05-16T00:00:00.000Z',
        });

        const expectedTtl = Math.floor(now / 1000) + 30 * 86400;
        expect(entry.ttl).toBe(expectedTtl);
    });

    it('uses the supplied retentionSeconds for TTL', async () => {
        vi.useFakeTimers();
        const now = new Date('2026-05-16T00:00:00.000Z').getTime();
        vi.setSystemTime(now);

        const client = makeMockClient([{}]);
        const store = new DLQStore(client, 'test-table');

        const SEVEN_DAYS = 7 * 86400;
        const entry = await store.put(
            {
                eventName: 'ev.b',
                payload: {},
                error: 'e',
                attempts: 1,
                deadAt: '2026-05-16T00:00:00.000Z',
            },
            SEVEN_DAYS,
        );

        const expectedTtl = Math.floor(now / 1000) + SEVEN_DAYS;
        expect(entry.ttl).toBe(expectedTtl);
    });
});
