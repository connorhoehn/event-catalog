// tests/auth-bearer.test.ts
//
// The optional shared-secret gate on the admin API (src/server/auth.ts).
//
// THE ONE THAT MATTERS MOST is the first block: with no token configured
// there is no middleware, and every mutating route answers exactly as it
// did before this module existed. ~20 endpoints (declare, delete,
// deprecate, subscriber add/remove, manifest put/delete, DLQ
// replay/clear) are open by design on a private network, every producer
// syncs its declarations through them at boot, and an upgrade that
// quietly started 401-ing those would be a platform-wide outage. Auth
// here is a capability the operator switches on, never a default.
//
// The rest covers what happens once it IS on: correct token passes, an
// absent / malformed / wrong one gets an indistinguishable 401, GETs are
// challenged too (dead-letter payloads, schemas and the SSE streams are
// other services' data; the admin UI sits behind a proxy that injects the
// token), the health routes stay open, and the constant-time compare
// survives a length mismatch instead of throwing out of the middleware.
//
// "Off by default" now means local development only: startServer refuses
// to boot without a token in production or with MQ_SERVICE_AUTH_SECRET set
// (tests/server-production-auth.test.ts, tests/dlq-auth-and-replay-validation.test.ts).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { Router, type Middleware } from '../src/server/http-router.js';
import {
  MIN_AUTH_TOKEN_LENGTH,
  OPEN_HEALTH_PATHS,
  createBearerAuthMiddleware,
  extractBearerToken,
  requiresAuth,
  resolveAuthMiddleware,
  resolveAuthToken,
  secretsMatch,
} from '../src/server/auth.js';
import { resolveServerConfig } from '../src/cli/config.js';

const TOKEN = 'c0ffee0123456789abcdef0123456789';

/** Stand-ins for the real mutating surface, one per shape in routes/. */
const MUTATING_ROUTES: Array<[method: 'post' | 'put' | 'patch' | 'delete', path: string]> = [
  ['post', '/api/events'],
  ['delete', '/api/events/order.created'],
  ['post', '/api/events/order.created/deprecate'],
  ['post', '/api/events/order.created/subscribers'],
  ['delete', '/api/events/order.created/subscribers/billing'],
  ['put', '/api/manifests/billing'],
  ['delete', '/api/manifests/billing'],
  ['post', '/api/dlq/replay'],
  ['delete', '/api/dlq'],
  ['patch', '/api/events/order.created'],
];

/**
 * The admin server's request pipeline in miniature: an optional gate
 * mounted at '/api' ahead of the routers, plus the root-level /health and
 * /metrics the real server serves outside that prefix.
 */
function buildApp(auth: Middleware | undefined): ReturnType<typeof expressLikeApp> {
  const app = expressLikeApp();
  if (auth) app.use('/api', auth);

  const api = Router();
  for (const [method, path] of MUTATING_ROUTES) {
    // Literal paths — the gate is method+prefix based, so the route table
    // only has to exist for a 200 to be distinguishable from a 401.
    api[method](path.slice('/api'.length), (_req, res) => {
      res.status(200).json({ mutated: true });
    });
  }
  api.get('/events', (_req, res) => { res.status(200).json({ events: [] }); });
  api.get('/flow', (_req, res) => { res.status(200).json({ stream: 'sse' }); });
  api.get('/health', (_req, res) => { res.status(200).json({ status: 'healthy' }); });
  app.use('/api', api);

  app.get('/health', (_req, res) => { res.status(200).json({ status: 'healthy' }); });
  app.get('/metrics', (_req, res) => { res.status(200).send('catalog_up 1'); });
  return app;
}

// ---------------------------------------------------------------------------
// OFF BY DEFAULT — the critical guarantee
// ---------------------------------------------------------------------------

