// tests/server-logger.test.ts
//
// The server half's answer to tests/logger-injection.test.ts, and it
// makes the same single claim: **an operator who passes no logger sees
// exactly the console output this service produced before
// `ServerConfig.logger` existed.**
//
// Every assertion in part 1 is a full `expect(warn.mock.calls).toEqual(
// [...])` — call count, argument count, and each argument's exact value.
// That is deliberately stricter than `toHaveBeenCalledWith`: it fails if
// a call is added, if a call is dropped, if a `fields` object leaks into
// a console argument list, or if a message is rewritten. A structured
// logging change that quietly reflows every line into
// `console.warn(msg, {…})` would break every test here, which is the
// point — that reflow is exactly what an operator tailing container logs
// would notice first.
//
// Part 2 runs the same scenarios through an injected `CatalogLogger` and
// asserts console is silent and the fields arrived. Part 3 pins the
// throttles that had to go in front of the per-request and per-scrape
// sites, since those are the one place default output legitimately
// differs from "one line per occurrence".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { CatalogLogger, LogFields } from '../src/utils/logger.js';
import { consoleLogger, LogWriter } from '../src/utils/logger.js';

// ---------------------------------------------------------------------------
// redis mock — the RegistryCoordinator section drives real pub/sub delivery
// ---------------------------------------------------------------------------

type RedisHandler = (msg: string) => void;
const subscriptions = new Map<string, Set<RedisHandler>>();

function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async (channel: string, handler: RedisHandler) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async () => {}),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

import { HttpRouter, type RouteRequest, type RouteResponse } from '../src/server/http-router.js';
import { createBearerAuthMiddleware } from '../src/server/auth.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import { AlertManager } from '../src/server/alerting.js';
import { SseRegistry } from '../src/server/sse.js';
import { RegistryCoordinator, MUTATIONS_CHANNEL } from '../src/server/registry-coordinator.js';
import { buildDeadLetterCallback } from '../src/server/index.js';
import { createValidatingPublisher } from '../src/utils/validating-publisher.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { Registry } from '../src/registry/index.js';
import { expressLikeApp } from './helpers/test-app.js';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

interface Captured {
  level: 'warn' | 'error' | 'info';
  message: string;
  fields?: LogFields;
}

function recordingLogger(): { logger: CatalogLogger; lines: Captured[] } {
  const lines: Captured[] = [];
  return {
    lines,
    logger: {
      warn: (message, fields) => { lines.push({ level: 'warn', message, fields }); },
      error: (message, fields) => { lines.push({ level: 'error', message, fields }); },
      info: (message, fields) => { lines.push({ level: 'info', message, fields }); },
    },
  };
}

/** Minimal RouteRequest/RouteResponse pair for driving HttpRouter directly. */
function routePair(method = 'POST', path = '/api/events'): {
  req: RouteRequest;
  res: RouteResponse;
  sent: unknown[];
} {
  const sent: unknown[] = [];
  const res = {
    status(): RouteResponse { return res; },
    json(body: unknown): void { sent.push(body); },
    send(): void {},
    setHeader(): void {},
    write(): boolean { return true; },
    end(): void {},
    flushHeaders(): void {},
    headersSent: false,
    raw: {} as never,
  } as unknown as RouteResponse;
  const req = {
    method,
    path,
    params: {},
    query: {},
    header: () => undefined,
    on: () => {},
    raw: { socket: { remoteAddress: '10.0.0.7' } } as never,
  } as unknown as RouteRequest;
  return { req, res, sent };
}

const DEAD_LETTER = {
  messageId: 'm-1',
  queueName: 'orders-failed',
  envelope: {
    eventName: 'orders.failed',
    payload: { id: 1 },
    metadata: { id: 'm-1', producer: 'worker', timestamp: 0 },
  },
  error: 'handler threw',
  attempts: 3,
  deadLetteredAt: '2026-05-15T00:00:00.000Z',
};

function schemaRegistry(): Registry {
  const registry = new Registry();
  registry.declare({
    name: 'orders.created',
    producer: 'orders',
    transport: 'signal',
    schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
      additionalProperties: false,
    },
  } as never);
  return registry;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  subscriptions.clear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. default sink — byte-identical console output
