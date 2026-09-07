// tests/subscribers-lifecycle.test.ts
//
// Two lifecycle properties of the subscriber list, found by the server
// soak audit:
//
//  1. `subscriberHeartbeats` is keyed `event\0service` and is only ever
//     *read* by walking live events. Anything that removes an event or
//     shrinks a subscriber list must therefore drop the matching keys,
//     or they become unreclaimable for the life of the process.
//     `remove()` was the original leak; `clear()`, `load()` and
//     `reload()` are the same omission on different paths, and
//     `reload()` is the one replication drives.
//
//  2. An event's subscriber list has a ceiling. It is enforced in the
//     registry, not just the route, because replication and the library
//     client both reach `addSubscriber` without passing through HTTP.

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';

import { Registry } from '../src/registry/index.js';
import { MAX_SUBSCRIBERS_PER_EVENT } from '../src/registry/limits.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

/** The private map, reached the same way the soak audit reached it. */
function heartbeatMap(registry: Registry): Map<string, number> {
  return (registry as unknown as { subscriberHeartbeats: Map<string, number> })
    .subscriberHeartbeats;
}

function declare(registry: Registry, name: string): void {
  registry.declare({ name, schema: {}, transport: 'signal', producer: 'p' });
}

function makeApp(registry: Registry) {
  const app = expressLikeApp();
  app.use('/api', createRoutes({
    registry,
    metrics: new MetricsCollector(60),
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: { isConnected: () => true, getAllMetrics: () => new Map() } as unknown as RoutesDeps['signal'],
    durable: { isConnected: () => true, getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
    dlqStore: { list: async () => [] } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
  }));
  return app;
}

/**
 * Minimal stand-in for the redis client the Registry persists through.
 * `hGetAll` is what `load()` / `reload()` hydrate from, so the fake lets
 * a test hand the registry a snapshot in which an event — or one of its
 * subscribers — has disappeared.
 */
function fakeRedis(): { client: unknown; hash: Record<string, string> } {
  const hash: Record<string, string> = {};
  const client = {
    hSet: async (_key: string, field: string, value: string) => { hash[field] = value; return 1; },
    hDel: async (_key: string, field: string) => { delete hash[field]; return 1; },
    hGetAll: async () => ({ ...hash }),
  };
  return { client, hash };
}

describe('subscriber heartbeats are reclaimed on every path an event can vanish', () => {
  it('remove() drops the heartbeats of the event it deletes', () => {
    const registry = new Registry();
    const heartbeats = heartbeatMap(registry);

    for (let i = 0; i < 200; i++) {
      declare(registry, `churn.${i}`);
      registry.addSubscriber(`churn.${i}`, 'svc-a');
      registry.addSubscriber(`churn.${i}`, 'svc-b');
      registry.remove(`churn.${i}`);
    }

    expect(registry.size()).toBe(0);
    // The leak: 400 entries the sweeper could never reach.
    expect(heartbeats.size).toBe(0);
    expect(registry.pruneStaleSubscribers(0)).toHaveLength(0);
  });

  it('remove() leaves other events’ heartbeats alone', () => {
    const registry = new Registry();
    declare(registry, 'keep.me');
    declare(registry, 'drop.me');
    registry.addSubscriber('keep.me', 'svc-a');
    registry.addSubscriber('drop.me', 'svc-a');

    registry.remove('drop.me');

    expect(heartbeatMap(registry).size).toBe(1);
    expect(registry.listSubscriberHeartbeats()).toEqual([
      expect.objectContaining({ eventName: 'keep.me', serviceName: 'svc-a' }),
    ]);
  });

  it('remove() of an unknown event is a no-op and still returns false', () => {
    const registry = new Registry();
    declare(registry, 'a.x');
    registry.addSubscriber('a.x', 'svc-a');

    expect(registry.remove('never.declared')).toBe(false);
    expect(heartbeatMap(registry).size).toBe(1);
  });

  it('clear() drops every heartbeat with the events they named', () => {
    const registry = new Registry();
    declare(registry, 'a.x');
    declare(registry, 'b.y');
    registry.addSubscriber('a.x', 'svc-a');
    registry.addSubscriber('b.y', 'svc-b');

    registry.clear();

    expect(heartbeatMap(registry).size).toBe(0);
  });

  it('reload() reclaims heartbeats for events the snapshot no longer has', async () => {
    const { client, hash } = fakeRedis();
    const registry = new Registry(client as never);
    declare(registry, 'gone.soon');
    declare(registry, 'still.here');
    registry.addSubscriber('gone.soon', 'svc-a');
    registry.addSubscriber('still.here', 'svc-a');
    // `persist` is fire-and-forget; let the writes land.
    await Promise.resolve();

    // A peer deleted the event; this replica repairs from shared state.
    delete hash['gone.soon'];
    expect(await registry.reload()).toBe(true);

    expect(registry.get('gone.soon')).toBeUndefined();
    expect(heartbeatMap(registry).size).toBe(1);
    expect(heartbeatMap(registry).has('still.here\x00svc-a')).toBe(true);
  });

  it('reload() reclaims heartbeats for subscribers trimmed off a surviving event', async () => {
    const { client, hash } = fakeRedis();
    const registry = new Registry(client as never);
    declare(registry, 'a.x');
    registry.addSubscriber('a.x', 'svc-a');
    registry.addSubscriber('a.x', 'svc-b');
    await Promise.resolve();

    // The shared snapshot has since lost svc-b.
    const entry = JSON.parse(hash['a.x']) as { subscribers: string[] };
    entry.subscribers = ['svc-a'];
    hash['a.x'] = JSON.stringify(entry);
    await registry.reload();

    expect(heartbeatMap(registry).size).toBe(1);
    expect(heartbeatMap(registry).has('a.x\x00svc-b')).toBe(false);
  });

  it('load() reclaims heartbeats when an overlaid entry has a shorter list', async () => {
    const { client, hash } = fakeRedis();
    const registry = new Registry(client as never);
    declare(registry, 'a.x');
    registry.addSubscriber('a.x', 'svc-a');
    registry.addSubscriber('a.x', 'svc-b');
    await Promise.resolve();

    const entry = JSON.parse(hash['a.x']) as { subscribers: string[] };
    entry.subscribers = ['svc-a'];
    hash['a.x'] = JSON.stringify(entry);
    await registry.load();

    expect(heartbeatMap(registry).size).toBe(1);
  });
});

describe('an event has a ceiling on distinct subscribers', () => {
  it('addSubscriber refuses past the cap and reports it', () => {
    const registry = new Registry();
    declare(registry, 'load.subs');

    let refused = 0;
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_EVENT + 500; i++) {
      if (!registry.addSubscriber('load.subs', `svc-${i}`)) refused++;
    }

    expect(registry.get('load.subs')!.subscribers).toHaveLength(MAX_SUBSCRIBERS_PER_EVENT);
    expect(registry.listSubscriberHeartbeats()).toHaveLength(MAX_SUBSCRIBERS_PER_EVENT);
    expect(refused).toBe(500);
    // Capped is not the same as quiet.
    expect(registry.getSubscriberRefusalStats()).toMatchObject({
      atCapacity: 500,
      capacity: MAX_SUBSCRIBERS_PER_EVENT,
    });
  });

  it('a subscriber already on the list still refreshes at the cap', () => {
    const registry = new Registry();
    declare(registry, 'a.x');
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_EVENT; i++) {
      registry.addSubscriber('a.x', `svc-${i}`);
    }

    // The scale-out case: an existing consumer re-registering must not
    // be turned away just because the event is full of *other* names.
    expect(registry.addSubscriber('a.x', 'svc-0')).toBe(true);
    expect(registry.get('a.x')!.subscribers).toHaveLength(MAX_SUBSCRIBERS_PER_EVENT);
    expect(registry.getSubscriberRefusalStats().atCapacity).toBe(0);
  });

  it('the cap is per event, not global', () => {
    const registry = new Registry();
    declare(registry, 'a.x');
    declare(registry, 'b.y');
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_EVENT; i++) {
      registry.addSubscriber('a.x', `svc-${i}`);
    }
    expect(registry.addSubscriber('b.y', 'svc-0')).toBe(true);
  });

  it('a name that cannot be a heartbeat key is refused, not stored', () => {
    const registry = new Registry();
    declare(registry, 'a.x');

    // A NUL would forge the `event\0service` composite key.
    expect(registry.addSubscriber('a.x', 'svc\u0000other')).toBe(false);
    expect(registry.addSubscriber('a.x', 'x'.repeat(1000))).toBe(false);
    expect(registry.addSubscriber('a.x', '')).toBe(false);
    expect(registry.get('a.x')!.subscribers).toEqual([]);
    expect(registry.getSubscriberRefusalStats().invalidName).toBe(3);
  });

  it('POST .../subscribers answers 429 at the cap and 400 on a bad name', async () => {
    const registry = new Registry();
    declare(registry, 'a.x');
    const app = makeApp(registry);

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_EVENT; i++) {
      registry.addSubscriber('a.x', `svc-${i}`);
    }

    const capped = await request(app)
      .post('/api/events/a.x/subscribers')
      .send({ serviceName: 'one-too-many' });
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({
      event: 'a.x',
      subscriber: 'one-too-many',
      limit: MAX_SUBSCRIBERS_PER_EVENT,
      current: MAX_SUBSCRIBERS_PER_EVENT,
    });

    const longName = await request(app)
      .post('/api/events/a.x/subscribers')
      .send({ serviceName: 'x'.repeat(1000) });
    expect(longName.status).toBe(400);
    expect(longName.body.error).toMatch(/serviceName must be/);

    // …and the refusal is visible on the listing, not only in the 429.
    const listed = await request(app).get('/api/subscribers');
    expect(listed.body.refusals).toMatchObject({ atCapacity: 1 });
  });

  it('POST .../subscribers still succeeds below the cap', async () => {
    const registry = new Registry();
    declare(registry, 'a.x');
    const app = makeApp(registry);

    const res = await request(app)
      .post('/api/events/a.x/subscribers')
      .send({ serviceName: 'fulfillment-service' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ event: 'a.x', subscriber: 'fulfillment-service' });
  });
});
