import { queueResponse } from './helpers/queue-http';
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
    fetchMock.mockResolvedValue(queueResponse(201, { status: 'created' }));
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
    fetchMock.mockResolvedValue(queueResponse(201, { status: 'created' }));
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
    fetchMock.mockResolvedValue(queueResponse(201, { status: 'created' }));
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

  it('rejects 409 policy conflicts', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'conflict',
      error: 'configuration_conflict',
      conflicts: [{ field: 'fifo_queue', current: false, requested: true }],
    }), { status: 409 }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(transport.ensureQueue('drift-q', { fifo: true })).rejects.toThrow('ConfigurationConflict');

    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0].join(' ');
    expect(msg).toContain('drift-q');
    expect(msg).toContain('required policy was not accepted');
    warnSpy.mockRestore();
  });

  it('propagates PUT network failures', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(transport.ensureQueue('unreachable-q')).rejects.toThrow('TransportError');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('refuses to create the main queue when its DLQ cannot be ensured', async () => {
    // First PUT (DLQ) fails network; second PUT (main) succeeds.
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(queueResponse(201, { status: 'created' }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(transport.ensureQueue('main-orphan', { dlqAfterAttempts: 3 })).rejects.toThrow('500');

    const puts = findPutCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toContain('main-orphan-dlq');
    warnSpy.mockRestore();
  });

  it('subsequent ensureQueue calls hit the in-memory cache (no extra PUT)', async () => {
    fetchMock.mockResolvedValue(queueResponse(201, { status: 'created' }));
    const transport = new DurableTransport({ url: 'http://mq:3004' });
    await transport.ensureQueue('cached-q');
    await transport.ensureQueue('cached-q');
    await transport.ensureQueue('cached-q');
    expect(findPutCalls()).toHaveLength(1);
  });
});

it('bounds derived FIFO DLQ names and retains the complete policy after send discovers queue deletion', async () => {
  const name = `${'a'.repeat(75)}.fifo`;
  const puts: { queue: string; configuration: unknown }[] = [];
  let sends = 0;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith('/ready')) return queueResponse(200, { status: 'ready' });
    if (init.method === 'PUT') {
      puts.push({ queue: url.split('/').at(-1)!, configuration: JSON.parse(String(init.body)).configuration });
      return queueResponse(201, { status: 'created' });
    }
    return ++sends === 1 ? queueResponse(404, { error_code: 'QueueDoesNotExist' }) : queueResponse(201, { message_id: 'sent' });
  });
  const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 0 });
  await transport.connect();
  await transport.publish(name, { eventName: 'work', payload: {}, metadata: { id: 'stable', producer: 'test', timestamp: 1 } },
    { fifo: true, dlqAfterAttempts: 2, retention: 60 }, { groupId: 'team' });
  expect(puts).toHaveLength(4);
  expect(puts[0].queue).toMatch(/-dlq\.fifo$/);
  expect(puts[0].queue.length).toBeLessThanOrEqual(80);
  expect(puts[0].configuration).toEqual({ fifo_queue: true });
  expect(puts.slice(0, 2)).toEqual(puts.slice(2));
  expect(puts[1].configuration).toEqual({ fifo_queue: true, message_retention_period_seconds: 60,
    redrive_policy: { dead_letter_target_arn: `arn:message-queue:queue:${puts[0].queue}`, max_receive_count: 2 } });
  await transport.disconnect();
});
