// tests/bundle-routes.test.ts
//
// HTTP route tests for the FeatureBundle admin surface.
//   GET    /api/feature-bundles
//   GET    /api/feature-bundles/:name
//   GET    /api/feature-bundles/:name/:version
//   GET    /api/feature-bundles/by-fingerprint/:fp
//   GET    /api/feature-bundles/:name/crd-schema
//   POST   /api/feature-bundles/validate

import { describe, it, expect, beforeEach } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import {
  FeatureBundleRegistry,
  type FeatureBundle,
} from '../src/bundles/FeatureBundle.js';
import { createBundleRoutes } from '../src/server/bundle-routes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal IRegistry stub. */
function makeEventRegistry(events: Array<{ name: string; transport: 'signal' | 'durable'; version?: number }>) {
  return {
    get: (name: string) => {
      const ev = events.find((e) => e.name === name);
      if (!ev) return undefined;
      return { name: ev.name, transport: ev.transport, version: ev.version ?? 1 };
    },
    declare: () => ({ version: 1, compatible: true, violations: [], schemaFingerprint: '' }),
    list: () => [],
    addSubscriber: () => {},
    removeSubscriber: () => {},
    updateStats: () => {},
    remove: () => false,
    getTopology: () => ({ nodes: [], edges: [] }),
    validate: () => ({ valid: true }),
    checkSchemaCompat: () => ({ compatible: true, mode: 'backward' as const, violations: [] }),
    size: () => events.length,
    clear: () => {},
  };
}

function makeBundle(overrides: Partial<Omit<FeatureBundle, 'fingerprint'>> = {}): Omit<FeatureBundle, 'fingerprint'> {
  return {
    name: 'chat',
    version: '1.0.0',
    transport: 'signal',
    events: [
      { name: 'ws.chat.message', required: true },
      { name: 'ws.chat.joined', required: true },
    ],
    ...overrides,
  };
}

