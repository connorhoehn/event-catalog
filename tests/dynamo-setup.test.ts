// tests/dynamo-setup.test.ts
//
// Unit tests for ensureTable() (the only export from dynamo-setup.ts),
// which internally calls ensureTTL() and waitForActive().
//
// Strategy: mock @aws-sdk/client-dynamodb so DynamoDBClient.send is fully
// controllable. Exception classes are hoisted so instanceof checks in the
// source match the classes we throw from the mock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { MockResourceNotFoundException, MockResourceInUseException } = vi.hoisted(() => {
  class MockResourceNotFoundException extends Error {
    constructor() {
      super('Requested resource not found');
      this.name = 'ResourceNotFoundException';
    }
  }
  class MockResourceInUseException extends Error {
    constructor() {
      super('Cannot create preexisting table');
      this.name = 'ResourceInUseException';
    }
  }
  return { MockResourceNotFoundException, MockResourceInUseException };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
  DescribeTableCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
  CreateTableCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
  DescribeTimeToLiveCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
  UpdateTimeToLiveCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
  ResourceNotFoundException: MockResourceNotFoundException,
  ResourceInUseException: MockResourceInUseException,
}));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ensureTable } from '../src/server/dynamo-setup.js';

describe('ensureTable()', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let mockDestroy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSend = vi.fn();
    mockDestroy = vi.fn();
    vi.mocked(DynamoDBClient).mockImplementation(() => ({
      send: mockSend,
      destroy: mockDestroy,
    }) as unknown as InstanceType<typeof DynamoDBClient>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('issues only DescribeTable + DescribeTTL when table exists with TTL ENABLED', async () => {
    mockSend
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } })
      .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'ENABLED' } });

    await expect(ensureTable()).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns early without UpdateTTL when TTL status is ENABLING', async () => {
    mockSend
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } })
      .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'ENABLING' } });

    await expect(ensureTable()).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('calls UpdateTTL when table exists but TTL is DISABLED', async () => {
    mockSend
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } })
      .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } })
      .mockResolvedValueOnce({});

    await expect(ensureTable()).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('creates table when ResourceNotFoundException thrown, waits for ACTIVE, then enables TTL', async () => {
    mockSend
      .mockRejectedValueOnce(new MockResourceNotFoundException())   // ensureTable DescribeTable
      .mockResolvedValueOnce({})                                     // CreateTable
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } }) // waitForActive DescribeTable
      .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } })
      .mockResolvedValueOnce({});                                    // UpdateTTL

    await expect(ensureTable()).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it('swallows ResourceInUseException from CreateTable and continues to waitForActive', async () => {
    mockSend
      .mockRejectedValueOnce(new MockResourceNotFoundException())   // ensureTable DescribeTable
      .mockRejectedValueOnce(new MockResourceInUseException())     // CreateTable — race condition
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } }) // waitForActive DescribeTable
      .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'ENABLED' } });

    await expect(ensureTable()).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('rethrows unexpected errors from the initial DescribeTable call', async () => {
    mockSend.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(ensureTable()).rejects.toThrow('ECONNREFUSED');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('throws when waitForActive times out before table becomes ACTIVE', async () => {
    // Use fake timers so we can drive the 30 s polling loop without real waits.
    // waitForActive polls every 1 000 ms; the timeout is 30 000 ms, so after
    // exactly 30 CREATING responses the condition (Date.now() - start >= 30 000)
    // becomes true and the function throws.
    vi.useFakeTimers();
    vi.setSystemTime(0);

    mockSend.mockRejectedValueOnce(new MockResourceNotFoundException()); // ensureTable DescribeTable
    mockSend.mockResolvedValueOnce({});                                   // CreateTable
    for (let i = 0; i < 30; i++) {
      mockSend.mockResolvedValueOnce({ Table: { TableStatus: 'CREATING' } });
    }

    const promise = ensureTable();
    // Attach the rejection handler before advancing timers to avoid an
    // unhandled-rejection warning when the promise rejects mid-advance.
    const expectation = expect(promise).rejects.toThrow(/did not become ACTIVE/);
    // Advance fake time past the 30 000 ms limit; advanceTimersByTimeAsync
    // flushes promise microtasks between each timer tick.
    await vi.advanceTimersByTimeAsync(30_001);
    await expectation;
  }, 5_000);

  // ─── Client lifecycle ──────────────────────────────────────────────────
  //
  // `ensureTable` builds its own DynamoDBClient, uses it once at boot and
  // then goes out of scope — no caller ever gets a reference to it. The AWS
  // SDK's default request handler pools keep-alive sockets, and a pooled
  // socket is a `ref`'d libuv handle, so an undestroyed client keeps the
  // event loop alive by itself. Since `startServer`'s `shutdown()` cannot
  // reach a client it was never handed, releasing it here is the only
  // opportunity there is.

  it('destroys its boot-scoped client on the success path', async () => {
    mockSend
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } })
      .mockResolvedValueOnce({ TimeToLiveDescription: { TimeToLiveStatus: 'ENABLED' } });

    await ensureTable();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('destroys its boot-scoped client even when provisioning throws', async () => {
    // The failure path is the one that matters: `startServer` calls
    // ensureTable() inside a `.catch()` and boots anyway, so a client
    // leaked here would survive for the whole life of a server that is
    // otherwise running perfectly well.
    mockSend.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(ensureTable()).rejects.toThrow('ECONNREFUSED');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
