import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueResponse } from './helpers/queue-http';
vi.mock('redis', () => ({
  createClient: () => ({
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    disconnect: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
  }),
}));
import { EventCatalog } from '../src/client/index';
import { DurableSubscriptionUnavailableError } from '../src/client/durable';
const catalogs: EventCatalog[] = [];
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function catalog() {
  const value = new EventCatalog({
    serviceName: 'policy-test',
    redis: { url: 'redis://unused' },
    messageQueue: { url: 'http://mq', retryBaseMs: 0, drainTimeoutMs: 50 },
    logger,
  });
  catalogs.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(catalogs.splice(0).map((value) => value.disconnect()));
  vi.unstubAllGlobals();
});

it('sends declared FIFO routing and stable retry dedup identity through the owner wire client', async () => {
  const sends: Record<string, unknown>[] = [],
    puts: { url: string; body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/ready'))
        return queueResponse(200, { status: 'ready' });
      if (init.method === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init.body)) });
        return queueResponse(201, { status: 'created' });
      }
      if (
        init.method === 'POST' &&
        url.endsWith('/custom-work.fifo/messages')
      ) {
        sends.push(JSON.parse(String(init.body)));
        return sends.length === 1
          ? queueResponse(503)
          : queueResponse(201, { message_id: 'accepted' });
      }
      throw new Error(`Unexpected request: ${init.method} ${url}`);
    }),
  );
  const value = catalog();
  value.declare({
    name: 'work:requested',
    transport: 'durable',
    producer: 'policy-test',
    schema: {},
    queue: 'custom-work.fifo',
    fifo: true,
    dlqAfterAttempts: 2,
    partitionKey: (payload) => (payload as { team: string }).team,
  });
  await value.connect();
  await value.publish('work:requested', { team: 'design' });
  expect(sends).toHaveLength(2);
  expect(sends[0]).toEqual(sends[1]);
  expect(sends[0].message_group_id).toBe('design');
  expect(sends[0].message_deduplication_id).toBe(
    JSON.parse(String(sends[0].message_body)).metadata.id,
  );
  expect(puts.map((put) => put.url)).toEqual([
    'http://mq/api/v1/queues/custom-work-dlq.fifo',
    'http://mq/api/v1/queues/custom-work.fifo',
  ]);
  expect(puts[0].body.configuration.fifo_queue).toBe(true);
  await value.publish(
    'work:requested',
    { team: 'ignored' },
    { groupId: 'override', deduplicationId: 'business-write', delaySeconds: 2 },
  );
  expect(sends[2]).toMatchObject({
    message_group_id: 'override',
    message_deduplication_id: 'business-write',
    delay_seconds: 2,
  });
});

it('pauses intake on the declared queue without acknowledging unprocessed deliveries', async () => {
  const calls: { url: string; method: string }[] = [];
  let deliver = false;
  const event = {
    eventName: 'work:requested',
    payload: {},
    metadata: { id: 'event', producer: 'policy-test', timestamp: 1 },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method! });
      if (url.endsWith('/ready'))
        return queueResponse(200, { status: 'ready' });
      if (init.method === 'PUT')
        return queueResponse(201, { status: 'created' });
      if (url.endsWith('/custom-work/messages/receive')) {
        const messages = deliver
          ? [
              {
                message_id: 'message',
                receipt_handle: 'receipt',
                approximate_receive_count: 1,
                body: JSON.stringify(event),
              },
            ]
          : [];
        deliver = false;
        return queueResponse(200, { messages });
      }
      if (init.method === 'DELETE')
        return queueResponse(200, { success: true });
      throw new Error(`Unexpected request: ${init.method} ${url}`);
    }),
  );
  const value = catalog();
  value.declare({
    name: 'work:requested',
    transport: 'durable',
    producer: 'policy-test',
    schema: {},
    queue: 'custom-work',
  });
  await value.connect();
  let pauseFromHandler!: () => void;
  const handler = vi.fn(async () => {
    pauseFromHandler();
  });
  const sub = value.subscribe('work:requested', handler, {
    pollingInterval: 5,
  });
  pauseFromHandler = () => sub.pause();
  await vi.waitFor(() =>
    expect(calls.some((call) => call.url.endsWith('/messages/receive'))).toBe(
      true,
    ),
  );
  sub.pause();
  await new Promise((resolve) => setTimeout(resolve, 20)); // Settle the receive already in flight.
  const receivedBefore = calls.filter((call) =>
    call.url.endsWith('/messages/receive'),
  ).length;
  deliver = true;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(
    calls.filter((call) => call.url.endsWith('/messages/receive')),
  ).toHaveLength(receivedBefore);
  expect(handler).not.toHaveBeenCalled();
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  sub.resume();
  await vi.waitFor(() =>
    expect(
      value.getDurableTransport().getMetrics('custom-work')?.received,
    ).toBe(1),
  );
  expect(handler).toHaveBeenCalledWith(
    event,
    expect.objectContaining({
      messageId: 'message',
      receiveCount: 1,
      signal: expect.any(AbortSignal),
    }),
  );
  await sub.unsubscribe();
  expect(
    calls
      .filter((call) => call.url.includes('/queues/'))
      .every((call) => call.url.includes('/custom-work')),
  ).toBe(true);
});