// ---------------------------------------------------------------------------

describe('with no logger configured, server output is what it always was', () => {
  it('http-router: an uncaught handler error is one warn with message + detail', async () => {
    const router = new HttpRouter();
    router.post('/events', () => { throw new Error('registry exploded'); });
    const { req, res } = routePair();

    await router.handle(req, res, '/events');

    expect(warnSpy.mock.calls).toEqual([
      ['[http-router] handler error on POST /api/events:', 'registry exploded'],
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('auth: a bearer rejection is still a single-argument warn', () => {
    const middleware = createBearerAuthMiddleware({ token: 'a'.repeat(32) });
    const { req, res } = routePair('DELETE', '/api/events/order.created');

    middleware(req, res, () => { throw new Error('must not admit'); });

    expect(warnSpy.mock.calls).toEqual([
      [
        '[auth] rejected DELETE /api/events/order.created '
        + 'from 10.0.0.7 — missing or invalid bearer token',
      ],
    ]);
  });

  it('metrics: the tracking-cap warning keeps its exact wording', () => {
    const metrics = new MetricsCollector(60, 1);
    metrics.recordPublish('first.event');
    metrics.recordPublish('second.event');

    expect(warnSpy.mock.calls).toEqual([
      [
        '[metrics] tracking cap of 1 events reached — '
        + 'further events are not measured. Registry is larger than this service expects.',
      ],
    ]);
  });

  it('prom-metrics: a throwing collector still passes err.message as a second argument', () => {
    const prom = new PromMetrics();
    prom.collect(() => { throw new Error('gauge source is down'); });

    prom.renderProm();

    expect(warnSpy.mock.calls).toEqual([
      ['[prom-metrics] collector failed:', 'gauge source is down'],
    ]);
  });

  it('alerting: a non-2xx webhook is one single-argument warn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const alerts = new AlertManager({ webhookUrl: 'http://hooks.internal/alert' });

    await alerts.onHealthChange('redis', 'connected', 'disconnected');

    expect(warnSpy.mock.calls).toEqual([
      ['[alerting] webhook returned 503 — alert not delivered, cooldown NOT applied'],
    ]);
  });

  it('alerting: a webhook transport failure keeps its two-argument shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const alerts = new AlertManager({ webhookUrl: 'http://hooks.internal/alert' });

    await alerts.onHealthChange('redis', 'connected', 'disconnected');

    expect(warnSpy.mock.calls).toEqual([
      ['[alerting] webhook delivery failed:', 'ECONNREFUSED'],
    ]);
  });

  it('dead-letter: a failed DLQ store write is still console.error, not console.warn', async () => {
    const callback = buildDeadLetterCallback({
      registry: { get: () => undefined },
      dlqStore: { put: async () => { throw new Error('DDB unavailable'); } },
      additionalHandlers: [],
    });

    callback(DEAD_LETTER as never);
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

    expect(errorSpy.mock.calls).toEqual([
      ['[server] DLQ store write failed:', 'DDB unavailable'],
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dead-letter: a throwing operator handler warns with the event name inline', async () => {
    const callback = buildDeadLetterCallback({
      registry: { get: () => undefined },
      dlqStore: { put: async () => ({}) },
      additionalHandlers: [() => { throw new Error('webhook 500'); }],
    });

    callback(DEAD_LETTER as never);
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    expect(warnSpy.mock.calls).toEqual([
      ['[server] DLQ handler threw on "orders.failed":', 'webhook 500'],
    ]);
  });

  it('validating-publisher: the warn-mode advisory is unchanged', async () => {
    const publish = createValidatingPublisher(
      schemaRegistry(),
      'orders.created',
      async () => {},
      { mode: 'warn' },
    );

    await publish({ orderId: 42 } as never);

    expect(warnSpy.mock.calls).toEqual([
      [
        '[event-catalog] Validation warning for "orders.created": '
        + 'orderId: expected type string, got number',
      ],
    ]);
  });

  it('sse: a throwing teardown keeps err.message as a second console argument', () => {
    const registry = new SseRegistry({ maxStreams: 4, backlogBytes: 0 });
    const { req, res } = routePair('GET', '/api/flow');
    (res as { raw: unknown }).raw = {
      writableLength: 0,
      on: () => {},
      destroy: () => {},
    };

    const stream = registry.open(req, res, () => { throw new Error('detach failed'); });
    stream!.close();

    expect(warnSpy.mock.calls).toEqual([
      ['[sse] stream teardown threw:', 'detach failed'],
    ]);
  });

  it('registry-coordinator: the boot banner is still console.log, one argument', async () => {
    const coordinator = new RegistryCoordinator();
    await coordinator.start('redis://localhost:6379', new Registry());

    expect(logSpy.mock.calls).toEqual([
      [
        `[registry-coordinator] replica ${coordinator.replicaId.slice(0, 8)} `
        + `subscribed to ${MUTATIONS_CHANNEL}`,
      ],
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it('registry-coordinator: an unknown mutation kind keeps its two-argument warn', async () => {
    const coordinator = new RegistryCoordinator();
    await coordinator.start('redis://localhost:6379', new Registry());
    logSpy.mockClear();

    for (const handler of subscriptions.get(MUTATIONS_CHANNEL) ?? []) {
      handler(JSON.stringify({
        kind: 'not-a-real-kind',
        replicaId: 'peer-1',
        payload: {},
        seq: 1,
        ts: 1,
      }));
    }

    expect(warnSpy.mock.calls).toEqual([
      ['[registry-coordinator] unknown mutation kind:', 'not-a-real-kind'],
    ]);
    await coordinator.stop();
  });

  it('routes: a degraded DLQ list still logs the real error under its context', async () => {
    const { app } = dlqApp(async () => { throw new Error('DDB throttled'); });

    await request(app).get('/api/transports/durable/dlq');

    expect(warnSpy.mock.calls).toEqual([
      ['[event-catalog] DLQ list fell back to the in-memory mirror:', 'DDB throttled'],
    ]);
  });

  it('passing consoleLogger explicitly is identical to passing nothing', () => {
    const implicit = new MetricsCollector(60, 1);
    implicit.recordPublish('a');
    implicit.recordPublish('b');
    const implicitCalls = warnSpy.mock.calls.map(args => [...args]);
    warnSpy.mockClear();

    const explicit = new MetricsCollector(60, 1, consoleLogger);
    explicit.recordPublish('a');
    explicit.recordPublish('b');

    expect(warnSpy.mock.calls).toEqual(implicitCalls);
  });

  it('LogWriter.info reproduces console.log, trailing arguments included', () => {
    new LogWriter().info('[event-catalog] server listening on :3010', { port: 3010 });
    new LogWriter().info('[event-catalog] redis:', { url: 'x' }, 'redis://localhost:6379');

    expect(logSpy.mock.calls).toEqual([
      ['[event-catalog] server listening on :3010'],
      ['[event-catalog] redis:', 'redis://localhost:6379'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. injected sink — console silent, fields structured
// ---------------------------------------------------------------------------

describe('an injected logger takes every server line off console', () => {
  it('http-router carries method, path, status and error', async () => {
    const { logger, lines } = recordingLogger();
    const router = new HttpRouter(logger);
    router.post('/events', () => { throw new Error('registry exploded'); });
    const { req, res } = routePair();

    await router.handle(req, res, '/events');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toMatchObject({
      component: 'http-router',
      method: 'POST',
      path: '/api/events',
      status: 500,
      error: 'registry exploded',
    });
  });

  it('auth carries the source but never the presented token', () => {
    const { logger, lines } = recordingLogger();
    const middleware = createBearerAuthMiddleware({ token: 'a'.repeat(32), logger });
    const { req, res } = routePair('DELETE', '/api/events/order.created');

    middleware(req, res, () => {});

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines[0].fields).toMatchObject({
      component: 'auth',
      method: 'DELETE',
      path: '/api/events/order.created',
      source: '10.0.0.7',
      reason: 'missing-or-invalid-bearer-token',
    });
    expect(JSON.stringify(lines[0])).not.toContain('a'.repeat(32));
  });

  it('alerting carries the alert key and the status it got back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const { logger, lines } = recordingLogger();
    const alerts = new AlertManager({ webhookUrl: 'http://hooks.internal/alert', logger });

    await alerts.onHealthChange('redis', 'connected', 'disconnected');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines[0].fields).toMatchObject({
      component: 'alerting',
      status: 503,
      cooldownApplied: false,
    });
  });

  it('the DLQ store failure arrives at error level with the event name', async () => {
    const { logger, lines } = recordingLogger();
    const callback = buildDeadLetterCallback({
      registry: { get: () => undefined },
      dlqStore: { put: async () => { throw new Error('DDB unavailable'); } },
      additionalHandlers: [],
      logger,
    });

    callback(DEAD_LETTER as never);
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));

    expect(errorSpy).not.toHaveBeenCalled();
    expect(lines[0].level).toBe('error');
    expect(lines[0].fields).toMatchObject({
      component: 'server',
      action: 'dlq-store-write',
      eventName: 'orders.failed',
      error: 'DDB unavailable',
    });
  });

  it('the coordinator boot banner arrives at info with the replica id', async () => {
    const { logger, lines } = recordingLogger();
    const coordinator = new RegistryCoordinator(logger);

    await coordinator.start('redis://localhost:6379', new Registry());

    expect(logSpy).not.toHaveBeenCalled();
    expect(lines[0].level).toBe('info');
    expect(lines[0].fields).toMatchObject({
      component: 'registry-coordinator',
      replicaId: coordinator.replicaId,
      action: 'subscribed',
    });
    await coordinator.stop();
  });

  it('a sink with no info/debug simply drops the info line rather than throwing', async () => {
    const warnOnly: CatalogLogger = { warn: () => {}, error: () => {} };
    const coordinator = new RegistryCoordinator(warnOnly);

    await coordinator.start('redis://localhost:6379', new Registry());

    expect(logSpy).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it('threads from RoutesDeps into every route family', async () => {
    const { logger, lines } = recordingLogger();
    const { app } = dlqApp(async () => { throw new Error('DDB throttled'); }, logger);

    await request(app).get('/api/transports/durable/dlq');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines[0].fields).toMatchObject({
      component: 'routes/dlq',
      context: 'DLQ list fell back to the in-memory mirror',
      error: 'DDB throttled',
    });
  });

  it('validating-publisher reports the event, mode and the failing errors', async () => {
    const { logger, lines } = recordingLogger();
    const publish = createValidatingPublisher(
      schemaRegistry(),
      'orders.created',
      async () => {},
      { mode: 'warn', logger },
    );

    await publish({ orderId: 42 } as never);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines[0].fields).toMatchObject({
      eventName: 'orders.created',
      mode: 'warn',
      errors: ['orderId: expected type string, got number'],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. throttling — the one place default output is deliberately NOT
//    one-line-per-occurrence, because these sites run at request rate
// ---------------------------------------------------------------------------

describe('per-request and per-scrape sites are rate-limited in front of the sink', () => {
  it('http-router logs one line, not 200, for a route that throws every time', async () => {
    const { logger, lines } = recordingLogger();
    const router = new HttpRouter(logger);
    router.post('/events', () => { throw new Error('registry exploded'); });

    for (let i = 0; i < 200; i++) {
      const { req, res } = routePair();
      await router.handle(req, res, '/events');
    }

    // Same key (`POST /api/events`) inside the 60s interval, so the
    // first occurrence is logged and the other 199 are counted.
    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toMatchObject({ suppressed: 0 });
  });

  it('a second distinct route still gets its own line, and carries the suppressed count', async () => {
    const { logger, lines } = recordingLogger();
    const router = new HttpRouter(logger);
    router.post('/events', () => { throw new Error('a'); });
    router.post('/other', () => { throw new Error('b'); });

    for (let i = 0; i < 5; i++) {
      const first = routePair('POST', '/api/events');
      await router.handle(first.req, first.res, '/events');
    }
    const second = routePair('POST', '/api/other');
    await router.handle(second.req, second.res, '/other');

    expect(lines).toHaveLength(2);
    expect(lines[1].fields).toMatchObject({ path: '/api/other', suppressed: 4 });
    expect(lines[1].message).toContain('(+4 similar suppressed)');
    // The suffix goes before the trailing colon, not after it.
    expect(lines[1].message).toMatch(/\(\+4 similar suppressed\):$/);
  });

  it('auth caps rejection lines per source address', () => {
    const { logger, lines } = recordingLogger();
    const middleware = createBearerAuthMiddleware({ token: 'a'.repeat(32), logger });

    for (let i = 0; i < 100; i++) {
      const { req, res } = routePair('DELETE', `/api/events/x${i}`);
      middleware(req, res, () => {});
    }

    // Keyed by source, not by path — a scanner walking 100 distinct
    // paths from one address is one log line, not 100.
    expect(lines).toHaveLength(1);
  });

  it('prom-metrics does not write a line per scrape', () => {
    const { logger, lines } = recordingLogger();
    const prom = new PromMetrics(undefined, { logger });
    prom.collect(() => { throw new Error('gauge source is down'); });

    for (let i = 0; i < 50; i++) prom.renderProm();

    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toMatchObject({ suppressed: 0 });
  });

  it('bulk declare does not write 1000 lines for one request', async () => {
    const { logger, lines } = recordingLogger();
    const deps = baseDeps({ logger });
    const app = expressLikeApp();
    app.use('/api', createRoutes(deps));

    await request(app)
      .post('/api/events/bulk')
      .send({
        serviceName: 'bulk-tester',
        events: Array.from({ length: 200 }, (_, i) => ({
          name: `bulk.event.${i}`,
          transport: 'signal',
          // Rejected by validateSchemaShape, so registry.declare throws
          // and the handler's per-event "skipped" line fires — 200 times
          // from a single request, before the throttle.
          schema: { type: 'definitely-not-a-json-schema-type' },
        })),
      });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toMatchObject({
      component: 'routes/events',
      route: 'POST /api/events/bulk',
      status: 'skipped',
    });
  });

  it('the first throttled line is byte-identical — the suffix only appears once something was suppressed', () => {
    const prom = new PromMetrics();
    prom.collect(() => { throw new Error('gauge source is down'); });

    prom.renderProm();
    prom.renderProm();
    prom.renderProm();

    // Second and third scrapes are suppressed by the key interval, so the
    // console saw exactly the pre-throttle line and nothing else.
    expect(warnSpy.mock.calls).toEqual([
      ['[prom-metrics] collector failed:', 'gauge source is down'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// route harness
// ---------------------------------------------------------------------------

function baseDeps(overrides: Partial<RoutesDeps> = {}): RoutesDeps {
  return {
    registry: new Registry(),
    metrics: new MetricsCollector(60),
    metricsObserver: { observe: async () => {}, refreshSubscriberCount: () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getHistory: async () => [],
    } as unknown as RoutesDeps['signal'],
    durable: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getDLQ: () => [],
      publish: vi.fn(async () => {}),
    } as unknown as RoutesDeps['durable'],
    dlqStore: {
      list: vi.fn(async () => []),
      remove: vi.fn(async () => true),
      findById: vi.fn(async () => null),
      put: vi.fn(async () => ({})),
      clear: vi.fn(async () => 0),
    } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
    ...overrides,
  };
}

function dlqApp(list: () => Promise<unknown[]>, logger?: CatalogLogger) {
  const deps = baseDeps({
    dlqStore: {
      list: vi.fn(list),
      remove: vi.fn(async () => true),
      findById: vi.fn(async () => null),
      put: vi.fn(async () => ({})),
      clear: vi.fn(async () => 0),
    } as unknown as RoutesDeps['dlqStore'],
    logger,
  });
  const app = expressLikeApp();
  app.use('/api', createRoutes(deps));
  return { app, deps };
}
