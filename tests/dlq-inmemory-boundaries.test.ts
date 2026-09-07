// tests/dlq-inmemory-boundaries.test.ts
//
// Boundary + failure behaviour of the in-process DLQ that tests/dlq.test.ts
// does not reach: clear(eventName) selective purge, the list() limit arm,
// retention of retry state when the underlying store misbehaves mid-replay,
// and combined-filter semantics.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryDLQStore, type IDLQStore } from '../src/dlq/DLQStore.js';
import { DLQManager } from '../src/dlq/DLQManager.js';
import type { DLQRecord, DLQReason } from '../src/dlq/types.js';

function rec(
  id: string,
  eventName = 'orders.created',
  reason: DLQReason = 'VALIDATION_FAILED',
): DLQRecord {
  return {
    id,
    eventName,
    payload: { id },
    reason,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    retryCount: 0,
  };
}

async function seed(store: IDLQStore, records: DLQRecord[]): Promise<void> {
  for (const r of records) await store.append(r);
}

describe('InMemoryDLQStore.clear', () => {
  it('with no argument empties the whole buffer', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b', 'payments.failed')]);

    await store.clear();

    expect(store.size()).toBe(0);
    expect(await store.list()).toEqual([]);
  });

  it('with an eventName removes only that event and preserves the order of the rest', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [
      rec('a', 'orders.created'),
      rec('b', 'payments.failed'),
      rec('c', 'orders.created'),
      rec('d', 'payments.failed'),
      rec('e', 'orders.created'),
    ]);

    await store.clear('orders.created');

    // The reverse-iterating splice must not skip adjacent matches or
    // reshuffle survivors.
    expect((await store.list()).map(r => r.id)).toEqual(['b', 'd']);
    expect(store.size()).toBe(2);
  });

  it('removes a run of consecutive matches, including the very first record', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [
      rec('a', 'orders.created'),
      rec('b', 'orders.created'),
      rec('c', 'payments.failed'),
    ]);

    await store.clear('orders.created');
    expect((await store.list()).map(r => r.id)).toEqual(['c']);
  });

  it('clearing an event with no records is a no-op', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a')]);

    await store.clear('never.seen');
    expect((await store.list()).map(r => r.id)).toEqual(['a']);
  });
});

describe('InMemoryDLQStore.list — limit and filter composition', () => {
  it('limit truncates the result set', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b'), rec('c')]);

    expect((await store.list({ limit: 2 })).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('limit is applied after filtering, not before', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [
      rec('a', 'payments.failed'),
      rec('b', 'payments.failed'),
      rec('c', 'orders.created'),
      rec('d', 'orders.created'),
    ]);

    // A limit-then-filter implementation would return only 'c' here.
    const result = await store.list({ eventName: 'orders.created', limit: 2 });
    expect(result.map(r => r.id)).toEqual(['c', 'd']);
  });

  it('a limit of 0 or a negative limit is ignored rather than emptying the result', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b')]);

    expect(await store.list({ limit: 0 })).toHaveLength(2);
    expect(await store.list({ limit: -5 })).toHaveLength(2);
  });

  it('eventName and reason filters AND together', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [
      rec('a', 'orders.created', 'VALIDATION_FAILED'),
      rec('b', 'orders.created', 'DELIVERY_FAILED'),
      rec('c', 'payments.failed', 'VALIDATION_FAILED'),
    ]);

    const result = await store.list({ eventName: 'orders.created', reason: 'VALIDATION_FAILED' });
    expect(result.map(r => r.id)).toEqual(['a']);
  });

  it('list returns a detached copy — mutating it must not corrupt the store', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b')]);

    const first = await store.list();
    first.splice(0, first.length);

    expect(store.size()).toBe(2);
    expect(await store.list()).toHaveLength(2);
  });

  it('deleting an id that is not present leaves the buffer untouched', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b')]);

    await store.delete('nope');
    expect((await store.list()).map(r => r.id)).toEqual(['a', 'b']);
  });
});