function createApp(
  bundleRegistry: FeatureBundleRegistry,
  eventRegistry = makeEventRegistry([
    { name: 'ws.chat.message', transport: 'signal' },
    { name: 'ws.chat.joined', transport: 'signal' },
  ]),
) {
  const app = expressLikeApp();
  app.use('/api/feature-bundles', createBundleRoutes({ bundleRegistry, registry: eventRegistry as any }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bundle Routes', () => {
  let bundleRegistry: FeatureBundleRegistry;
  let app: ReturnType<typeof expressLikeApp>;

  beforeEach(() => {
    bundleRegistry = new FeatureBundleRegistry();
    app = createApp(bundleRegistry);
  });

  // ── GET /api/feature-bundles ────────────────────────────────────────────

  describe('GET /api/feature-bundles', () => {
    it('returns empty list when no bundles registered', async () => {
      const res = await request(app).get('/api/feature-bundles');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ bundles: [], total: 0 });
    });

    it('returns all registered bundles', async () => {
      bundleRegistry.register(makeBundle({ name: 'chat' }));
      bundleRegistry.register(makeBundle({ name: 'presence', events: [{ name: 'ws.chat.message', required: true }] }));

      const res = await request(app).get('/api/feature-bundles');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const names = res.body.bundles.map((b: FeatureBundle) => b.name);
      expect(names).toContain('chat');
      expect(names).toContain('presence');
    });

    it('bundles include computed fingerprint', async () => {
      bundleRegistry.register(makeBundle());
      const res = await request(app).get('/api/feature-bundles');
      expect(res.body.bundles[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── GET /api/feature-bundles/:name ─────────────────────────────────────

  describe('GET /api/feature-bundles/:name', () => {
    it('returns the latest bundle version', async () => {
      bundleRegistry.register(makeBundle({ version: '1.0.0' }));
      bundleRegistry.register(makeBundle({ version: '2.0.0' }));

      const res = await request(app).get('/api/feature-bundles/chat');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('chat');
      expect(res.body.version).toBe('2.0.0');
    });

    it('returns 404 for unknown bundle', async () => {
      const res = await request(app).get('/api/feature-bundles/unknown-bundle');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('unknown-bundle');
    });
  });

  // ── GET /api/feature-bundles/:name/:version ─────────────────────────────

  describe('GET /api/feature-bundles/:name/:version', () => {
    it('returns the specific version', async () => {
      bundleRegistry.register(makeBundle({ version: '1.0.0' }));
      bundleRegistry.register(makeBundle({ version: '2.0.0' }));

      const res = await request(app).get('/api/feature-bundles/chat/1.0.0');
      expect(res.status).toBe(200);
      expect(res.body.version).toBe('1.0.0');
    });

    it('returns 404 when version does not exist', async () => {
      bundleRegistry.register(makeBundle({ version: '1.0.0' }));

      const res = await request(app).get('/api/feature-bundles/chat/9.9.9');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('9.9.9');
    });
  });

  // ── GET /api/feature-bundles/by-fingerprint/:fp ─────────────────────────

  describe('GET /api/feature-bundles/by-fingerprint/:fp', () => {
    it('returns the bundle matching the fingerprint', async () => {
      const registered = bundleRegistry.register(makeBundle());

      const res = await request(app).get(`/api/feature-bundles/by-fingerprint/${registered.fingerprint}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('chat');
      expect(res.body.fingerprint).toBe(registered.fingerprint);
    });

    it('returns 404 for unknown fingerprint', async () => {
      const fp = 'a'.repeat(64);
      const res = await request(app).get(`/api/feature-bundles/by-fingerprint/${fp}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain(fp);
    });
  });

  // ── GET /api/feature-bundles/:name/crd-schema ───────────────────────────

  describe('GET /api/feature-bundles/:name/crd-schema', () => {
    it('returns a JSON Schema with required bundle fields', async () => {
      bundleRegistry.register(makeBundle({ name: 'chat' }));

      const res = await request(app).get('/api/feature-bundles/chat/crd-schema');
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('object');
      expect(res.body.required).toEqual(expect.arrayContaining(['name', 'version', 'fingerprint']));
      expect(res.body.properties.name.enum).toEqual(['chat']);
      expect(res.body.properties.fingerprint.minLength).toBe(64);
    });

    it('returns 404 for unknown bundle', async () => {
      const res = await request(app).get('/api/feature-bundles/no-such-bundle/crd-schema');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('no-such-bundle');
    });
  });

  // ── POST /api/feature-bundles/validate ──────────────────────────────────

  describe('POST /api/feature-bundles/validate', () => {
    it('returns valid:true when all required events are registered', async () => {
      const bundle = makeBundle();

      const res = await request(app).post('/api/feature-bundles/validate').send(bundle);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.errors).toEqual([]);
    });

    it('returns valid:false with errors when a required event is missing', async () => {
      // App backed by empty event registry
      const emptyApp = createApp(bundleRegistry, makeEventRegistry([]));
      const bundle = makeBundle();

      const res = await request(emptyApp).post('/api/feature-bundles/validate').send(bundle);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(res.body.errors[0]).toContain('ws.chat.message');
    });

    it('returns 400 when body is missing name', async () => {
      const res = await request(app)
        .post('/api/feature-bundles/validate')
        .send({ events: [] }); // no name
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 400 when body is missing events array', async () => {
      const res = await request(app)
        .post('/api/feature-bundles/validate')
        .send({ name: 'chat' }); // no events
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/events/i);
    });

    it('tolerates a missing fingerprint field in the body', async () => {
      const bundle = { ...makeBundle() }; // no fingerprint
      const res = await request(app).post('/api/feature-bundles/validate').send(bundle);
      expect(res.status).toBe(200);
      expect(typeof res.body.valid).toBe('boolean');
    });

    it('returns 400 for a transport that is not a transport', async () => {
      // `body.transport ?? 'signal'` used to let this through, and
      // validateBundle then checked "kafka" down its 'both' branch.
      const res = await request(app)
        .post('/api/feature-bundles/validate')
        .send({ ...makeBundle(), transport: 'kafka' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/transport/i);
      expect(res.body.error).toContain('signal, durable, both');
    });

    it('still defaults a missing transport to signal', async () => {
      const { transport: _drop, ...noTransport } = makeBundle();
      const res = await request(app).post('/api/feature-bundles/validate').send(noTransport);
      expect(res.status).toBe(200);
    });

    it('returns valid:false, not 200-valid, for an empty member list', async () => {
      const res = await request(app)
        .post('/api/feature-bundles/validate')
        .send({ ...makeBundle(), events: [] });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.errors[0]).toContain('declares no events');
    });
  });
});

// ---------------------------------------------------------------------------
// The registry was constructed empty and never populated, so the whole
// FeatureBundle HTTP surface answered `{bundles: [], total: 0}` in production
// while 18 bundles sat declared in the source. Nothing failed loudly because
// ec-lint-crd reads bundles from the package, not from the server.
// ---------------------------------------------------------------------------

describe('declared bundles are registered at boot', () => {
  it('every bundle in allBundles registers cleanly into a fresh registry', async () => {
    const { FeatureBundleRegistry } = await import('../src/bundles/FeatureBundle.js');
    const { allBundles } = await import('../src/declarations/bundles/index.js');

    const reg = new FeatureBundleRegistry();
    for (const bundle of allBundles) {
      expect(() => reg.register(bundle)).not.toThrow();
    }

    expect(allBundles.length).toBeGreaterThan(0);
    expect(reg.list()).toHaveLength(allBundles.length);
  });
});
