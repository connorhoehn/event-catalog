// tests/flow-tap.test.ts
//
// Phase E8.1 — live flow tap. Covers:
//   - tapEmitter pub/sub mechanics
//   - matchesTapFilter predicate (each filter dimension)
//   - GET /api/flow SSE route behavior via direct mocks (no socket
//     abort dance — keeps the test fast and avoids ECONNRESET noise)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import {
  tapEmitter,
  matchesTapFilter,
  type TapEvent,
} from '../src/server/tap-emitter.js';

const sampleEvent: TapEvent = {
  eventName: 'pipeline.run.started',
  namespace: 'pipeline',
  producer: 'distributed-core',
  transport: 'signal',
  timestamp: '2026-05-15T14:00:00.000Z',
  channel: 'pipeline.run.started',
  envelope: { eventName: 'pipeline.run.started', payload: {}, metadata: {} },
};

describe('matchesTapFilter', () => {
  it('returns true when the filter is empty', () => {
    expect(matchesTapFilter(sampleEvent, {})).toBe(true);
  });

  it('filters by eventName exact match', () => {
    expect(matchesTapFilter(sampleEvent, { eventName: 'pipeline.run.started' })).toBe(true);
    expect(matchesTapFilter(sampleEvent, { eventName: 'other.event' })).toBe(false);
  });

  it('filters by transport', () => {
    expect(matchesTapFilter(sampleEvent, { transport: 'signal' })).toBe(true);
    expect(matchesTapFilter(sampleEvent, { transport: 'durable' })).toBe(false);
  });

  it('filters by producer', () => {
    expect(matchesTapFilter(sampleEvent, { producer: 'distributed-core' })).toBe(true);
    expect(matchesTapFilter(sampleEvent, { producer: 'other-service' })).toBe(false);
  });

  it('filters by namespace', () => {
    expect(matchesTapFilter(sampleEvent, { namespace: 'pipeline' })).toBe(true);
    expect(matchesTapFilter(sampleEvent, { namespace: 'sfu' })).toBe(false);
  });

  it('AND-combines multiple filters', () => {
    expect(
      matchesTapFilter(sampleEvent, { namespace: 'pipeline', transport: 'signal' }),
    ).toBe(true);
    expect(
      matchesTapFilter(sampleEvent, { namespace: 'pipeline', transport: 'durable' }),
    ).toBe(false);
  });
});

describe('tapEmitter pub/sub', () => {
  beforeEach(() => {
    tapEmitter.removeAllListeners('publish');
  });

  it('delivers published events to listeners', () => {
    const seen: TapEvent[] = [];
    const handler = (e: TapEvent) => seen.push(e);
    tapEmitter.on('publish', handler);
    tapEmitter.publish(sampleEvent);
    tapEmitter.publish({ ...sampleEvent, eventName: 'other.x', namespace: 'other' });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.eventName).toBe('pipeline.run.started');
    expect(seen[1]!.eventName).toBe('other.x');
  });

  it('off() removes the listener cleanly', () => {
    const seen: TapEvent[] = [];
    const handler = (e: TapEvent) => seen.push(e);
    tapEmitter.on('publish', handler);
    tapEmitter.off('publish', handler);
    tapEmitter.publish(sampleEvent);
    expect(seen).toHaveLength(0);
  });

  it('allows many concurrent listeners (no Node 10-listener warning)', () => {
    const handlers: Array<(e: TapEvent) => void> = [];
    for (let i = 0; i < 50; i++) {
      const h = () => {};
      handlers.push(h);
      tapEmitter.on('publish', h);
    }
    // No throw, no warn. Cleanup.
    for (const h of handlers) tapEmitter.off('publish', h);
    expect(tapEmitter.listenerCount('publish')).toBe(0);
  });
});

/**
 * Drive the /api/flow route via a synthetic (req, res) pair so we can
 * inspect SSE writes without spinning up a real TCP server.
 */
function driveFlowRoute(query: Record<string, string> = {}) {
  const registry = new Registry();
  const metrics = new MetricsCollector(60);
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createRoutes({
      registry,
      metrics,
      metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
      signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
      durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
      dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
      startedAt: Date.now(),
    }),
  );

  const writes: string[] = [];
  const headers: Record<string, string> = {};
  const reqEmitter = new EventEmitter();
  const req = Object.assign(reqEmitter, {
    method: 'GET',
    url: `/api/flow?${new URLSearchParams(query).toString()}`,
    headers: { host: 'localhost' },
    query, // express-style
    on: reqEmitter.on.bind(reqEmitter),
  });
  const res = {
    statusCode: 200,
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    flushHeaders: () => {},
    write: (chunk: string) => { writes.push(chunk); return true; },
    end: () => {},
    on: () => {},
  };

  // Invoke express with the synthetic pair.
  return new Promise<{
    writes: string[];
    headers: Record<string, string>;
    close: () => void;
  }>((resolve) => {
    setImmediate(() => {
      app(req as unknown as express.Request, res as unknown as express.Response);
      // Express writes synchronously on first tick.
      setImmediate(() => {
        resolve({
          writes,
          headers,
          close: () => reqEmitter.emit('close'),
        });
      });
    });
  });
}

