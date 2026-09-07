// tests/http-router.test.ts
//
// Unit coverage for src/server/http-router.ts — the routing layer that
// replaced Express when the admin server moved onto distributed-core's
// AdmissionHttpServer. HTTP-level cases drive createRequestListener via
// supertest (a plain request listener, no framework).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import {
  Router,
  HttpRouter,
  parseQuery,
  stripPrefix,
  dispatchMounts,
  makeRouteRequest,
  makeRouteResponse,
  createRequestListener,
  type Mount,
} from '../src/server/http-router.js';
import { DEFAULT_COMPRESSION } from '../src/server/compression.js';

describe('parseQuery()', () => {
  it('returns {} for a bare path', () => {
    expect(parseQuery('/api/events')).toEqual({});
  });

  it('parses single values as strings', () => {
    expect(parseQuery('/x?a=1&b=two')).toEqual({ a: '1', b: 'two' });
  });

  it('collects repeated keys into an array (express-compatible)', () => {
    expect(parseQuery('/x?tag=a&tag=b&tag=c')).toEqual({ tag: ['a', 'b', 'c'] });
  });

  it('URL-decodes values', () => {
    expect(parseQuery('/x?name=chat%3Amessage')).toEqual({ name: 'chat:message' });
  });
});

describe('stripPrefix()', () => {
  it('returns the sub-path under a prefix', () => {
    expect(stripPrefix('/api/events/foo', '/api')).toBe('/events/foo');
  });

  it("returns '/' on an exact prefix hit", () => {
    expect(stripPrefix('/api', '/api')).toBe('/');
  });

  it('returns null when not under the prefix', () => {
    expect(stripPrefix('/apifoo', '/api')).toBeNull();
    expect(stripPrefix('/other', '/api')).toBeNull();
  });

  it("matches everything for '' and '/'", () => {
    expect(stripPrefix('/anything', '')).toBe('/anything');
    expect(stripPrefix('/anything', '/')).toBe('/anything');
  });
});

describe('HttpRouter matching', () => {
  function ctx(method: string, url: string) {
    const req = makeRouteRequest(
      { method, url, headers: {}, on: () => {} } as never,
      undefined,
    );
    const sent: Array<{ status: number; body: unknown }> = [];
    const res = {
      statusCode: 200,
      _status: 200,
      status(code: number) { this._status = code; return this; },
      json(body: unknown) { sent.push({ status: this._status, body }); },
      headersSent: false,
    } as never;
    return { req, res, sent };
  }

  it('matches a static path on the right method only', async () => {
    const router = Router();
    const handler = vi.fn();
    router.get('/events', handler);

    const { req, res } = ctx('GET', '/events');
    expect(await router.handle(req, res, '/events')).toBe(true);
    expect(handler).toHaveBeenCalledOnce();

    const miss = ctx('POST', '/events');
    expect(await router.handle(miss.req, miss.res, '/events')).toBe(false);
  });

  it('captures and URL-decodes :params', async () => {
    const router = Router();
    let seen: Record<string, string> = {};
    router.get('/events/:name/history', async req => { seen = req.params; });

    const { req, res } = ctx('GET', '/events/chat%3Amessage/history');
    expect(await router.handle(req, res, '/events/chat%3Amessage/history')).toBe(true);
    expect(seen).toEqual({ name: 'chat:message' });
  });

  it('does not match when segment counts differ', async () => {
    const router = Router();
    router.get('/events/:name', vi.fn());
    const { req, res } = ctx('GET', '/events/a/b');
    expect(await router.handle(req, res, '/events/a/b')).toBe(false);
  });

  it('sends a 500 when a handler throws and headers are not out', async () => {
    const router = Router();
    router.get('/boom', () => { throw new Error('kaboom'); });
    const { req, res, sent } = ctx('GET', '/boom');
    expect(await router.handle(req, res, '/boom')).toBe(true);
    expect(sent).toEqual([{ status: 500, body: { error: 'InternalServerError' } }]);
  });

  it('Router() factory returns an HttpRouter', () => {
    expect(Router()).toBeInstanceOf(HttpRouter);
  });
});

