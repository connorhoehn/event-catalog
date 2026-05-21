// tests/dlq.test.ts
//
// E5 DLQ replay infrastructure tests:
//   InMemoryDLQStore, DLQManager, and createValidatingPublisher DLQ integration.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryDLQStore } from '../src/dlq/DLQStore.js';
import { DLQManager } from '../src/dlq/DLQManager.js';
import { Registry } from '../src/registry/index.js';
import { createValidatingPublisher } from '../src/utils/validating-publisher.js';

// ─── InMemoryDLQStore ────────────────────────────────────────────────────────

describe('InMemoryDLQStore', () => {
  it('append + list round-trip', async () => {
    const store = new InMemoryDLQStore();
    const record = {
      id: 'r1',
      eventName: 'orders.created',
      payload: { orderId: 'x' },
      reason: 'VALIDATION_FAILED' as const,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    await store.append(record);
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  it('bounded ring buffer drops oldest when > 1000 records', async () => {
    const store = new InMemoryDLQStore();

    for (let i = 0; i < 1001; i++) {
      await store.append({
        id: `id-${i}`,
        eventName: 'test.event',
        payload: { i },
        reason: 'DELIVERY_FAILED',
        enqueuedAt: new Date().toISOString(),
        retryCount: 0,
      });
    }

    // Should be capped at 1000
    expect(store.size()).toBe(1000);

    // Oldest (id-0) should have been dropped; id-1 should be the first
    const all = await store.list();
    expect(all[0]!.id).toBe('id-1');
    // Last entry should be the newest
    expect(all[999]!.id).toBe('id-1000');
  });

  it('list filtered by eventName', async () => {
    const store = new InMemoryDLQStore();
    await store.append({
      id: 'a',
      eventName: 'orders.created',
      payload: {},
      reason: 'VALIDATION_FAILED',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    });
    await store.append({
      id: 'b',
      eventName: 'payments.failed',
      payload: {},
      reason: 'DELIVERY_FAILED',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    });

    const result = await store.list({ eventName: 'orders.created' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });

  it('list filtered by reason', async () => {
    const store = new InMemoryDLQStore();
    await store.append({
      id: '1',
      eventName: 'x',
      payload: {},
      reason: 'VALIDATION_FAILED',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    });
    await store.append({
      id: '2',
      eventName: 'x',
      payload: {},
      reason: 'UNKNOWN_EVENT_TYPE',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    });
    await store.append({
      id: '3',
      eventName: 'x',
      payload: {},
      reason: 'VALIDATION_FAILED',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    });

    const result = await store.list({ reason: 'VALIDATION_FAILED' });
    expect(result).toHaveLength(2);
    expect(result.every(r => r.reason === 'VALIDATION_FAILED')).toBe(true);
  });

  it('delete removes the record by id', async () => {
    const store = new InMemoryDLQStore();
    await store.append({
      id: 'del-me',
      eventName: 'e',
      payload: {},
      reason: 'DELIVERY_FAILED',
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    });

    await store.delete('del-me');
    const remaining = await store.list();
    expect(remaining).toHaveLength(0);
  });
});

// ─── DLQManager ─────────────────────────────────────────────────────────────

describe('DLQManager', () => {
  it('append fire-and-forget — store error does not throw', async () => {
    const store = new InMemoryDLQStore();
    vi.spyOn(store, 'append').mockRejectedValue(new Error('store down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dlq = new DLQManager(store);
    // Must not throw
    await expect(dlq.append('evt', {}, 'DELIVERY_FAILED')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('replay success — handler called and record deleted', async () => {
    const store = new InMemoryDLQStore();
    const dlq = new DLQManager(store);
    await dlq.append('orders.created', { orderId: 'x' }, 'DELIVERY_FAILED');

    const records = await dlq.list();
    expect(records).toHaveLength(1);

    const handler = vi.fn(async () => {});
    const result = await dlq.replay(records, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(result.replayed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Record should be gone from the store
    const remaining = await dlq.list();
    expect(remaining).toHaveLength(0);
  });

  it('replay failure — retryCount incremented and record kept', async () => {
    const store = new InMemoryDLQStore();
    const dlq = new DLQManager(store);
    await dlq.append('orders.created', { orderId: 'x' }, 'DELIVERY_FAILED');

    const [record] = await dlq.list();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await dlq.replay([record!], async () => {
      throw new Error('network timeout');
    });

    expect(result.replayed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]!.error).toContain('network timeout');

    // Record should still be there with incremented retryCount
    const remaining = await dlq.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.retryCount).toBe(1);
    expect(remaining[0]!.lastReplayedAt).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('replay partial — some succeed some fail — ReplayResult is accurate', async () => {
    const store = new InMemoryDLQStore();
    const dlq = new DLQManager(store);
    await dlq.append('e1', {}, 'VALIDATION_FAILED');
    await dlq.append('e2', {}, 'VALIDATION_FAILED');
    await dlq.append('e3', {}, 'VALIDATION_FAILED');

    const records = await dlq.list();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Handler succeeds for e1 and e3, fails for e2
    const result = await dlq.replay(records, async (r) => {
      if (r.eventName === 'e2') throw new Error('e2 boom');
    });

    expect(result.replayed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('e2 boom');

    // Only e2 should remain
    const remaining = await dlq.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.eventName).toBe('e2');

    consoleSpy.mockRestore();
  });
});

// ─── createValidatingPublisher + DLQ integration ────────────────────────────

describe('createValidatingPublisher with dlq option', () => {
  function makeRegistry() {
    const reg = new Registry();
    reg.declare({
      name: 'orders.created',
      transport: 'durable',
      producer: 'order-service',
      schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['orderId', 'amount'],
      },
    });
    return reg;
  }

  const VALID_PAYLOAD = { orderId: 'o-1', amount: 42 };
  const INVALID_PAYLOAD = { orderId: 123 }; // wrong type + amount missing

  let reg: Registry;
  let store: InMemoryDLQStore;
  let dlq: DLQManager;

  beforeEach(() => {
    reg = makeRegistry();
    store = new InMemoryDLQStore();
    dlq = new DLQManager(store);
  });

  it('strict mode + dlq: validation failure routes to DLQ, does not throw', async () => {
    const publishFn = vi.fn(async () => {});

    const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
      mode: 'strict',
      dlq,
    });

    // Should not throw
    await expect(publish(INVALID_PAYLOAD as never)).resolves.toBeUndefined();

    // publishFn should NOT have been called
    expect(publishFn).not.toHaveBeenCalled();

    // DLQ should have received the failed record
    const records = await dlq.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.eventName).toBe('orders.created');
    expect(records[0]!.reason).toBe('VALIDATION_FAILED');
    expect(records[0]!.payload).toEqual(INVALID_PAYLOAD);
    expect(records[0]!.errorMessage).toBeDefined();
  });

  it('strict mode + dlq: valid payload is published, not DLQ-d', async () => {
    const publishFn = vi.fn(async () => {});

    const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
      mode: 'strict',
      dlq,
    });

    await publish(VALID_PAYLOAD);

    expect(publishFn).toHaveBeenCalledOnce();
    expect(publishFn).toHaveBeenCalledWith(VALID_PAYLOAD);

    // DLQ should be empty
    const records = await dlq.list();
    expect(records).toHaveLength(0);
  });

  it('strict mode without dlq: validation failure still throws', async () => {
    const publishFn = vi.fn(async () => {});

    const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
      mode: 'strict',
      // no dlq
    });

    await expect(publish(INVALID_PAYLOAD as never)).rejects.toThrow();
    expect(publishFn).not.toHaveBeenCalled();
  });
});
