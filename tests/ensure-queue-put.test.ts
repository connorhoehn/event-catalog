// tests/ensure-queue-put.test.ts
//
// Phase 4.2 — DurableTransport.ensureQueue uses PUT and handles
// 200 / 201 / 409 semantics. Maps declared queue config (retention,
// fifo, dlqAfterAttempts) to message-queue's snake_case fields.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DurableTransport } from '../src/client/durable';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

function findPutCalls(): Array<[string, RequestInit]> {
  return fetchMock.mock.calls.filter(([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT') as Array<[string, RequestInit]>;
}

describe('DurableTransport.ensureQueue (Phase 4.2)', () => {
  it('issues PUT /api/v1/queues/:name on first ensure', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'created' }), { status: 201 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('test-queue');

    const puts = findPutCalls();
    expect(puts).toHaveLength(1);
    const [url] = puts[0];
    expect(url).toBe('http://mq:3004/api/v1/queues/test-queue');
  });

  it('passes declared retention + fifo as snake_case config fields', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 201 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('configured-q', { retention: 86_400, fifo: true });

    const puts = findPutCalls();
    expect(puts).toHaveLength(1);
    const body = JSON.parse((puts[0][1].body as string));
    expect(body.configuration).toEqual({
      message_retention_period_seconds: 86_400,
      fifo_queue: true,
    });
  });

  it('auto-creates a paired DLQ when dlqAfterAttempts is declared', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 201 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('main-q', { dlqAfterAttempts: 3 });

    const puts = findPutCalls();
    expect(puts).toHaveLength(2);
    expect(puts[0][0]).toBe('http://mq:3004/api/v1/queues/main-q-dlq');
    expect(puts[1][0]).toBe('http://mq:3004/api/v1/queues/main-q');
    const mainBody = JSON.parse((puts[1][1].body as string));
    expect(mainBody.configuration.redrive_policy).toEqual({
      dead_letter_target_arn: 'arn:message-queue:queue:main-q-dlq',
      max_receive_count: 3,
    });
  });

  it('honors a custom dlqQueueName override', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 201 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('main-q', {
      dlqAfterAttempts: 5,
      dlqQueueName: 'shared-dlq',
    });

    const puts = findPutCalls();
    expect(puts[0][0]).toBe('http://mq:3004/api/v1/queues/shared-dlq');
    const mainBody = JSON.parse((puts[1][1].body as string));
    expect(mainBody.configuration.redrive_policy.dead_letter_target_arn)
      .toBe('arn:message-queue:queue:shared-dlq');
  });

  it('accepts 200 noop as success (cache the queue)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'noop' }), { status: 200 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('noop-q');
    await transport.ensureQueue('noop-q'); // second call should hit cache

    const puts = findPutCalls();
    expect(puts).toHaveLength(1);
  });

  it('treats 409 conflict as success but logs the conflicts list', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'conflict',
      error: 'configuration_conflict',
      conflicts: [{ field: 'fifo_queue', current: false, requested: true }],
    }), { status: 409 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await transport.ensureQueue('drift-q', { fifo: true });

    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0].join(' ');
    expect(msg).toContain('drift-q');
    expect(msg).toContain('fifo_queue');
    warnSpy.mockRestore();
  });

  it('returns gracefully when the PUT errors out (no throw)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(transport.ensureQueue('unreachable-q')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('falls back to main-only when DLQ ensure fails', async () => {
    // First PUT (DLQ) fails network; second PUT (main) succeeds.
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await transport.ensureQueue('main-orphan', { dlqAfterAttempts: 3 });

    const puts = findPutCalls();
    expect(puts).toHaveLength(2);
    const mainBody = JSON.parse((puts[1][1].body as string));
    expect(mainBody.configuration.redrive_policy).toBeUndefined();
    expect(warnSpy.mock.calls.some((c) =>
      c.join(' ').includes('main queue "main-orphan" will be created WITHOUT redrive_policy'),
    )).toBe(true);
    warnSpy.mockRestore();
  });

  it('subsequent ensureQueue calls hit the in-memory cache (no extra PUT)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 201 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('cached-q');
    await transport.ensureQueue('cached-q');
    await transport.ensureQueue('cached-q');
    expect(findPutCalls()).toHaveLength(1);
  });
});