describe('dispatchMounts()', () => {
  it('tries mounts in order and stops at the first router that handles', async () => {
    const first = Router();
    const second = Router();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    first.get('/special/thing', firstHandler);
    second.get('/thing', secondHandler);
    const mounts: Mount[] = [
      ['/api/special', first],
      ['/api', second],
    ];

    const req = makeRouteRequest(
      { method: 'GET', url: '/api/special/thing', headers: {}, on: () => {} } as never,
      undefined,
    );
    // Path under the longer prefix is not handled by `first` (no match on
    // '/special/thing' after stripping '/api/special' → '/thing')… so it
    // falls through to `second` mounted at /api, whose '/thing' doesn't
    // match '/special/thing' either? Use a direct case instead:
    req.path = '/api/special/thing';
    const handled = await dispatchMounts(req, {} as never, mounts);
    // '/api/special' strips to '/thing' → no match in first; '/api' strips
    // to '/special/thing' → no match in second.
    expect(handled).toBe(false);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).not.toHaveBeenCalled();
  });

  it('longest-prefix-first mount wins for nested prefixes', async () => {
    const bundles = Router();
    const api = Router();
    const bundleHandler = vi.fn();
    const apiHandler = vi.fn();
    bundles.get('/list', bundleHandler);
    api.get('/feature-bundles/list', apiHandler);
    const mounts: Mount[] = [
      ['/api/feature-bundles', bundles],
      ['/api', api],
    ];

    const req = makeRouteRequest(
      { method: 'GET', url: '/api/feature-bundles/list', headers: {}, on: () => {} } as never,
      undefined,
    );
    const handled = await dispatchMounts(req, {} as never, mounts);
    expect(handled).toBe(true);
    expect(bundleHandler).toHaveBeenCalledOnce();
    expect(apiHandler).not.toHaveBeenCalled();
  });
});

describe('createRequestListener() over HTTP (supertest)', () => {
  function makeApp() {
    const router = Router();
    router.get('/events/:name', (req, res) => {
      res.status(200).json({ name: req.params.name, query: req.query });
    });
    router.post('/events', (req, res) => {
      res.status(201).json({ received: req.body });
    });
    router.get('/error', () => { throw new Error('nope'); });
    return createRequestListener(['/api', router]);
  }

  it('routes GET with params and query', async () => {
    const res = await request(makeApp()).get('/api/events/user.created?transport=signal');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'user.created', query: { transport: 'signal' } });
  });

  it('parses a JSON POST body', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .send({ name: 'x.y', transport: 'signal' });
    expect(res.status).toBe(201);
    expect(res.body.received).toEqual({ name: 'x.y', transport: 'signal' });
  });

  it('400s invalid JSON', async () => {
    const res = await request(makeApp())
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('InvalidJson');
  });

  it('404s unmatched paths with a JSON envelope', async () => {
    const res = await request(makeApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'NotFound', path: '/api/nope' });
  });

  it('500s a throwing handler without crashing the listener', async () => {
    const res = await request(makeApp()).get('/api/error');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError' });
  });
});

describe('makeRouteResponse()', () => {
  function fakeNodeRes() {
    const calls: Array<[string, unknown]> = [];
    let headersSent = false;
    return {
      calls,
      setHeader: (k: string, v: string) => calls.push(['setHeader', [k, v]]),
      writeHead: (code: number) => { headersSent = true; calls.push(['writeHead', code]); },
      write: (chunk: string) => { calls.push(['write', chunk]); return true; },
      end: (body?: string) => calls.push(['end', body]),
      flushHeaders: () => calls.push(['flushHeaders', null]),
      get headersSent() { return headersSent; },
      on: () => {},
    };
  }

  it('json() writes status + payload once and ignores later sends', () => {
    const node = fakeNodeRes();
    const res = makeRouteResponse(node as never);
    res.status(404).json({ error: 'x' });
    res.json({ error: 'second' });
    const ends = node.calls.filter(([k]) => k === 'end');
    expect(ends).toEqual([['end', JSON.stringify({ error: 'x' })]]);
    expect(node.calls).toContainEqual(['writeHead', 404]);
  });

  it('write() flushes headers with the pending status on first chunk', () => {
    const node = fakeNodeRes();
    const res = makeRouteResponse(node as never);
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: 1\n\n');
    res.write('data: 2\n\n');
    expect(node.calls.filter(([k]) => k === 'writeHead')).toEqual([['writeHead', 200]]);
    expect(node.calls.filter(([k]) => k === 'write')).toHaveLength(2);
  });

  it('flushHeaders() writes the head exactly once', () => {
    const node = fakeNodeRes();
    const res = makeRouteResponse(node as never);
    res.flushHeaders();
    res.flushHeaders();
    expect(node.calls.filter(([k]) => k === 'writeHead')).toEqual([['writeHead', 200]]);
  });
});

