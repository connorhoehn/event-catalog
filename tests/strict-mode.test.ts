// tests/strict-mode.test.ts
//
// Phase E4 — strict-mode enforcement on both sides of the registry.
//   E4.1 — library: EventCatalog.declare throws on compat violation
//          when config.strict === true or EVENT_CATALOG_STRICT=true.
//   E4.2 — server: POST /api/events returns 409 with violations when
//          strict mode is on (env var or x-event-catalog-strict header).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// In-memory redis simulator (reuse pattern from publish-evolution.test.ts).
function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    xAdd: vi.fn(async () => '0-0'),
    xRange: vi.fn(async () => []),
  };
}
vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response('', { status: 200 }));
});

import { EventCatalog } from '../src/client/index';
import { Registry } from '../src/registry/index';
import { createRoutes } from '../src/server/routes';

function baseConfig() {
  return {
    redis: { url: 'redis://localhost' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'test-service',
  };
}

// E4.1 — library-side strict mode
describe('EventCatalog.declare strict mode (Phase E4.1)', () => {
  const ORIG_ENV = process.env.EVENT_CATALOG_STRICT;
  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.EVENT_CATALOG_STRICT;
    else process.env.EVENT_CATALOG_STRICT = ORIG_ENV;
  });

  it('does NOT throw when strict is false (default)', () => {
    const cat = new EventCatalog({ ...baseConfig(), strict: false });
    cat.declare({
      name: 'evt1', schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      },
      transport: 'signal', producer: 'svc',
    });
    // Breaking change: add a new required field.
    expect(() => cat.declare({
      name: 'evt1', schema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
      transport: 'signal', producer: 'svc',
    })).not.toThrow();
  });

  it('THROWS when config.strict is true and compat is broken', () => {
    const cat = new EventCatalog({ ...baseConfig(), strict: true });
    cat.declare({
      name: 'evt2', schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      },
      transport: 'signal', producer: 'svc',
    });
    expect(() => cat.declare({
      name: 'evt2', schema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
      transport: 'signal', producer: 'svc',
    })).toThrow(/strict mode/);
  });

  it('THROWS when EVENT_CATALOG_STRICT=true env var is set', () => {
    process.env.EVENT_CATALOG_STRICT = 'true';
    const cat = new EventCatalog(baseConfig());
    cat.declare({
      name: 'evt3', schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      },
      transport: 'signal', producer: 'svc',
    });
    expect(() => cat.declare({
      name: 'evt3', schema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
      transport: 'signal', producer: 'svc',
    })).toThrow();
  });

  it('config.strict takes precedence over env var', () => {
    process.env.EVENT_CATALOG_STRICT = 'true';
    const cat = new EventCatalog({ ...baseConfig(), strict: false });
    cat.declare({
      name: 'evt4', schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      },
      transport: 'signal', producer: 'svc',
    });
    expect(() => cat.declare({
      name: 'evt4', schema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
      transport: 'signal', producer: 'svc',
    })).not.toThrow();
  });

  it('does not throw on first declaration (no history to break)', () => {
    const cat = new EventCatalog({ ...baseConfig(), strict: true });
    expect(() => cat.declare({
      name: 'evt5', schema: { type: 'object' },
      transport: 'signal', producer: 'svc',
    })).not.toThrow();
  });
});

