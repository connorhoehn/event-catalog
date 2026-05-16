import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Registry } from '../src/registry/index.js';
import type { RedisClientType } from 'redis';

describe('Registry', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  describe('declare', () => {
    it('registers a new event', () => {
      registry.declare({
        name: 'user:created',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
        transport: 'durable',
        producer: 'auth-service',
        description: 'Fired when a new user is created',
      });

      const entry = registry.get('user:created');
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('user:created');
      expect(entry!.transport).toBe('durable');
      expect(entry!.producer).toBe('auth-service');
      expect(entry!.subscribers).toEqual([]);
      expect(entry!.metadata.publishCount).toBe(0);
    });

    it('updates an existing declaration', () => {
      registry.declare({
        name: 'user:created',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'auth-service',
      });

      registry.declare({
        name: 'user:created',
        schema: { type: 'object', required: ['userId'] },
        transport: 'durable',
        producer: 'auth-service',
        description: 'Updated description',
      });

      const entry = registry.get('user:created');
      expect(entry!.description).toBe('Updated description');
      expect(entry!.schema).toEqual({ type: 'object', required: ['userId'] });
    });

    it('caps schemaHistory at 5 entries — oldest version is evicted on the 7th declare', () => {
      // First declare (v1)
      registry.declare({ name: 'ev.cap', schema: { type: 'object', properties: { v: { type: 'string' } } }, transport: 'signal', producer: 'svc', compatibilityMode: 'none' });
      // Six more redeclares (v2–v7) each with a distinct schema so history grows
      for (let i = 2; i <= 7; i++) {
        registry.declare({ name: 'ev.cap', schema: { type: 'object', properties: { [`v${i}`]: { type: 'string' } } }, transport: 'signal', producer: 'svc', compatibilityMode: 'none' });
      }
      const entry = registry.get('ev.cap')!;
      expect(entry.version).toBe(7);
      expect(entry.schemaHistory).toHaveLength(5);
      // The oldest surviving history entry should be for version 2 (v1 was evicted)
      expect(entry.schemaHistory[0]!.version).toBe(2);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor' });
      registry.declare({ name: 'presence:join', schema: {}, transport: 'signal', producer: 'chat' });
      registry.declare({ name: 'pipeline:completed', schema: {}, transport: 'durable', producer: 'pipeline' });
    });

    it('lists all events', () => {
      expect(registry.list()).toHaveLength(3);
    });

    it('filters by transport', () => {
      const signal = registry.list({ transport: 'signal' });
      expect(signal).toHaveLength(2);
      expect(signal.every(e => e.transport === 'signal')).toBe(true);
    });

    it('filters by producer', () => {
      const editor = registry.list({ producer: 'editor' });
      expect(editor).toHaveLength(1);
      expect(editor[0].name).toBe('cursor:move');
    });
  });

  describe('subscribers', () => {
    it('adds and removes subscribers', () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });

      registry.addSubscriber('user:created', 'notification-service');
      registry.addSubscriber('user:created', 'analytics-service');
      expect(registry.get('user:created')!.subscribers).toEqual(['notification-service', 'analytics-service']);

      registry.removeSubscriber('user:created', 'notification-service');
      expect(registry.get('user:created')!.subscribers).toEqual(['analytics-service']);
    });

    it('does not add duplicate subscribers', () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });
      registry.addSubscriber('user:created', 'service-a');
      registry.addSubscriber('user:created', 'service-a');
      expect(registry.get('user:created')!.subscribers).toEqual(['service-a']);
    });
  });

  describe('validate', () => {
    it('validates payload against schema', () => {
      registry.declare({
        name: 'user:created',
        schema: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        transport: 'durable',
        producer: 'auth',
      });

      expect(registry.validate('user:created', { userId: 'abc' }).valid).toBe(true);
      expect(registry.validate('user:created', { userId: 123 }).valid).toBe(false);
      expect(registry.validate('user:created', {}).valid).toBe(false);
    });

    it('returns error for undeclared event', () => {
      const result = registry.validate('nonexistent', {});
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('not declared');
    });

    it('passes validation when schema is empty', () => {
      registry.declare({ name: 'any:event', schema: {}, transport: 'signal', producer: 'test' });
      expect(registry.validate('any:event', { anything: true }).valid).toBe(true);
    });
  });

  describe('topology', () => {
    it('builds a graph of services and events', () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth-service' });
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor-service' });
      registry.addSubscriber('user:created', 'notification-service');
      registry.addSubscriber('user:created', 'analytics-service');

      const topology = registry.getTopology();

      // 2 events + 4 services = 6 nodes
      expect(topology.nodes).toHaveLength(6);
      // auth→user:created, editor→cursor:move, user:created→notification, user:created→analytics = 4 edges
      expect(topology.edges).toHaveLength(4);

      const publishEdges = topology.edges.filter(e => e.relation === 'publishes');
      expect(publishEdges).toHaveLength(2);

      const subscribeEdges = topology.edges.filter(e => e.relation === 'subscribes');
      expect(subscribeEdges).toHaveLength(2);
    });

    describe('filter (Phase E4.3)', () => {
      beforeEach(() => {
        // Seed three events with overlapping producers/consumers/transports
        // so each filter dimension has both a hit and a miss to verify.
        registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth-service' });
        registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor-service' });
        registry.declare({ name: 'session:closed', schema: {}, transport: 'durable', producer: 'auth-service' });
        registry.addSubscriber('user:created', 'notification-service');
        registry.addSubscriber('user:created', 'analytics-service');
        registry.addSubscriber('cursor:move', 'collab-service');
        registry.addSubscriber('session:closed', 'analytics-service');
      });

      it('filters by producer — returns only that service\'s events', () => {
        const topology = registry.getTopology({ producer: 'auth-service' });
        const eventNodes = topology.nodes.filter(n => n.type === 'event');
        expect(eventNodes.map(n => n.id).sort()).toEqual(['session:closed', 'user:created']);
        // cursor:move and editor-service must NOT appear
        expect(topology.nodes.map(n => n.id)).not.toContain('cursor:move');
        expect(topology.nodes.map(n => n.id)).not.toContain('editor-service');
      });

      it('filters by consumer — returns only events that service subscribes to', () => {
        const topology = registry.getTopology({ consumer: 'analytics-service' });
        const eventNodes = topology.nodes.filter(n => n.type === 'event');
        expect(eventNodes.map(n => n.id).sort()).toEqual(['session:closed', 'user:created']);
        expect(topology.nodes.map(n => n.id)).not.toContain('cursor:move');
      });

      it('filters by eventType — returns exactly that event and its services', () => {
        const topology = registry.getTopology({ eventType: 'cursor:move' });
        const eventNodes = topology.nodes.filter(n => n.type === 'event');
        expect(eventNodes).toHaveLength(1);
        expect(eventNodes[0].id).toBe('cursor:move');
        expect(topology.nodes.map(n => n.id).sort()).toEqual(
          ['collab-service', 'cursor:move', 'editor-service'].sort(),
        );
      });

      it('filters by transport — partitions signal from durable', () => {
        const signalTopo = registry.getTopology({ transport: 'signal' });
        const durableTopo = registry.getTopology({ transport: 'durable' });
        expect(signalTopo.nodes.filter(n => n.type === 'event').map(n => n.id)).toEqual(['cursor:move']);
        expect(durableTopo.nodes.filter(n => n.type === 'event').map(n => n.id).sort())
          .toEqual(['session:closed', 'user:created']);
      });

      it('AND-combines multiple filters — both must match', () => {
        // auth-service produces both user:created (notification + analytics)
        // and session:closed (analytics only). Filtering by producer=auth-service
        // AND consumer=notification-service narrows to just user:created.
        const topology = registry.getTopology({
          producer: 'auth-service',
          consumer: 'notification-service',
        });
        const eventNodes = topology.nodes.filter(n => n.type === 'event');
        expect(eventNodes).toHaveLength(1);
        expect(eventNodes[0].id).toBe('user:created');
      });

      it('returns empty graph when no events match', () => {
        const topology = registry.getTopology({ producer: 'no-such-service' });
        expect(topology.nodes).toEqual([]);
        expect(topology.edges).toEqual([]);
      });

      it('returns full topology when filter is undefined (back-compat)', () => {
        const full = registry.getTopology();
        const eventNodes = full.nodes.filter(n => n.type === 'event');
        expect(eventNodes).toHaveLength(3);
      });
    });

    it('array-producer: creates service nodes + publish edges for each declared producer', () => {
      const reg = new Registry();
      reg.declare({ name: 'order.placed', schema: {}, transport: 'durable', producer: ['platform-api', 'billing-service'] });
      reg.addSubscriber('order.placed', 'fulfillment-service');

      const topo = reg.getTopology();

      const serviceIds = topo.nodes.filter(n => n.type === 'service').map(n => n.id);
      expect(serviceIds).toContain('platform-api');
      expect(serviceIds).toContain('billing-service');

      const publishEdges = topo.edges.filter(e => e.relation === 'publishes');
      expect(publishEdges).toHaveLength(2);
      expect(publishEdges.map(e => e.from).sort()).toEqual(['billing-service', 'platform-api']);
      expect(publishEdges.every(e => e.to === 'order.placed')).toBe(true);
    });

    it('array-producer: producer filter matches any one of the declared producers', () => {
      const reg = new Registry();
      reg.declare({ name: 'order.placed', schema: {}, transport: 'durable', producer: ['platform-api', 'billing-service'] });
      reg.declare({ name: 'user.created', schema: {}, transport: 'signal', producer: 'auth-service' });

      const topo1 = reg.getTopology({ producer: 'billing-service' });
      expect(topo1.nodes.filter(n => n.type === 'event').map(n => n.id)).toContain('order.placed');
      expect(topo1.nodes.filter(n => n.type === 'event').map(n => n.id)).not.toContain('user.created');

      const topo2 = reg.getTopology({ producer: 'platform-api' });
      expect(topo2.nodes.filter(n => n.type === 'event').map(n => n.id)).toContain('order.placed');
    });
  });

  describe('remove', () => {
    it('removes a declared event', () => {
      registry.declare({ name: 'temp:event', schema: {}, transport: 'signal', producer: 'test' });
      expect(registry.size()).toBe(1);

      const removed = registry.remove('temp:event');
      expect(removed).toBe(true);
      expect(registry.size()).toBe(0);
      expect(registry.get('temp:event')).toBeUndefined();
    });

    it('returns false for non-existent event', () => {
      expect(registry.remove('nonexistent')).toBe(false);
    });
  });

  describe('Redis persistence — remove / deprecate / undeprecate', () => {
    function makeRedis(): { redis: RedisClientType; hDel: ReturnType<typeof vi.fn>; hSet: ReturnType<typeof vi.fn> } {
      const hDel = vi.fn().mockResolvedValue(1);
      const hSet = vi.fn().mockResolvedValue(1);
      const hGetAll = vi.fn().mockResolvedValue({});
      const redis = { hGetAll, hSet, hDel } as unknown as RedisClientType;
      return { redis, hDel, hSet };
    }

    it('remove() calls hDel on the Redis-backed registry', async () => {
      const { redis, hDel } = makeRedis();
      const reg = new Registry(redis);
      reg.declare({ name: 'del.event', schema: {}, transport: 'signal', producer: 'svc' });
      const removed = reg.remove('del.event');
      expect(removed).toBe(true);
      // hDel is fire-and-forget; give the microtask queue a tick
      await Promise.resolve();
      expect(hDel).toHaveBeenCalledWith(expect.any(String), 'del.event');
    });

    it('deprecate() calls hSet to persist the deprecation', async () => {
      const { redis, hSet } = makeRedis();
      const reg = new Registry(redis);
      reg.declare({ name: 'dep.event', schema: {}, transport: 'signal', producer: 'svc' });
      hSet.mockClear(); // clear the declare hSet call
      reg.deprecate('dep.event', { reason: 'replaced' });
      await Promise.resolve();
      expect(hSet).toHaveBeenCalledOnce();
      const stored = JSON.parse(hSet.mock.calls[0]![2] as string) as { deprecation: { reason: string } };
      expect(stored.deprecation.reason).toBe('replaced');
    });

    it('undeprecate() calls hSet to persist the cleared deprecation', async () => {
      const { redis, hSet } = makeRedis();
      const reg = new Registry(redis);
      reg.declare({ name: 'dep.event', schema: {}, transport: 'signal', producer: 'svc' });
      reg.deprecate('dep.event');
      hSet.mockClear();
      reg.undeprecate('dep.event');
      await Promise.resolve();
      expect(hSet).toHaveBeenCalledOnce();
      const stored = JSON.parse(hSet.mock.calls[0]![2] as string) as { deprecation?: unknown };
      expect(stored.deprecation).toBeUndefined();
    });
  });

  describe('resolve() — Phase E3.5 alias-aware lookup', () => {
    beforeEach(() => {
      registry.declare({
        name: 'pipeline:run:started',
        schema: {},
        transport: 'signal',
        producer: 'distributed-core',
        aliases: [
          { name: 'pipeline.run.started', until: '2026-12-01' },
        ],
      });
    });

    it('resolves a canonical name directly (no viaAlias)', () => {
      const result = registry.resolve('pipeline:run:started');
      expect(result).toBeDefined();
      expect(result!.entry.name).toBe('pipeline:run:started');
      expect(result!.viaAlias).toBeUndefined();
    });

    it('resolves a deprecated alias name to its canonical entry', () => {
      const result = registry.resolve('pipeline.run.started');
      expect(result).toBeDefined();
      expect(result!.entry.name).toBe('pipeline:run:started');
      expect(result!.viaAlias?.name).toBe('pipeline.run.started');
      expect(result!.viaAlias?.until).toBe('2026-12-01');
    });

    it('returns undefined for an unknown name that is neither canonical nor alias', () => {
      expect(registry.resolve('does.not.exist')).toBeUndefined();
    });

    it('returns undefined when no events are declared', () => {
      const fresh = new Registry();
      expect(fresh.resolve('any.name')).toBeUndefined();
    });

    it('returns the first canonical match even when an event has multiple aliases', () => {
      registry.declare({
        name: 'order:placed',
        schema: {},
        transport: 'durable',
        producer: 'orders',
        aliases: [
          { name: 'order.placed' },
          { name: 'order_placed' },
        ],
      });

      expect(registry.resolve('order.placed')!.entry.name).toBe('order:placed');
      expect(registry.resolve('order_placed')!.entry.name).toBe('order:placed');
    });
  });

  describe('updateStats()', () => {
    it('merges the supplied stats into entry.metadata', () => {
      registry.declare({ name: 'ev.a', schema: {}, transport: 'signal', producer: 'svc' });
      registry.updateStats('ev.a', { publishCount: 42 });
      expect(registry.get('ev.a')!.metadata.publishCount).toBe(42);
    });

    it('is a no-op for unknown events (does not throw)', () => {
      expect(() => registry.updateStats('ghost', { publishCount: 1 })).not.toThrow();
    });

    it('partial update leaves other fields untouched', () => {
      registry.declare({ name: 'ev.b', schema: {}, transport: 'signal', producer: 'svc' });
      registry.updateStats('ev.b', { publishCount: 10 });
      registry.updateStats('ev.b', { errorCount: 2 });
      const meta = registry.get('ev.b')!.metadata;
      expect(meta.publishCount).toBe(10);
      expect(meta.errorCount).toBe(2);
    });
  });

  describe('load() — Redis hydration', () => {
    function makeRedis(store: Record<string, string> = {}): RedisClientType {
      return {
        hGetAll: vi.fn(async () => store),
        hSet: vi.fn(async () => 1),
        hDel: vi.fn(async () => 1),
      } as unknown as RedisClientType;
    }

    it('is a no-op when no Redis client is provided', async () => {
      const reg = new Registry();
      await reg.load(); // should not throw
      expect(reg.size()).toBe(0);
    });

    it('loads events from hGetAll into the in-process map', async () => {
      const entry = {
        name: 'order.placed',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'orders',
        version: 1,
        schemaFingerprint: 'abc',
        schemaHistory: [],
        subscribers: [],
        aliases: [],
        metadata: { publishCount: 0, errorCount: 0, subscriberCount: 0 },
        namespace: 'order',
      };
      const store: Record<string, string> = {
        'order.placed': JSON.stringify(entry),
      };
      const redis = makeRedis(store);
      const reg = new Registry(redis);
      await reg.load();

      expect(reg.size()).toBe(1);
      const loaded = reg.get('order.placed');
      expect(loaded).toBeDefined();
      expect(loaded!.transport).toBe('durable');
      expect(loaded!.producer).toBe('orders');
    });

    it('loads multiple events from Redis', async () => {
      const makeEntry = (name: string) => JSON.stringify({
        name,
        schema: {},
        transport: 'signal',
        producer: 'svc',
        version: 1,
        schemaFingerprint: 'fp',
        schemaHistory: [],
        subscribers: [],
        aliases: [],
        metadata: { publishCount: 0, errorCount: 0, subscriberCount: 0 },
        namespace: 'svc',
      });
      const store: Record<string, string> = {
        'ev.a': makeEntry('ev.a'),
        'ev.b': makeEntry('ev.b'),
        'ev.c': makeEntry('ev.c'),
      };
      const redis = makeRedis(store);
      const reg = new Registry(redis);
      await reg.load();

      expect(reg.size()).toBe(3);
      expect(reg.get('ev.a')).toBeDefined();
      expect(reg.get('ev.b')).toBeDefined();
      expect(reg.get('ev.c')).toBeDefined();
    });

    it('triggers fingerprint backfill for history entries missing fingerprint', async () => {
      const entry = {
        name: 'ev.d',
        schema: { type: 'string' },
        transport: 'signal',
        producer: 'svc',
        version: 2,
        schemaFingerprint: 'fp-current',
        schemaHistory: [
          { schema: { type: 'object' }, version: 1 }, // no fingerprint
        ],
        subscribers: [],
        aliases: [],
        metadata: { publishCount: 0, errorCount: 0, subscriberCount: 0 },
        namespace: 'ev',
      };
      const redis = makeRedis({ 'ev.d': JSON.stringify(entry) });
      const reg = new Registry(redis);
      await reg.load();

      const loaded = reg.get('ev.d');
      expect(loaded!.schemaHistory[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('calls hGetAll with the correct key', async () => {
      const redis = makeRedis();
      const reg = new Registry(redis);
      await reg.load();

      const mockHGetAll = (redis as unknown as { hGetAll: ReturnType<typeof vi.fn> }).hGetAll;
      expect(mockHGetAll).toHaveBeenCalledWith('event-catalog:registry');
    });
  });

  describe('list() subscriber + tag filters', () => {
    beforeEach(() => {
      registry.declare({ name: 'ev.x', schema: {}, transport: 'signal', producer: 'svc', tags: ['payments'] });
      registry.declare({ name: 'ev.y', schema: {}, transport: 'durable', producer: 'svc', tags: ['payments', 'billing'] });
      registry.declare({ name: 'ev.z', schema: {}, transport: 'signal', producer: 'svc' });
      registry.addSubscriber('ev.x', 'consumer-a');
      registry.addSubscriber('ev.y', 'consumer-a');
      registry.addSubscriber('ev.z', 'consumer-b');
    });

    it('filters by subscriber — returns only events subscribed to by that service', () => {
      const results = registry.list({ subscriber: 'consumer-a' });
      expect(results.map(e => e.name).sort()).toEqual(['ev.x', 'ev.y']);
    });

    it('filters by subscriber — returns empty array for unknown service', () => {
      expect(registry.list({ subscriber: 'no-such-consumer' })).toHaveLength(0);
    });

    it('filters by tag — returns events that carry that tag', () => {
      const results = registry.list({ tag: 'payments' });
      expect(results.map(e => e.name).sort()).toEqual(['ev.x', 'ev.y']);
    });

    it('filters by tag — narrower tag returns a subset', () => {
      expect(registry.list({ tag: 'billing' }).map(e => e.name)).toEqual(['ev.y']);
    });

    it('filters by tag — unknown tag returns empty array', () => {
      expect(registry.list({ tag: 'nope' })).toHaveLength(0);
    });
  });

  describe('declare — producer update on re-declaration (registry/index.ts:144)', () => {
    it('sets producer on re-declaration when the existing entry had none', () => {
      // Declare without a producer (producer field absent / falsy).
      registry.declare({ name: 'prod.event', schema: {}, transport: 'signal', producer: '' } as any);
      // Producer is empty — re-declare with a real producer should fill it in.
      registry.declare({ name: 'prod.event', schema: {}, transport: 'signal', producer: 'auth-svc' });
      expect(registry.get('prod.event')?.producer).toBe('auth-svc');
    });

    it('does NOT overwrite an existing producer on re-declaration (sticky)', () => {
      registry.declare({ name: 'sticky.event', schema: {}, transport: 'signal', producer: 'original-svc' });
      // Re-declare with a different producer — should be ignored because original-svc is already set.
      registry.declare({ name: 'sticky.event', schema: {}, transport: 'signal', producer: 'new-svc' });
      expect(registry.get('sticky.event')?.producer).toBe('original-svc');
    });
  });

  describe('declare — invalid schema shape guard', () => {
    it('throws with a descriptive message when schema type is misspelled', () => {
      expect(() =>
        registry.declare({ name: 'bad.event', schema: { type: 'objct' }, transport: 'signal', producer: 'svc' }),
      ).toThrow(/declare\("bad\.event"\) rejected: invalid JSON Schema shape/);
    });

    it('does not throw when schema is empty object (schema shape guard skipped)', () => {
      expect(() =>
        registry.declare({ name: 'empty.schema', schema: {}, transport: 'signal', producer: 'svc' }),
      ).not.toThrow();
    });

    it('throws with the offending validator error embedded in the message', () => {
      expect(() =>
        registry.declare({ name: 'bad.event2', schema: { type: 'objct' }, transport: 'signal', producer: 'svc' }),
      ).toThrow(/objct/);
    });
  });
});