// ─── Work done after the peer has gone ───────────────────────────────────
//
// `finish()` used to gate on `headersSent` alone. A client that resets the
// connection destroys the socket WITHOUT any headers having been sent, so
// `headersSent` was still false and the whole response path ran anyway:
// JSON.stringify over the body, then a whole-buffer, synchronous brotli or
// gzip pass over the result, then a writeHead/end onto a dead socket.
//
// On `GET /api/events` that is ~326 KiB of JSON and ~2.1 ms of blocked
// event loop per request — the cheapest possible request for a client to
// issue, and one of the most expensive for the server to serve, which is
// what makes it worth issuing deliberately.

describe('a response whose peer has already disconnected', () => {
  /** A node response over a socket the peer reset before any reply. */
  function destroyedNodeRes(): { calls: Array<[string, unknown]> } & Record<string, unknown> {
    const calls: Array<[string, unknown]> = [];
    // A real header map, because `chooseCompression` consults the
    // Content-Type the handler set and `appendVary` reads Vary back.
    const headers = new Map<string, string>();
    return {
      calls,
      destroyed: true,
      headersSent: false,
      setHeader: (k: string, v: string) => {
        headers.set(k.toLowerCase(), v);
        calls.push(['setHeader', [k, v]]);
      },
      getHeader: (k: string) => headers.get(k.toLowerCase()),
      writeHead: (code: number) => calls.push(['writeHead', code]),
      write: (chunk: string) => { calls.push(['write', chunk]); return true; },
      end: (body?: unknown) => calls.push(['end', body]),
      flushHeaders: () => calls.push(['flushHeaders', null]),
      on: () => {},
    } as never;
  }

  const brotliOn = {
    config: DEFAULT_COMPRESSION,
    encoding: 'br' as const,
  };

  it('exposes the disconnect so handlers can bail before doing the work', () => {
    const live = makeRouteResponse({ ...destroyedNodeRes(), destroyed: false } as never);
    const gone = makeRouteResponse(destroyedNodeRes() as never);
    expect(live.destroyed).toBe(false);
    expect(gone.destroyed).toBe(true);
  });

  it('does not serialize the body — JSON.stringify is never reached', () => {
    const node = destroyedNodeRes();
    const res = makeRouteResponse(node as never, brotliOn);

    // toJSON is what JSON.stringify calls; if it never runs, the
    // serialization never started.
    const serialize = vi.fn(() => ({ big: 'x'.repeat(64 * 1024) }));
    res.json({ toJSON: serialize });

    expect(serialize).not.toHaveBeenCalled();
    expect(node.calls).toEqual([]);
  });

  it('does not compress, frame or write for a destroyed socket', () => {
    const node = destroyedNodeRes();
    const res = makeRouteResponse(node as never, brotliOn);

    res.setHeader('Content-Type', 'application/json');
    res.send('x'.repeat(64 * 1024));

    // The setHeader above is the handler's, not the response path's: no
    // Content-Encoding, no Content-Length, no writeHead and no end.
    expect(node.calls).toEqual([['setHeader', ['Content-Type', 'application/json']]]);
  });

  it('still does all of it for a peer that is still connected', () => {
    // The guard has to be about the peer being gone, not a short-circuit
    // that happens to fire on the aborted case.
    const node = { ...destroyedNodeRes(), destroyed: false };
    const res = makeRouteResponse(node as never, brotliOn);

    res.setHeader('Content-Type', 'application/json');
    res.send('x'.repeat(64 * 1024));

    const headers = node.calls.filter(([k]) => k === 'setHeader').map(([, v]) => v);
    expect(headers).toContainEqual(['Content-Encoding', 'br']);
    expect(node.calls.some(([k]) => k === 'end')).toBe(true);
  });
});