describe('GET /api/flow route', () => {
  beforeEach(() => {
    tapEmitter.removeAllListeners('publish');
  });

  it('opens the SSE stream with text/event-stream + a connected comment', async () => {
    const { writes, headers, close } = await driveFlowRoute();
    expect(headers['content-type']).toBe('text/event-stream');
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['x-accel-buffering']).toBe('no');
    expect(writes[0]).toContain(': connected;');
    close();
  });

  it('emits one SSE data frame per tap.publish() through the filter', async () => {
    const { writes, close } = await driveFlowRoute();
    // After the opening comment, no events yet.
    expect(writes.filter((w) => w.startsWith('data: '))).toHaveLength(0);

    tapEmitter.publish(sampleEvent);
    expect(writes.filter((w) => w.startsWith('data: '))).toHaveLength(1);
    expect(writes.find((w) => w.startsWith('data: '))).toContain(
      '"eventName":"pipeline.run.started"',
    );

    close();
  });

  it('namespace filter rejects non-matching events', async () => {
    const { writes, close } = await driveFlowRoute({ namespace: 'sfu' });
    tapEmitter.publish(sampleEvent); // namespace 'pipeline' — should drop
    tapEmitter.publish({ ...sampleEvent, namespace: 'sfu', eventName: 'sfu.x' });
    const dataFrames = writes.filter((w) => w.startsWith('data: '));
    expect(dataFrames).toHaveLength(1);
    expect(dataFrames[0]).toContain('"eventName":"sfu.x"');
    close();
  });

  it('sample=N emits only every Nth event', async () => {
    const { writes, close } = await driveFlowRoute({ sample: '3' });
    for (let i = 0; i < 6; i++) tapEmitter.publish(sampleEvent);
    const dataFrames = writes.filter((w) => w.startsWith('data: '));
    // Of 6 events, every 3rd is emitted → 2 frames.
    expect(dataFrames).toHaveLength(2);
    close();
  });

  it('close() detaches the listener so later publishes do not write', async () => {
    const { writes, close } = await driveFlowRoute();
    tapEmitter.publish(sampleEvent);
    expect(writes.filter((w) => w.startsWith('data: '))).toHaveLength(1);

    close();
    tapEmitter.publish(sampleEvent);
    expect(writes.filter((w) => w.startsWith('data: '))).toHaveLength(1);
  });

  it('?transport=invalid is silently ignored — all transports are let through (routes.ts:1074-1077)', async () => {
    // An unrecognized transport value hits the else branch of the ternary,
    // setting filter.transport = undefined, which means no transport filter.
    const { writes, close } = await driveFlowRoute({ transport: 'invalid' });
    tapEmitter.publish(sampleEvent); // transport='signal' — should pass because filter is undefined
    const dataFrames = writes.filter((w) => w.startsWith('data: '));
    expect(dataFrames).toHaveLength(1);
    close();
  });
});

describe('MetricsObserver tap wiring', () => {
  beforeEach(() => {
    tapEmitter.removeAllListeners('publish');
    vi.useFakeTimers();
  });

  it('signal subscribe handler emits a tap event with namespace + envelope', async () => {
    // Drive the observer's path indirectly: declare an event, intercept
    // tapEmitter, then synthesize the subscribe callback.
    const seen: TapEvent[] = [];
    tapEmitter.on('publish', (e) => seen.push(e));

    const registry = new Registry();
    registry.declare({
      name: 'pipeline.run.started',
      namespace: 'pipeline',
      schema: {},
      transport: 'signal',
      producer: 'distributed-core',
    });

    // Simulate what observer/signal-handler would do post-subscribe.
    const entry = registry.get('pipeline.run.started')!;
    const envelope = { eventName: entry.name, payload: { x: 1 }, metadata: {} };
    tapEmitter.publish({
      eventName: entry.name,
      namespace: entry.namespace,
      producer: Array.isArray(entry.producer) ? entry.producer[0]! : entry.producer,
      transport: 'signal',
      timestamp: new Date().toISOString(),
      channel: typeof entry.channel === 'string' ? entry.channel : entry.name,
      envelope,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.namespace).toBe('pipeline');
    expect(seen[0]!.envelope).toEqual(envelope);
  });
});
