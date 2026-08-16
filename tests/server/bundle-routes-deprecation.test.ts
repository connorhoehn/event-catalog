// tests/server/bundle-routes-deprecation.test.ts
//
// Tests for the PATCH /api/feature-bundles/:name/:version deprecation endpoint.

import { describe, it, expect, beforeEach } from 'vitest';
import { expressLikeApp } from '../helpers/test-app.js';
import request from 'supertest';
import {
  FeatureBundleRegistry,
  type FeatureBundle,
} from '../../src/bundles/FeatureBundle.js';
import { createBundleRoutes } from '../../src/server/bundle-routes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventRegistry() {
  return {
    get: (_name: string) => undefined,
    declare: () => ({ version: 1, compatible: true, violations: [], schemaFingerprint: '' }),
    list: () => [],
    addSubscriber: () => {},
    removeSubscriber: () => {},
    updateStats: () => {},
    remove: () => false,
    getTopology: () => ({ nodes: [], edges: [] }),
    validate: () => ({ valid: true }),
    checkSchemaCompat: () => ({ compatible: true, mode: 'backward' as const, violations: [] }),
    size: () => 0,
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

function createApp(bundleRegistry: FeatureBundleRegistry) {
  const app = expressLikeApp();
  app.use('/api/feature-bundles', createBundleRoutes({ bundleRegistry, registry: makeEventRegistry() as any }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/feature-bundles/:name/:version — deprecation', () => {
  let bundleRegistry: FeatureBundleRegistry;
  let app: ReturnType<typeof expressLikeApp>;

  beforeEach(() => {
    bundleRegistry = new FeatureBundleRegistry();
    app = createApp(bundleRegistry);
  });

  it('marks a bundle as deprecated and GET returns the deprecated field', async () => {
    bundleRegistry.register(makeBundle({ name: 'chat', version: '1.0.0' }));

    const patchRes = await request(app)
      .patch('/api/feature-bundles/chat/1.0.0')
      .send({ deprecated: { since: '2026-05-22' } });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.deprecated).toEqual({ since: '2026-05-22' });

    const getRes = await request(app).get('/api/feature-bundles/chat/1.0.0');
    expect(getRes.status).toBe(200);
    expect(getRes.body.deprecated).toEqual({ since: '2026-05-22' });
  });

  it('marks a bundle as deprecated with a replacement and GET shows replacement', async () => {
    bundleRegistry.register(makeBundle({ name: 'chat', version: '1.0.0' }));
    bundleRegistry.register(makeBundle({ name: 'chat', version: '2.0.0' }));

    const patchRes = await request(app)
      .patch('/api/feature-bundles/chat/1.0.0')
      .send({ deprecated: { since: '2026-05-22', replacement: 'chat@2.0.0' } });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.deprecated).toEqual({ since: '2026-05-22', replacement: 'chat@2.0.0' });

    const getRes = await request(app).get('/api/feature-bundles/chat/1.0.0');
    expect(getRes.status).toBe(200);
    expect(getRes.body.deprecated.replacement).toBe('chat@2.0.0');
  });

  it('fingerprint is stable after deprecation (deprecated is excluded from hash)', async () => {
    const registered = bundleRegistry.register(makeBundle({ name: 'chat', version: '1.0.0' }));
    const originalFingerprint = registered.fingerprint;

    const patchRes = await request(app)
      .patch('/api/feature-bundles/chat/1.0.0')
      .send({ deprecated: { since: '2026-05-22', replacement: 'chat@2.0.0' } });

    expect(patchRes.status).toBe(200);
    // deprecated field is excluded from fingerprint computation — fingerprint must not change
    expect(patchRes.body.fingerprint).toBe(originalFingerprint);

    const getRes = await request(app).get('/api/feature-bundles/chat/1.0.0');
    expect(getRes.body.fingerprint).toBe(originalFingerprint);
  });

  it('returns 404 when bundle name does not exist', async () => {
    const res = await request(app)
      .patch('/api/feature-bundles/nonexistent/1.0.0')
      .send({ deprecated: { since: '2026-05-22' } });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('nonexistent');
  });

  it('returns 404 when version does not exist', async () => {
    bundleRegistry.register(makeBundle({ name: 'chat', version: '1.0.0' }));

    const res = await request(app)
      .patch('/api/feature-bundles/chat/9.9.9')
      .send({ deprecated: { since: '2026-05-22' } });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('9.9.9');
  });

  it('returns 400 when body is missing deprecated.since', async () => {
    bundleRegistry.register(makeBundle());

    const res = await request(app)
      .patch('/api/feature-bundles/chat/1.0.0')
      .send({ deprecated: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/since/i);
  });

  it('returns 400 when body has no deprecated field at all', async () => {
    bundleRegistry.register(makeBundle());

    const res = await request(app)
      .patch('/api/feature-bundles/chat/1.0.0')
      .send({});

    expect(res.status).toBe(400);
  });

  it('deprecated field appears in GET / list', async () => {
    bundleRegistry.register(makeBundle({ name: 'chat', version: '1.0.0' }));
    await request(app)
      .patch('/api/feature-bundles/chat/1.0.0')
      .send({ deprecated: { since: '2026-05-22', replacement: 'chat@2.0.0' } });

    const listRes = await request(app).get('/api/feature-bundles');
    const chatBundle = (listRes.body.bundles as FeatureBundle[]).find((b) => b.name === 'chat' && b.version === '1.0.0');
    expect(chatBundle).toBeDefined();
    expect(chatBundle!.deprecated).toEqual({ since: '2026-05-22', replacement: 'chat@2.0.0' });
  });
});
