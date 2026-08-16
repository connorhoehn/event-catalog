// tests/helpers/test-app.ts
//
// Express-shaped test harness over src/server/http-router.ts, introduced
// when the server moved from Express onto distributed-core's
// AdmissionHttpServer. Keeps the `const app = expressLikeApp();
// app.use('/api', createRoutes(deps))` assembly the suites were written
// against, and returns a plain request listener that supertest accepts
// directly. Body buffering happens only for POST/PUT/PATCH so suites
// that invoke `app(syntheticReq, syntheticRes)` with a bare EventEmitter
// (the SSE tests) dispatch immediately instead of waiting for an 'end'
// that never fires.

import type * as http from 'node:http';
import {
  HttpRouter,
  Router,
  dispatchMounts,
  makeRouteRequest,
  makeRouteResponse,
  type Middleware,
  type Mount,
  type RouteHandler,
} from '../../src/server/http-router.js';

export interface TestApp {
  (req: http.IncomingMessage, res: http.ServerResponse): void;
  /** Mount a router at a prefix, a router at the root, or a middleware gate at a prefix. */
  use(prefix: string, thing: HttpRouter | Middleware): void;
  use(router: HttpRouter): void;
  /** Register a GET route directly at the root (mirrors `app.get`). */
  get(path: string, handler: RouteHandler): void;
}

export function expressLikeApp(): TestApp {
  const mounts: Mount[] = [];
  const middlewares: Array<[prefix: string, mw: Middleware]> = [];
  const rootRouter = Router();
  let rootMounted = false;
  const ensureRoot = (): void => {
    if (!rootMounted) {
      mounts.push(['', rootRouter]);
      rootMounted = true;
    }
  };

  const dispatch = async (
    nodeReq: http.IncomingMessage,
    nodeRes: http.ServerResponse,
    body: unknown,
  ): Promise<void> => {
    const req = makeRouteRequest(nodeReq, body);
    const res = makeRouteResponse(nodeRes);

    for (const [prefix, mw] of middlewares) {
      if (!(req.path === prefix || req.path.startsWith(prefix + '/'))) continue;
      const admitted = await new Promise<boolean>(resolve => {
        let settled = false;
        const settle = (ok: boolean): void => {
          if (!settled) { settled = true; resolve(ok); }
        };
        // Middleware that responds instead of calling next() rejects.
        nodeRes.on?.('finish', () => settle(false));
        nodeRes.on?.('close', () => settle(false));
        try {
          mw(req, res, (err?: unknown) => settle(err === undefined || err === null));
        } catch {
          settle(false);
        }
      });
      if (!admitted) return;
    }

    const handled = await dispatchMounts(req, res, mounts);
    if (!handled && !res.headersSent) {
      res.status(404).json({ error: 'NotFound', path: req.path });
    }
  };

  const listener = ((nodeReq: http.IncomingMessage, nodeRes: http.ServerResponse): void => {
    const method = (nodeReq.method ?? 'GET').toUpperCase();
    const contentType = String(nodeReq.headers?.['content-type'] ?? '');
    // Buffer a body when one is plausibly present (JSON content-type, or a
    // body-bearing method). Bare synthetic GETs (the SSE suites drive the
    // listener with an EventEmitter that never emits 'end') dispatch
    // immediately. Express parsed JSON bodies on ANY method — including the
    // GET /schema/check contract — so content-type wins over method here.
    if (!['POST', 'PUT', 'PATCH'].includes(method) && !contentType.includes('application/json')) {
      void dispatch(nodeReq, nodeRes, undefined);
      return;
    }
    const chunks: Buffer[] = [];
    nodeReq.on('data', (c: Buffer) => chunks.push(c));
    nodeReq.on('end', () => {
      let body: unknown;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          nodeRes.writeHead(400, { 'Content-Type': 'application/json' });
          nodeRes.end(JSON.stringify({ error: 'InvalidJson' }));
          return;
        }
      }
      void dispatch(nodeReq, nodeRes, body);
    });
  }) as TestApp;

  listener.use = ((prefixOrRouter: string | HttpRouter, thing?: HttpRouter | Middleware): void => {
    if (typeof prefixOrRouter !== 'string') {
      mounts.push(['', prefixOrRouter]);
      return;
    }
    if (thing instanceof HttpRouter) {
      mounts.push([prefixOrRouter, thing]);
    } else if (thing) {
      middlewares.push([prefixOrRouter, thing]);
    }
  }) as TestApp['use'];

  listener.get = (path: string, handler: RouteHandler): void => {
    ensureRoot();
    rootRouter.get(path, handler);
  };

  return listener;
}