describe('off by default', () => {
  it('resolves no token from an environment that does not set one', () => {
    const resolved = resolveServerConfig({ REDIS_URL: 'redis://localhost:6379' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.config.authToken).toBeUndefined();
  });

  it('installs NO middleware when nothing is configured', () => {
    // This is the exact call startServer makes. `undefined` here is the
    // proof: the `if (authMiddleware)` branch in the request path is
    // never entered, so there is no code between a request and the
    // routers.
    expect(resolveAuthMiddleware(undefined, undefined)).toBeUndefined();
  });

  it('leaves every mutating route reachable with no credential', async () => {
    const resolved = resolveServerConfig({ REDIS_URL: 'redis://localhost:6379' });
    if (!resolved.ok) throw new Error('config should resolve');
    const app = buildApp(resolveAuthMiddleware(undefined, resolved.config.authToken));

    for (const [method, path] of MUTATING_ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 200`);
      expect(res.body).toEqual({ mutated: true });
    }
  });

  it('leaves reads and root routes reachable with no credential', async () => {
    const app = buildApp(resolveAuthMiddleware(undefined, undefined));
    expect((await request(app).get('/api/events')).status).toBe(200);
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/metrics')).status).toBe(200);
  });

  it('prefers an explicitly supplied middleware over the env token', () => {
    const explicit: Middleware = (_req, _res, next) => { next(); };
    expect(resolveAuthMiddleware(explicit, TOKEN)).toBe(explicit);
  });
});

// ---------------------------------------------------------------------------
// ON — the happy path and the rejections
// ---------------------------------------------------------------------------

describe('with a token configured', () => {
  const app = buildApp(resolveAuthMiddleware(undefined, TOKEN));

  it('admits a mutating request carrying the correct token', async () => {
    for (const [method, path] of MUTATING_ROUTES) {
      const res = await request(app)[method](path)
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({});
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 200`);
    }
  });

  it('rejects every mutating request with no token at all', async () => {
    for (const [method, path] of MUTATING_ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 401`);
    }
  });

  it.each([
    ['wrong token', `Bearer ${'d'.repeat(32)}`],
    ['right token, wrong scheme', `Basic ${TOKEN}`],
    ['scheme with no token', 'Bearer'],
    ['scheme with only whitespace', 'Bearer    '],
    ['bare token, no scheme', TOKEN],
    ['empty header', ''],
    ['token with a trailing character', `Bearer ${TOKEN}x`],
    ['prefix of the token', `Bearer ${TOKEN.slice(0, 8)}`],
  ])('rejects %s', async (_label, header) => {
    const res = await request(app).post('/api/events')
      .set('Authorization', header)
      .send({});
    expect(res.status).toBe(401);
  });

  it('gives an identical body for absent, malformed and wrong tokens', async () => {
    const bodies = await Promise.all([
      request(app).post('/api/events').send({}),
      request(app).post('/api/events').set('Authorization', 'Bearer').send({}),
      request(app).post('/api/events').set('Authorization', 'Bearer nope-nope-nope').send({}),
    ]);
    const rendered = bodies.map(r => JSON.stringify(r.body));
    expect(new Set(rendered).size).toBe(1);
    // Minimal body — nothing about the scheme, the length, or how close
    // the presented value was.
    expect(bodies[0].body).toEqual({ error: 'Unauthorized' });
  });

  it('challenges GETs too — reads and the SSE streams need the token', async () => {
    expect((await request(app).get('/api/events')).status).toBe(401);
    expect((await request(app).get('/api/flow')).status).toBe(401);
    expect((await request(app).head('/api/events')).status).toBe(401);
    expect((await request(app).get('/api/events').set('Authorization', `Bearer ${TOKEN}`)).status)
      .toBe(200);
    expect((await request(app).get('/api/flow').set('Authorization', `Bearer ${TOKEN}`)).status)
      .toBe(200);
  });

  it('leaves the /api health route open to GET', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('leaves /health and /metrics reachable — probes and scrapers cannot be locked out', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('catalog_up 1');
  });

  it('advertises the scheme on a challenge without leaking anything else', async () => {
    const res = await request(app).post('/api/events').send({});
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe('rejection logging', () => {
  it('records method, path and source but never the presented token', async () => {
    const lines: string[] = [];
    const app = buildApp(createBearerAuthMiddleware({
      token: TOKEN,
      onReject: line => lines.push(line),
    }));

    await request(app).delete('/api/events/order.created')
      .set('Authorization', 'Bearer super-secret-wrong-value');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('DELETE');
    expect(lines[0]).toContain('/api/events/order.created');
    expect(lines[0]).toMatch(/from \S+/);
    expect(lines[0]).not.toContain('super-secret-wrong-value');
    expect(lines[0]).not.toContain(TOKEN);
  });

  it('does not log admitted requests', async () => {
    const lines: string[] = [];
    const app = buildApp(createBearerAuthMiddleware({
      token: TOKEN,
      onReject: line => lines.push(line),
    }));
    await request(app).post('/api/events').set('Authorization', `Bearer ${TOKEN}`).send({});
    await request(app).get('/api/events').set('Authorization', `Bearer ${TOKEN}`);
    await request(app).get('/api/health');
    expect(lines).toEqual([]);
  });

  it('keeps a forged newline in the path from faking a second log line', async () => {
    const lines: string[] = [];
    const mw = createBearerAuthMiddleware({ token: TOKEN, onReject: line => lines.push(line) });
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mw(
      {
        method: 'POST',
        path: '/api/events/\n[auth] admitted everything',
        params: {},
        query: {},
        header: () => undefined,
        on: () => {},
        raw: {} as never,
      },
      res as never,
      () => { throw new Error('must not admit'); },
    );
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain('?[auth] admitted everything');
  });

  it('defaults to console.warn when no sink is injected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(createBearerAuthMiddleware({ token: TOKEN }));
    await request(app).post('/api/events').send({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('[auth] rejected');
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe('secretsMatch', () => {
  it('accepts an exact match', () => {
    expect(secretsMatch(TOKEN, TOKEN)).toBe(true);
  });

  it('returns false rather than throwing on mismatched lengths', () => {
    // timingSafeEqual throws on unequal-length buffers. Both sides are
    // hashed to a 32-byte digest first, so this is a plain false — and a
    // timing observer learns nothing about the secret's length.
    expect(() => secretsMatch('x', TOKEN)).not.toThrow();
    expect(secretsMatch('x', TOKEN)).toBe(false);
    expect(secretsMatch('', TOKEN)).toBe(false);
    expect(secretsMatch(`${TOKEN}${'y'.repeat(4096)}`, TOKEN)).toBe(false);
    expect(secretsMatch(TOKEN, '')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });

  it('is case- and whitespace-sensitive', () => {
    expect(secretsMatch(TOKEN.toUpperCase(), TOKEN)).toBe(false);
    expect(secretsMatch(` ${TOKEN}`, TOKEN)).toBe(false);
  });

  it('handles non-ASCII without throwing', () => {
    expect(secretsMatch('tökén-ünïcodé-value', 'tökén-ünïcodé-value')).toBe(true);
    expect(secretsMatch('tökén', TOKEN)).toBe(false);
  });
});

describe('extractBearerToken', () => {
  it('reads the token out of a well-formed header, scheme case-insensitively', () => {
    expect(extractBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`BEARER\t${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`  Bearer ${TOKEN}  `)).toBe(TOKEN);
  });

  it('returns undefined for anything else', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('')).toBeUndefined();
    expect(extractBearerToken('Bearer')).toBeUndefined();
    expect(extractBearerToken('Bearer ')).toBeUndefined();
    expect(extractBearerToken(`Basic ${TOKEN}`)).toBeUndefined();
    expect(extractBearerToken(TOKEN)).toBeUndefined();
    expect(extractBearerToken(`Bearer ${TOKEN} extra`)).toBeUndefined();
  });
});

