// tests/admin-session.test.ts
//
// The admin UI's same-origin sign-in (src/server/admin-session.ts). The
// harness wires it exactly as startServer does: auth routes first, then the
// /admin-api -> /api rewrite, then the bearer gate on /api in front of a
// stand-in route.

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import * as http from 'node:http';
import { expressLikeApp } from './helpers/test-app.js';
import { Router } from '../src/server/http-router.js';
import { createBearerAuthMiddleware } from '../src/server/auth.js';
import { ADMIN_COOKIE_NAME, createAdminSessions } from '../src/server/admin-session.js';

const TOKEN = 'c0ffee0123456789abcdef0123456789';

function build(now?: () => number) {
  const sessions = createAdminSessions({ token: TOKEN, now });
  const app = expressLikeApp();
  app.use('/api', createBearerAuthMiddleware({ token: TOKEN, onReject: () => {} }));
  const api = Router();
  api.get('/events', (_req, res) => { res.status(200).json({ events: ['order.created'] }); });
  app.use('/api', api);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString() || 'null') ?? undefined; } catch { body = undefined; }
      if (sessions.handleAuthRoute(req, res, body)) return;
      sessions.prepareProxy(req);
      app(req, res);
    });
  });
  return server;
}

async function signIn(server: http.Server): Promise<string> {
  const res = await request(server).post('/admin/login').send({ token: TOKEN });
  expect(res.status).toBe(204);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
  return cookie.split(';')[0];
}

describe('admin sign-in and proxy', () => {
  it('login with a wrong token is 401 and sets no cookie', async () => {
    const server = build();
    for (const body of [{ token: 'wrong-token-wrong-token-1234' }, { token: '' }, {}, { token: 7 }]) {
      const res = await request(server).post('/admin/login').send(body);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('login with the right token sets an httpOnly, SameSite=Strict, 12 hour cookie', async () => {
    const res = await request(build()).post('/admin/login').send({ token: TOKEN });
    expect(res.status).toBe(204);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toContain(`${ADMIN_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=43200');
    expect(cookie).not.toContain(TOKEN);
  });

  it('a proxied GET without the cookie is 401', async () => {
    const res = await request(build()).get('/admin-api/events');
    expect(res.status).toBe(401);
  });

  it('a proxied GET with the cookie reaches the catalog route', async () => {
    const server = build();
    const cookie = await signIn(server);
    const res = await request(server).get('/admin-api/events').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: ['order.created'] });
  });

  it('a forged or tampered cookie is 401', async () => {
    const server = build();
    const cookie = await signIn(server);
    const tampered = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');
    expect((await request(server).get('/admin-api/events').set('Cookie', tampered)).status).toBe(401);
    expect((await request(server).get('/admin-api/events').set('Cookie', `${ADMIN_COOKIE_NAME}=abc.def`)).status).toBe(401);
  });

  it('a session expires after 12 hours', async () => {
    let t = 1_000_000;
    const server = build(() => t);
    const cookie = await signIn(server);
    expect((await request(server).get('/admin-api/events').set('Cookie', cookie)).status).toBe(200);
    t += 12 * 60 * 60 * 1000 + 1;
    expect((await request(server).get('/admin-api/events').set('Cookie', cookie)).status).toBe(401);
  });

  it('logout clears the cookie and ends the session', async () => {
    const server = build();
    const cookie = await signIn(server);
    const out = await request(server).post('/admin/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toContain('Max-Age=0');
    expect((await request(server).get('/admin-api/events').set('Cookie', cookie)).status).toBe(401);
  });

  it('does not make /api itself cookie-aware', async () => {
    const server = build();
    const cookie = await signIn(server);
    expect((await request(server).get('/api/events').set('Cookie', cookie)).status).toBe(401);
  });
});