describe('DLQManager.replay — retry-state bookkeeping', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => errSpy.mockRestore());

  it('increments retryCount and stamps lastReplayedAt on a failed replay', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a')]);
    const dlq = new DLQManager(store);

    const result = await dlq.replay(await store.list(), async () => {
      throw new Error('publisher down');
    });

    expect(result).toMatchObject({ replayed: 0, failed: 1 });
    expect(result.errors).toEqual([{ id: 'a', error: 'publisher down' }]);

    const [stored] = await store.list();
    expect(stored!.id).toBe('a');
    expect(stored!.retryCount).toBe(1);
    expect(stored!.lastReplayedAt).toBeTypeOf('string');
  });

  it('accumulates retryCount across repeated failed replays', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a')]);
    const dlq = new DLQManager(store);
    const failing = async (): Promise<void> => { throw new Error('still down'); };

    await dlq.replay(await store.list(), failing);
    await dlq.replay(await store.list(), failing);
    await dlq.replay(await store.list(), failing);

    const all = await store.list();
    // Delete+re-append must not duplicate the record.
    expect(all).toHaveLength(1);
    expect(all[0]!.retryCount).toBe(3);
  });

  it('processes the whole batch even when some records fail, deleting only the successes', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b'), rec('c')]);
    const dlq = new DLQManager(store);

    const result = await dlq.replay(await store.list(), async r => {
      if (r.id === 'b') throw new Error('b is poison');
    });

    expect(result).toMatchObject({ replayed: 2, failed: 1 });
    expect((await store.list()).map(r => r.id)).toEqual(['b']);
  });

  it('stringifies a non-Error rejection rather than reporting "undefined"', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a')]);
    const dlq = new DLQManager(store);

    const result = await dlq.replay(await store.list(), async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain string rejection';
    });

    expect(result.errors[0]!.error).toBe('plain string rejection');
  });

  it('a store failure while persisting retry state is logged, not thrown, and the batch continues', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a'), rec('b')]);
    const dlq = new DLQManager(store);
    const records = await store.list();

    vi.spyOn(store, 'delete').mockRejectedValue(new Error('store unavailable'));

    const result = await dlq.replay(records, async () => {
      throw new Error('publisher down');
    });

    // Both records were still attempted and both failures reported.
    expect(result).toMatchObject({ replayed: 0, failed: 2 });
    expect(errSpy).toHaveBeenCalled();
  });

  it('a store delete failure on a SUCCESSFUL replay surfaces as a failure, not a silent success', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a')]);
    const dlq = new DLQManager(store);
    const records = await store.list();

    vi.spyOn(store, 'delete').mockRejectedValue(new Error('store unavailable'));

    const result = await dlq.replay(records, async () => { /* handler succeeds */ });

    // The record could not be removed, so counting it as replayed would
    // hide a record that will be replayed again on the next sweep.
    expect(result.replayed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]!.error).toBe('store unavailable');
  });

  it('replaying an empty batch is a no-op', async () => {
    const dlq = new DLQManager(new InMemoryDLQStore());
    expect(await dlq.replay([], async () => {})).toEqual({ replayed: 0, failed: 0, errors: [] });
  });
});

describe('DLQManager — delegation surface', () => {
  it('delete and clear pass straight through to the backing store', async () => {
    const store = new InMemoryDLQStore();
    await seed(store, [rec('a', 'orders.created'), rec('b', 'payments.failed')]);
    const dlq = new DLQManager(store);

    await dlq.delete('a');
    expect((await dlq.list()).map(r => r.id)).toEqual(['b']);

    await dlq.append('orders.created', { orderId: 'x' }, 'DELIVERY_FAILED', 'mq unreachable');
    expect(await dlq.list({ eventName: 'orders.created' })).toHaveLength(1);

    await dlq.clear('orders.created');
    expect((await dlq.list()).map(r => r.id)).toEqual(['b']);

    await dlq.clear();
    expect(await dlq.list()).toEqual([]);
  });

  it('append stamps a unique id, a zero retryCount and an ISO enqueuedAt', async () => {
    const store = new InMemoryDLQStore();
    const dlq = new DLQManager(store);

    await dlq.append('orders.created', { a: 1 }, 'VALIDATION_FAILED', 'missing orderId');
    await dlq.append('orders.created', { a: 2 }, 'VALIDATION_FAILED');

    const [first, second] = await dlq.list();
    expect(first!.id).not.toBe(second!.id);
    expect(first!.retryCount).toBe(0);
    expect(first!.errorMessage).toBe('missing orderId');
    expect(second!.errorMessage).toBeUndefined();
    expect(new Date(first!.enqueuedAt).toISOString()).toBe(first!.enqueuedAt);
  });
});