describe('requiresAuth — the one place the gated set is decided', () => {
  it('gates every method except the CORS preflight, reads included', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(requiresAuth(method, '/api/events')).toBe(true);
      expect(requiresAuth(method.toLowerCase(), '/api/transports/durable/dlq')).toBe(true);
    }
    expect(requiresAuth('OPTIONS', '/api/events')).toBe(false);
  });

  it('leaves the health routes open to GET and HEAD only', () => {
    for (const path of OPEN_HEALTH_PATHS) {
      for (const method of ['GET', 'HEAD']) {
        expect(requiresAuth(method, path)).toBe(false);
        expect(requiresAuth(method, `${path}/`)).toBe(false);
        expect(requiresAuth(method, `${path}?verbose=1`)).toBe(false);
      }
      expect(requiresAuth('POST', path)).toBe(true);
    }
  });

  it('does not open the registry health or metrics snapshot under /api', () => {
    expect(requiresAuth('GET', '/api/health/registry')).toBe(true);
    expect(requiresAuth('GET', '/api/metrics')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token shape at boot
// ---------------------------------------------------------------------------

describe('resolveAuthToken', () => {
  it('treats an unset variable as "auth off"', () => {
    expect(resolveAuthToken(undefined)).toEqual({ ok: true, token: undefined });
  });

  it('treats a set-but-empty variable as a boot ERROR, not as "off"', () => {
    // `EVENT_CATALOG_AUTH_TOKEN=${CATALOG_TOKEN}` with an unset
    // CATALOG_TOKEN must not silently boot an open server the operator
    // believes is authenticated.
    for (const raw of ['', '   ', '\n', '\t']) {
      const result = resolveAuthToken(raw);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a token too short to be worth guessing at', () => {
    const result = resolveAuthToken('changeme');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(MIN_AUTH_TOKEN_LENGTH));
  });

  it('rejects a token that would not survive an HTTP header', () => {
    expect(resolveAuthToken('has a space in the middle').ok).toBe(false);
    expect(resolveAuthToken('has\ttab-in-the-middle-here').ok).toBe(false);
  });

  it('accepts a real secret, trimming the newline a $(cat file) leaves behind', () => {
    expect(resolveAuthToken(`  ${TOKEN}\n`)).toEqual({ ok: true, token: TOKEN });
  });

  it('never echoes the value in an error', () => {
    const secretish = 'short1';
    const result = resolveAuthToken(secretish);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(secretish);
  });
});