// E4.2 — server-side strict mode via POST /api/events
describe('POST /api/events strict mode (Phase E4.2)', () => {
  const ORIG_ENV = process.env.EVENT_CATALOG_STRICT;
  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.EVENT_CATALOG_STRICT;
    else process.env.EVENT_CATALOG_STRICT = ORIG_ENV;
  });

  function makeApp() {
    const registry = new Registry();
    const stub = (() => ({})) as unknown;
    const app = express();
    app.use(express.json());
    app.use(createRoutes({
      registry,
      metrics: stub as never,
      metricsObserver: { observe: vi.fn(async () => {}) } as never,
      signal: stub as never,
      durable: stub as never,
      dlqStore: stub as never,
      startedAt: Date.now(),
    }));
    return { app, registry };
  }

  it('strict ON (env): returns 409 on compat-breaking declaration', async () => {
    process.env.EVENT_CATALOG_STRICT = 'true';
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'svc:evt', transport: 'signal', producer: 'svc',
      schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    }).expect(201);
    const res = await request(app).post('/events').send({
      name: 'svc:evt', transport: 'signal', producer: 'svc',
      schema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
    }).expect(409);
    // EC-7 structured error shape:
    //   { error: { code: 'COMPAT_VIOLATION', eventName, violations: [...] } }
    expect(res.body.error.code).toBe('COMPAT_VIOLATION');
    expect(res.body.error.eventName).toBe('svc:evt');
    expect(Array.isArray(res.body.error.violations)).toBe(true);
    expect(res.body.error.violations.length).toBeGreaterThan(0);
  });

  it('strict OFF (default): returns 201 with violations array', async () => {
    delete process.env.EVENT_CATALOG_STRICT;
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'svc:evt2', transport: 'signal', producer: 'svc',
      schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    }).expect(201);
    const res = await request(app).post('/events').send({
      name: 'svc:evt2', transport: 'signal', producer: 'svc',
      schema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
    }).expect(201);
    expect(res.body.compatible).toBe(false);
    expect(Array.isArray(res.body.violations)).toBe(true);
  });

  it('per-request header x-event-catalog-strict=true overrides env-off', async () => {
    delete process.env.EVENT_CATALOG_STRICT;
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'svc:evt3', transport: 'signal', producer: 'svc',
      schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    }).expect(201);
    await request(app).post('/events')
      .set('x-event-catalog-strict', 'true')
      .send({
        name: 'svc:evt3', transport: 'signal', producer: 'svc',
        schema: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'string' } },
          required: ['a', 'b'],
        },
      })
      .expect(409);
  });

  it('accepts transport: "both" (E3 fix)', async () => {
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'evt.both', transport: 'both', producer: 'svc',
      schema: { type: 'object' },
    }).expect(201);
  });

  it('passes through E3 fields (discriminator, aliases, queue, retention)', async () => {
    const { app, registry } = makeApp();
    await request(app).post('/events').send({
      name: 'evt.e3', transport: 'durable', producer: 'svc',
      schema: { type: 'object' },
      queue: 'evt-e3-q',
      retention: 86400,
      fifo: true,
      dlqAfterAttempts: 3,
      discriminator: { field: 'kind', values: ['a', 'b'] },
      aliases: [{ name: 'old.name', deprecated: true }],
    }).expect(201);
    const entry = registry.get('evt.e3');
    expect(entry).toBeDefined();
    expect(entry!.queue).toBe('evt-e3-q');
    expect(entry!.retention).toBe(86400);
    expect(entry!.fifo).toBe(true);
    expect(entry!.dlqAfterAttempts).toBe(3);
    expect(entry!.discriminator).toEqual({ field: 'kind', values: ['a', 'b'] });
    expect(entry!.aliases).toEqual([{ name: 'old.name', deprecated: true }]);
  });
});

