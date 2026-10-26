import { queueResponse } from './helpers/queue-http';
import { afterEach, expect, it, vi } from 'vitest';
import { DurableTransport } from '../src/client/durable';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('signs create, publish retries, receive body and receipt deletion independently', async () => {
  const signed: { url: string; method: string; body: string }[] = [];
  let published = 0;
  let polled = false;
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    expect(new Headers(init.headers).get('X-Test-Signature')).toBe(String(signed.length));
    expect(init.redirect).toBe('error');
    if (url.endsWith('/ready')) return queueResponse(200, { status: 'ready' });
    if (url.endsWith('/messages') && init.method === 'POST') return ++published === 1 ? queueResponse(503) : queueResponse(201, { message_id: 'sent' });
    if (init.method === 'DELETE') return queueResponse(200, { success: true });
    if (init.method === 'PUT') return queueResponse(201, { status: 'created' });
    if (url.endsWith('/messages/receive') && !polled) {
      polled = true;
      return queueResponse(200, { messages: [{ message_id: 'one', approximate_receive_count: 1, receipt_handle: 'receipt/one',
        body: JSON.stringify({ eventName: 'example', payload: {}, metadata: { id: 'one', producer: 'test', timestamp: 1 } }) }] });
    }
    return queueResponse(200, { messages: [] });
  }));
  const transport = new DurableTransport({ url: 'http://mq', retryBaseMs: 1, requestHeaders: request => {
    signed.push(request); return { 'X-Test-Signature': String(signed.length) };
  } });
  await transport.connect();
  try {
    await transport.publish('test', { eventName: 'example', payload: {}, metadata: { id: 'one', producer: 'test', timestamp: 1 } });
    transport.subscribe('test', async () => {}, { pollingInterval: 1 });
    await vi.waitFor(() => expect(transport.getMetrics('test')?.received).toBe(1));
    expect(signed.filter(r => r.method === 'POST' && r.url.endsWith('/messages'))).toHaveLength(2);
    expect(signed.some(r => r.method === 'PUT' && JSON.parse(r.body).configuration)).toBe(true);
    expect(signed.some(r => r.method === 'POST' && r.url.endsWith('/messages/receive') && JSON.parse(r.body).max_number_of_messages === 10)).toBe(true);
    expect(signed).toContainEqual({ url: 'http://mq/api/v1/queues/test/messages/receipt%2Fone', method: 'DELETE', body: '' });
    expect(calls.filter(c => c.init.method === 'POST').every(c => new Headers(c.init.headers).get('content-type') === 'application/json')).toBe(true);
    expect(signed.length).toBe(calls.length);
  } finally { await transport.disconnect(); }
});

it('does not send an unsigned fallback request when the signer fails', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const transport = new DurableTransport({ url: 'http://mq', retryAttempts: 1,
    requestHeaders: () => { throw new Error('signer unavailable'); },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  await transport.connect();
  await expect(transport.publish('test', { eventName: 'example', payload: {}, metadata: { id: 'one', producer: 'test', timestamp: 1 } }))
    .rejects.toThrow('TransportError');
  expect(fetch).not.toHaveBeenCalled();
  await transport.disconnect();
});
