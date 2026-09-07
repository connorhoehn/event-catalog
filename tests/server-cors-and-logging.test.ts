// tests/server-cors-and-logging.test.ts
//
// Two edge behaviors of the admin server that are only meaningful
// because the API has no authentication at all (see the `authMiddleware`
// hook in src/server/index.ts — nothing wires one, so every mutating
// route is open to whoever can reach the port).
//
// 1. CORS. The server used to default to `corsOrigin: true`, which
//    reflects the caller's `Origin` back as
//    `Access-Control-Allow-Origin`. Combined with no auth, that is the
//    difference between "an attacker needs network access to :3010" and
//    "any web page the operator has open can rewrite the schema every
//    service on the platform validates against": the browser sends the
//    cross-site preflight, the reflected header approves it, and the
//    POST lands. Nothing in this repo needs the headers — the admin UI
//    is same-origin via serveStatic in production and via Vite's /api
//    proxy in development — so the default is now "emit none", with
//    EVENT_CATALOG_CORS_ORIGIN to opt back in.
//
// 2. Startup logging. The boot banner printed REDIS_URL verbatim.
//    `redis://user:password@host:6379` is the documented node-redis
//    form, so any deployment with an authenticated Redis wrote its
//    password into container logs on every start.

import { describe, it, expect } from 'vitest';
import { resolveCorsOrigin, redactUrl } from '../src/server/index.js';

describe('resolveCorsOrigin', () => {
  it('emits no CORS headers when EVENT_CATALOG_CORS_ORIGIN is unset', () => {
    expect(resolveCorsOrigin(undefined)).toBe(false);
    expect(resolveCorsOrigin('')).toBe(false);
    expect(resolveCorsOrigin('   ')).toBe(false);
    expect(resolveCorsOrigin('false')).toBe(false);
  });

  it('pins the header to a configured origin', () => {
    expect(resolveCorsOrigin('https://catalog.internal')).toBe('https://catalog.internal');
    expect(resolveCorsOrigin('  https://catalog.internal  ')).toBe('https://catalog.internal');
  });

  it('restores reflect-everything only on an explicit opt-in', () => {
    expect(resolveCorsOrigin('*')).toBe(true);
    expect(resolveCorsOrigin('true')).toBe(true);
  });
});

describe('redactUrl', () => {
  it('strips a password from a Redis URL', () => {
    const out = redactUrl('redis://default:hunter2@cache.internal:6379');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('cache.internal');
  });

  it('strips a bare username too', () => {
    const out = redactUrl('redis://someuser@cache.internal:6379');
    expect(out).not.toContain('someuser');
  });

  it('leaves a credential-free URL readable', () => {
    expect(redactUrl('redis://localhost:6379')).toBe('redis://localhost:6379');
    expect(redactUrl('http://message-queue:3004')).toBe('http://message-queue:3004');
  });

  it('says nothing about an unparseable value rather than echoing it', () => {
    // A DSN we cannot parse may still carry a secret.
    expect(redactUrl('not a url with a secret in it')).toBe('<unparseable url>');
  });
});
