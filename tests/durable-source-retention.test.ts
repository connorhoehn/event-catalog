import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { DurableTransport } from '../src/client/durable';

let server: Server | undefined;
const clients: DurableTransport[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.disconnect()));
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
});

it('retains a poison message at the broker after the client and its diagnostic buffer are replaced', async () => {
  // A real HTTP boundary, with source state surviving either client instance.
  // This proves the subscriber's delete policy, not the broker's disk durability.
  const envelope = { eventName: 'job:queued', payload: { id: 'job-1' }, metadata: { id: 'event-1', producer: 'test', timestamp: 1 } };
  let sourceBody: string | undefined = JSON.stringify(envelope);
  let eligible = true;
  let deletes = 0;
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'DELETE') { deletes++; sourceBody = undefined; res.end('{"success":true}'); return; }
    if (req.url?.includes('/messages/receive')) {
      const messages = eligible && sourceBody ? [{ message_id: 'm-1', receipt_handle: 'r-1', approximate_receive_count: 1, body: sourceBody }] : [];
      eligible = false;
      res.end(JSON.stringify({ messages })); return;
    }
    req.resume(); res.end(JSON.stringify({ status: req.method === 'PUT' ? 'created' : 'ready' }));
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const create = async () => {
    const client = new DurableTransport({ url, maxProcessingAttempts: 1,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    clients.push(client); await client.connect(); return client;
  };
  const first = await create();
  first.onDeadLetter(() => { throw new Error('diagnostic sink unavailable'); });
  first.subscribe('jobs', async () => { throw new Error('poison handler'); }, { pollingInterval: 5 });
  await vi.waitFor(() => expect(first.getDLQ()).toHaveLength(1));
  await first.disconnect();
  expect(deletes).toBe(0);
  expect(sourceBody).toBe(JSON.stringify(envelope));

  const replacement = await create();
  expect(replacement.getDLQ()).toEqual([]);
  eligible = true; // Broker visibility expiry; the old diagnostic buffer is irrelevant.
  const handler = vi.fn(async () => {});
  replacement.subscribe('jobs', handler, { pollingInterval: 5 });
  await vi.waitFor(() => expect(deletes).toBe(1));
  expect(handler).toHaveBeenCalledWith(envelope, expect.objectContaining({ messageId: 'm-1', receiveCount: 1 }));
  expect(sourceBody).toBeUndefined();
});
