// tests/publish-signal.test.ts
//
// Wave1-EC-3 — EventCatalog.publishSignal(): channel-scoped signal publish
// for the websocket-gateway broadcast path. Covers:
//   - target-nodes lookup + channel_message envelope on `websocket:route:*`
//   - schema validation on declared events (throws on bad payload)
//   - warn-and-continue on undeclared events (no throw)
//   - skip when no nodes are subscribed
//   - discriminator validation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory Redis pub/sub + set simulator
const subscriptions = new Map<string, Set<(message: string, channel: string) => void>>();
const sets = new Map<string, Set<string>>();
const publishedMessages = new Map<string, string[]>();

function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      if (!publishedMessages.has(channel)) publishedMessages.set(channel, []);
      publishedMessages.get(channel)!.push(message);
      const handlers = subscriptions.get(channel);
      if (handlers) {
        for (const handler of handlers) handler(message, channel);
      }
      return handlers?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: (message: string, channel: string) => void) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async (channel: string) => { subscriptions.delete(channel); }),
    xAdd: vi.fn(async () => '0-0'),
    xRange: vi.fn(async () => []),
    sMembers: vi.fn(async (key: string) => Array.from(sets.get(key) ?? [])),
    sAdd: vi.fn(async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return 1;
    }),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EventCatalog } from '../src/client/index.js';

function makeConfig() {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'platform-api',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptions.clear();
  sets.clear();
  publishedMessages.clear();
  fetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));
});

describe('EventCatalog.publishSignal (wave1-ec-3)', () => {
  it('publishes channel_message envelope to websocket:route:{channelId} with targetNodes from Redis set', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'social:post',
      schema: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['postId', 'content'],
      },
      transport: 'signal',
      producer: 'platform-api',
    });

    // Seed gateway-nodes set so the publish actually fires
    sets.set('websocket:channel:room-1:nodes', new Set(['node-a', 'node-b']));

    const delivered = await catalog.publishSignal('room-1', 'social:post', {
      postId: 'p-1',
      content: 'hello',
    });

    expect(delivered).toBe(2);
    const msgs = publishedMessages.get('websocket:route:room-1');
    expect(msgs).toHaveLength(1);

    const envelope = JSON.parse(msgs![0]);
    expect(envelope.type).toBe('channel_message');
    expect(envelope.channel).toBe('room-1');
    expect(envelope.fromNode).toBe('platform-api');
    expect(envelope.seq).toBe(0);
    expect(envelope.excludeClientId).toBeNull();
    expect(envelope.targetNodes.sort()).toEqual(['node-a', 'node-b']);
    expect(envelope.message).toMatchObject({
      type: 'social:post',
      channel: 'room-1',
      payload: { postId: 'p-1', content: 'hello' },
    });
    expect(envelope.message.timestamp).toBeDefined();
    expect(envelope.timestamp).toBeDefined();

    await catalog.disconnect();
  });

  it('skips publish when no target nodes are registered (returns 0)', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'social:post',
      schema: { type: 'object' },
      transport: 'signal',
      producer: 'platform-api',
    });

    const delivered = await catalog.publishSignal('room-empty', 'social:post', { postId: 'p-1' });

    expect(delivered).toBe(0);
    expect(publishedMessages.get('websocket:route:room-empty')).toBeUndefined();

    await catalog.disconnect();
  });

  it('throws when payload fails schema validation on a declared event', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'social:post',
      schema: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
        },
        required: ['postId'],
      },
      transport: 'signal',
      producer: 'platform-api',
    });

    sets.set('websocket:channel:room-1:nodes', new Set(['node-a']));

    await expect(
      catalog.publishSignal('room-1', 'social:post', { wrong: 'shape' } as Record<string, unknown>),
    ).rejects.toThrow(/payload validation failed/);

    // The Redis publish must NOT have fired.
    expect(publishedMessages.get('websocket:route:room-1')).toBeUndefined();

    await catalog.disconnect();
  });

  it('warns but continues for undeclared events (does not throw)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();

    sets.set('websocket:channel:room-1:nodes', new Set(['node-a']));

    const delivered = await catalog.publishSignal('room-1', 'undeclared:event', { foo: 'bar' });

    expect(delivered).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('undeclared event "undeclared:event"'),
    );

    const msgs = publishedMessages.get('websocket:route:room-1');
    expect(msgs).toHaveLength(1);
    const envelope = JSON.parse(msgs![0]);
    expect(envelope.message.type).toBe('undeclared:event');
    expect(envelope.message.payload).toEqual({ foo: 'bar' });

    warnSpy.mockRestore();
    await catalog.disconnect();
  });

  it('enforces discriminator validation when declared', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'ingest:progress',
      // No enum on schema — discriminator validation is the layer being tested.
      schema: {
        type: 'object',
        properties: { type: { type: 'string' } },
        required: ['type'],
      },
      discriminator: { field: 'type', values: ['sync.started', 'sync.completed'] },
      transport: 'signal',
      producer: 'platform-api',
    });

    sets.set('websocket:channel:ingest-1:nodes', new Set(['node-a']));

    // Valid discriminator
    await expect(
      catalog.publishSignal('ingest-1', 'ingest:progress', { type: 'sync.started' }),
    ).resolves.toBe(1);

    // Invalid discriminator
    await expect(
      catalog.publishSignal('ingest-1', 'ingest:progress', { type: 'not.a.real.subtype' }),
    ).rejects.toThrow(/discriminator validation failed/);

    await catalog.disconnect();
  });

  it('updates registry publish stats on success', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'social:post',
      schema: { type: 'object' },
      transport: 'signal',
      producer: 'platform-api',
    });

    sets.set('websocket:channel:room-1:nodes', new Set(['node-a']));

    await catalog.publishSignal('room-1', 'social:post', {});
    await catalog.publishSignal('room-1', 'social:post', {});

    const entry = catalog.getRegistry().get('social:post');
    expect(entry?.metadata.publishCount).toBe(2);
    expect(entry?.metadata.lastPublishedAt).toBeDefined();

    await catalog.disconnect();
  });
});