// EC-7 — compat-gate strict mode + per-event override on POST /api/events
describe('POST /api/events compat-gate (wave3-ec-7)', () => {
  const ORIG_ENV = process.env.EVENT_CATALOG_STRICT;
  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.EVENT_CATALOG_STRICT;
    else process.env.EVENT_CATALOG_STRICT = ORIG_ENV;
  });

  function makeApp() {
    const registry = new Registry();
    const stub = (() => ({})) as unknown;
    const app = express();
    app.use(express.json());
    app.use(createRoutes({
      registry,
      metrics: stub as never,
      metricsObserver: { observe: vi.fn(async () => {}) } as never,
      signal: stub as never,
      durable: stub as never,
      dlqStore: stub as never,
      startedAt: Date.now(),
    }));
    return { app, registry };
  }

  const baseSchema = {
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
  };
  const breakingSchema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['a', 'b'],
  };
  // Backward-compatible additive change: new optional field, no required-list change.
  const additiveSchema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['a'],
  };

  it('strict mode: 409 carries structured COMPAT_VIOLATION error shape', async () => {
    process.env.EVENT_CATALOG_STRICT = 'true';
    const { app, registry } = makeApp();
    await request(app).post('/events').send({
      name: 'ec7:evt', transport: 'signal', producer: 'svc', schema: baseSchema,
    }).expect(201);
    const v1 = registry.get('ec7:evt')!.version;

    const res = await request(app).post('/events').send({
      name: 'ec7:evt', transport: 'signal', producer: 'svc', schema: breakingSchema,
    }).expect(409);

    expect(res.body).toEqual({
      error: {
        code: 'COMPAT_VIOLATION',
        eventName: 'ec7:evt',
        violations: expect.any(Array),
      },
    });
    expect(res.body.error.violations.length).toBeGreaterThan(0);

    // Critical: registry must NOT have mutated on rejection.
    const after = registry.get('ec7:evt')!;
    expect(after.version).toBe(v1);
    expect(after.schema).toEqual(baseSchema);
  });

  it('strict mode: 201 on additive (backward-compatible) update', async () => {
    process.env.EVENT_CATALOG_STRICT = 'true';
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'ec7:additive', transport: 'signal', producer: 'svc', schema: baseSchema,
    }).expect(201);

    const res = await request(app).post('/events').send({
      name: 'ec7:additive', transport: 'signal', producer: 'svc', schema: additiveSchema,
    }).expect(201);

    expect(res.body.compatible).toBe(true);
    expect(res.body.version).toBe(2);
  });

  it('off mode (env unset, no per-event): 201 on breaking change, no error shape', async () => {
    delete process.env.EVENT_CATALOG_STRICT;
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'ec7:off', transport: 'signal', producer: 'svc', schema: baseSchema,
    }).expect(201);

    const res = await request(app).post('/events').send({
      name: 'ec7:off', transport: 'signal', producer: 'svc', schema: breakingSchema,
    }).expect(201);

    expect(res.body.compatible).toBe(false);
    expect(Array.isArray(res.body.violations)).toBe(true);
  });

  it('per-event compatMode: "off" overrides env=strict (event accepts breaking change)', async () => {
    process.env.EVENT_CATALOG_STRICT = 'true';
    const { app } = makeApp();
    // Declare with explicit per-event compatMode=off — registry sticks it.
    await request(app).post('/events').send({
      name: 'ec7:override-off', transport: 'signal', producer: 'svc',
      schema: baseSchema, compatMode: 'off',
    }).expect(201);

    // Second registration would normally be rejected by env strict, but
    // the per-event override wins.
    const res = await request(app).post('/events').send({
      name: 'ec7:override-off', transport: 'signal', producer: 'svc',
      schema: breakingSchema,
    }).expect(201);

    expect(res.body.compatible).toBe(false);
  });

  it('per-event compatMode: "strict" overrides env=off (event rejects breaking change)', async () => {
    delete process.env.EVENT_CATALOG_STRICT;
    const { app } = makeApp();
    await request(app).post('/events').send({
      name: 'ec7:override-strict', transport: 'signal', producer: 'svc',
      schema: baseSchema, compatMode: 'strict',
    }).expect(201);

    const res = await request(app).post('/events').send({
      name: 'ec7:override-strict', transport: 'signal', producer: 'svc',
      schema: breakingSchema,
    }).expect(409);

    expect(res.body.error.code).toBe('COMPAT_VIOLATION');
    expect(res.body.error.eventName).toBe('ec7:override-strict');
  });

  it('per-event compatMode: "warn" accepts breaking change with violations on 201', async () => {
    delete process.env.EVENT_CATALOG_STRICT;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { app } = makeApp();
      await request(app).post('/events').send({
        name: 'ec7:warn', transport: 'signal', producer: 'svc',
        schema: baseSchema, compatMode: 'warn',
      }).expect(201);

      const res = await request(app).post('/events').send({
        name: 'ec7:warn', transport: 'signal', producer: 'svc',
        schema: breakingSchema,
      }).expect(201);

      expect(res.body.compatible).toBe(false);
      expect(Array.isArray(res.body.violations)).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('compat-warn for "ec7:warn"'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