it('derives a valid FIFO queue name and rejects missing group routing before either fan-out leg starts', async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push(url);
      if (url.endsWith('/ready'))
        return queueResponse(200, { status: 'ready' });
      if (init.method === 'PUT')
        return queueResponse(201, { status: 'created' });
      if (url.endsWith('/work-requested.fifo/messages'))
        return queueResponse(201, { message_id: 'accepted' });
      throw new Error(`Unexpected request: ${init.method} ${url}`);
    }),
  );
  const value = catalog();
  value.declare({
    name: 'work:requested',
    transport: 'both',
    producer: 'policy-test',
    schema: {},
    fifo: true,
  });
  await value.connect();
  const signal = vi
    .spyOn(value.getSignalTransport(), 'publish')
    .mockResolvedValue();
  await expect(value.publish('work:requested', {})).rejects.toThrow('groupId');
  expect(signal).not.toHaveBeenCalled();
  expect(requests).toEqual(['http://mq/ready']);
  await value.publish('work:requested', {}, { groupId: 'team' });
  expect(requests).toContain(
    'http://mq/api/v1/queues/work-requested.fifo/messages',
  );
});

describe('explicit queue-owned subscriptions', () => {
  const handle = { id: 'group-a', generation: 'gen-1' };
  const event = {
    eventName: 'work:requested',
    payload: {},
    metadata: { id: 'event', producer: 'policy-test', timestamp: 1 },
  };
  function durableCatalog() {
    const value = catalog();
    value.declare({
      name: 'work:requested',
      transport: 'durable',
      producer: 'policy-test',
      schema: {},
      queue: 'custom-work',
    });
    return value;
  }

  it('receives through the handle, never ensures the queue and never deletes the subscription on unsubscribe', async () => {
    const calls: { url: string; method: string; body?: any }[] = [];
    let deliver = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method!,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.endsWith('/ready')) return queueResponse(200, { status: 'ready' });
        if (url.endsWith('/custom-work/messages/receive')) {
          const messages = deliver
            ? [{ message_id: 'm', receipt_handle: 'r', approximate_receive_count: 1, body: JSON.stringify(event) }]
            : [];
          deliver = false;
          return queueResponse(200, { messages });
        }
        if (init.method === 'DELETE' && url.endsWith('/messages/r'))
          return queueResponse(200, { success: true });
        throw new Error(`Unexpected request: ${init.method} ${url}`);
      }),
    );
    const value = durableCatalog();
    await value.connect();
    const handler = vi.fn();
    const sub = value.subscribe('work:requested', handler, { subscription: handle, pollingInterval: 5 });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await sub.unsubscribe();
    const receives = calls.filter((call) => call.url.endsWith('/messages/receive'));
    expect(receives.length).toBeGreaterThan(0);
    expect(receives.every((call) => call.body.subscription?.id === 'group-a' && call.body.subscription?.generation === 'gen-1')).toBe(true);
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(calls.some((call) => call.url.includes('/subscriptions'))).toBe(false);
    expect(sub.terminalError?.()).toBeUndefined();
  });

  it.each([
    [409, 'StaleSubscription'],
    [409, 'StaleQueue'],
    [404, 'SubscriptionDoesNotExist'],
    [404, 'QueueDoesNotExist'],
  ])('ends intake on %i %s without falling back to the default scope or re-creating anything', async (status, code) => {
    const calls: { url: string; method: string; body?: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method!, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/ready')) return queueResponse(200, { status: 'ready' });
        if (url.endsWith('/custom-work/messages/receive')) return queueResponse(status, { error_code: code });
        throw new Error(`Unexpected request: ${init.method} ${url}`);
      }),
    );
    const value = durableCatalog();
    await value.connect();
    const onTerminalError = vi.fn();
    const handler = vi.fn();
    const sub = value.subscribe('work:requested', handler, { subscription: handle, pollingInterval: 5, onTerminalError });
    await vi.waitFor(() => expect(onTerminalError).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const error = sub.terminalError?.();
    expect(error).toBeInstanceOf(DurableSubscriptionUnavailableError);
    expect(error).toMatchObject({ code, queue: 'custom-work', subscription: handle });
    expect(onTerminalError).toHaveBeenCalledWith(error);
    const receives = calls.filter((call) => call.url.endsWith('/messages/receive'));
    expect(receives).toHaveLength(1);
    expect(calls.some((call) => call.method === 'PUT' || call.url.includes('/subscriptions'))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(value.getDurableTransport().getOverflowStats().unavailableSubscriptions).toBe(1);
    await sub.unsubscribe();
  });

  it('keeps retrying transient receive failures with the same handle', async () => {
    let attempts = 0;
    const bodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/ready')) return queueResponse(200, { status: 'ready' });
        if (url.endsWith('/messages/receive')) {
          bodies.push(JSON.parse(String(init.body)));
          return ++attempts < 3 ? queueResponse(503) : queueResponse(200, { messages: [] });
        }
        throw new Error(`Unexpected request: ${init.method} ${url}`);
      }),
    );
    const value = durableCatalog();
    await value.connect();
    const sub = value.subscribe('work:requested', vi.fn(), { subscription: handle, pollingInterval: 1 });
    await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    expect(sub.terminalError?.()).toBeUndefined();
    expect(bodies.every((body) => body.subscription?.generation === 'gen-1')).toBe(true);
    await sub.unsubscribe();
  });

  it('rejects a durable handle on a signal-only event and malformed handles before registering anything', () => {
    const value = catalog();
    value.declare({ name: 'presence:changed', transport: 'signal', producer: 'policy-test', schema: {}, channel: 'presence' });
    expect(() => value.subscribe('presence:changed', vi.fn(), { subscription: handle })).toThrow('signal event');
    value.declare({ name: 'work:requested', transport: 'durable', producer: 'policy-test', schema: {}, queue: 'custom-work' });
    for (const bad of [{ id: 'group-a' }, { id: '', generation: 'g' }, null, 'group-a'])
      expect(() => value.subscribe('work:requested', vi.fn(), { subscription: bad as never })).toThrow(TypeError);
    expect(value.getRegistry().eventsSubscribedBy('policy-test')).toEqual([]);
  });
});
