// tests/poll-queue-vanished.test.ts
//
// A subscribed queue can disappear underneath a running poller: message-queue
// restarts on its in-memory store, or an operator deletes the queue. The
// subscribe-time ensureQueue() is a one-shot, so the poll loop used to 404
// every interval for the rest of the process. It now re-creates the queue in
// place and resumes polling.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DurableTransport } from '../src/client/durable';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('DurableTransport poll loop — queue vanished (404)', () => {
  it('re-creates the queue and keeps polling after a 404', async () => {
    let pollCalls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ status: 'created' }), { status: 201 });
      }
      if (url.includes('/messages?')) {
        pollCalls++;
        // First poll finds the queue gone; every later poll succeeds.
        if (pollCalls === 1) return new Response('Queue does not exist', { status: 404 });
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response('', { status: 200 });
    });

    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const unsubscribe = transport.subscribe('vanishing-q', async () => {}, { pollingInterval: 10 });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && transport.getOverflowStats().queueVanished === 0) {
      await sleep(50);
    }
    // Give the loop a moment to resume polling against the re-created queue.
    await sleep(100);
    unsubscribe();

    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(puts.map(([url]) => url)).toEqual([
      'http://mq:3004/api/v1/queues/vanishing-q',
      'http://mq:3004/api/v1/queues/vanishing-q',
    ]);
    expect(transport.getOverflowStats().queueVanished).toBe(1);
    expect(pollCalls).toBeGreaterThan(1);
  }, 15000);

  it('does not treat other poll failures as a vanished queue', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response('', { status: 201 });
      if (url.includes('/messages?')) return new Response('boom', { status: 500 });
      return new Response('', { status: 200 });
    });

    const transport = new DurableTransport({ url: 'http://mq:3004' });
    const unsubscribe = transport.subscribe('flaky-q', async () => {}, { pollingInterval: 10 });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && transport.getOverflowStats().pollFailures === 0) {
      await sleep(50);
    }
    unsubscribe();

    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(transport.getOverflowStats().queueVanished).toBe(0);
    expect(transport.getOverflowStats().pollFailures).toBeGreaterThan(0);
  }, 15000);
});
