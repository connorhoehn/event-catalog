// src/server/http-router.ts
//
// Minimal HTTP router + request/response adapters for the admin server.
//
// Why this exists: the platform standard is distributed-core's HTTP
// transport (`AdmissionHttpServer` from `distributed-core/server`), not
// Express. AdmissionHttpServer hands consumers ONE `onRequest(req, res)`
// callback with a pre-buffered body and normalized send helpers — it has
// no route table, because routing is application concern. This module is
// that application concern: `:param` path matching and express-shaped
// `req`/`res` adapters, so the ~45 route handlers in routes.ts /
// bundle-routes.ts kept their bodies verbatim through the Express
// removal. Zero dependencies beyond node:http types.
//
// It deliberately implements ONLY the surface those handlers actually
// use — req.params / req.query / req.body / req.header() / req.on(),
// res.status().json() / res.setHeader() / res.write() / res.end() /
// res.send() / res.flushHeaders() — and nothing more. If a new handler
// needs more, extend the adapter here rather than reaching for a
// framework.

import type * as http from 'node:http';

// ─── Request / response shapes ───────────────────────────────────────────────

export interface RouteRequest {
  /** Uppercase HTTP method. */
  method: string;
  /** Path portion of the URL (no query string). */
  path: string;
  /** `:param` captures from the matched route pattern, URL-decoded. */
  params: Record<string, string>;
  /**
   * Parsed query string. Single values are strings; repeated keys
   * become arrays (matching the express behavior the handlers'
   * `typeof x === 'string'` guards were written against).
   */
  query: Record<string, string | string[]>;
  /** Parsed JSON body (undefined when there was none). */
  body?: unknown;
  /** Case-insensitive single-header lookup. */
  header(name: string): string | undefined;
  /** Delegate to the underlying request's event emitter ('close', …). */
  on(event: string, listener: (...args: unknown[]) => void): void;
  /** Underlying Node request. Use sparingly. */
  raw: http.IncomingMessage;
}

export interface RouteResponse {
  /** Set the status code for the next json()/send()/end(). Chainable. */
  status(code: number): RouteResponse;
  /** Send a JSON response (status defaults to 200 or the last status()). */
  json(body: unknown): void;
  /** Send a plain response body with the current status + headers. */
  send(body: string): void;
  setHeader(name: string, value: string): void;
  /** Stream a chunk (SSE). Implicitly flushes headers on first write. */
  write(chunk: string): boolean;
  end(body?: string): void;
  /** Flush headers without a body — used by the SSE routes. */
  flushHeaders(): void;
  readonly headersSent: boolean;
  /** Underlying Node response. Use sparingly. */
  raw: http.ServerResponse;
}

export type RouteHandler = (req: RouteRequest, res: RouteResponse) => void | Promise<void>;

/**
 * Connect-style middleware — the shape `startServer`'s `authMiddleware`
 * config accepts. Call `next()` to continue into the routers; respond
 * on `res` (and don't call next) to short-circuit.
 */
export type Middleware = (
  req: RouteRequest,
  res: RouteResponse,
  next: (err?: unknown) => void,
) => void;

// Aliases so route modules can keep express-era type names in their
// handler signatures.
export type Request = RouteRequest;
export type Response = RouteResponse;

// ─── Adapters ────────────────────────────────────────────────────────────────

export function parseQuery(rawUrl: string): Record<string, string | string[]> {
  const q = rawUrl.indexOf('?');
  const out: Record<string, string | string[]> = {};
  if (q === -1) return out;
  for (const [key, value] of new URLSearchParams(rawUrl.slice(q + 1))) {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

export function makeRouteRequest(
  nodeReq: http.IncomingMessage,
  body: unknown,
): RouteRequest {
  const rawUrl = nodeReq.url ?? '/';
  const path = rawUrl.split('?')[0];
  return {
    method: (nodeReq.method ?? 'GET').toUpperCase(),
    path,
    params: {},
    query: parseQuery(rawUrl),
    body,
    header(name: string): string | undefined {
      const v = nodeReq.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
    on(event, listener) {
      nodeReq.on(event, listener);
    },
    raw: nodeReq,
  };
}

export function makeRouteResponse(nodeRes: http.ServerResponse): RouteResponse {
  let statusCode = 200;
  const res: RouteResponse = {
    status(code: number): RouteResponse {
      statusCode = code;
      return res;
    },
    json(body: unknown): void {
      if (nodeRes.headersSent) return;
      const payload = JSON.stringify(body);
      nodeRes.setHeader('Content-Type', 'application/json');
      nodeRes.writeHead(statusCode);
      nodeRes.end(payload);
    },
    send(body: string): void {
      if (nodeRes.headersSent) return;
      nodeRes.writeHead(statusCode);
      nodeRes.end(body);
    },
    setHeader(name: string, value: string): void {
      if (!nodeRes.headersSent) nodeRes.setHeader(name, value);
    },
    write(chunk: string): boolean {
      if (!nodeRes.headersSent) nodeRes.writeHead(statusCode);
      return nodeRes.write(chunk);
    },
    end(body?: string): void {
      nodeRes.end(body);
    },
    flushHeaders(): void {
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(statusCode);
        nodeRes.flushHeaders();
      }
    },
    get headersSent(): boolean {
      return nodeRes.headersSent;
    },
    raw: nodeRes,
  };
  return res;
}

// ─── Router ──────────────────────────────────────────────────────────────────

interface RouteEntry {
  method: string;
  /** Pattern split into segments; ':name' segments capture. */
  segments: string[];
  handler: RouteHandler;
}

export class HttpRouter {
  private readonly routes: RouteEntry[] = [];

  get(path: string, handler: RouteHandler): this { return this.add('GET', path, handler); }
  post(path: string, handler: RouteHandler): this { return this.add('POST', path, handler); }
  put(path: string, handler: RouteHandler): this { return this.add('PUT', path, handler); }
  patch(path: string, handler: RouteHandler): this { return this.add('PATCH', path, handler); }
  delete(path: string, handler: RouteHandler): this { return this.add('DELETE', path, handler); }

  private add(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: splitPath(path), handler });
    return this;
  }

  /**
   * Dispatch `req` against the route table using `pathname` (the path
   * AFTER any mount prefix has been stripped — '' or '/' for the mount
   * root). Returns true when a route matched (whether or not its handler
   * has responded yet), false when nothing matched so the caller can
   * fall through. Handler errors send a 500 unless headers are already
   * out (mid-SSE), and never propagate.
   */
  async handle(req: RouteRequest, res: RouteResponse, pathname: string): Promise<boolean> {
    const incoming = splitPath(pathname);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchSegments(route.segments, incoming);
      if (params === null) continue;
      req.params = params;
      try {
        await route.handler(req, res);
      } catch (err) {
        console.warn(
          `[http-router] handler error on ${req.method} ${req.path}:`,
          err instanceof Error ? err.message : String(err),
        );
        if (!res.headersSent) {
          res.status(500).json({ error: 'InternalServerError' });
        }
      }
      return true;
    }
    return false;
  }
}

/** Express-style factory so route modules read `const router = Router()`. */
export function Router(): HttpRouter {
  return new HttpRouter();
}

function splitPath(path: string): string[] {
  return path.split('/').filter(s => s.length > 0);
}

/** Match pattern segments against incoming segments; null = no match. */
function matchSegments(
  pattern: string[],
  incoming: string[],
): Record<string, string> | null {
  if (pattern.length !== incoming.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(':')) {
      try {
        params[p.slice(1)] = decodeURIComponent(incoming[i]);
      } catch {
        params[p.slice(1)] = incoming[i];
      }
    } else if (p !== incoming[i]) {
      return null;
    }
  }
  return params;
}

// ─── Mount / dispatch helpers ────────────────────────────────────────────────

export type Mount = [prefix: string, router: HttpRouter];

/**
 * Strip `prefix` off `path`. Returns the sub-path ('/' for an exact
 * prefix hit) or null when `path` isn't under `prefix`. '' or '/' as
 * prefix matches everything.
 */
export function stripPrefix(path: string, prefix: string): string | null {
  if (prefix === '' || prefix === '/') return path;
  if (path === prefix) return '/';
  if (path.startsWith(prefix + '/')) return path.slice(prefix.length);
  return null;
}

/**
 * Dispatch a prepared req/res pair across mounts in order (longest
 * prefix should be listed first when mounts nest). Returns true when
 * some router handled the request.
 */
export async function dispatchMounts(
  req: RouteRequest,
  res: RouteResponse,
  mounts: Mount[],
): Promise<boolean> {
  for (const [prefix, router] of mounts) {
    const sub = stripPrefix(req.path, prefix);
    if (sub === null) continue;
    if (await router.handle(req, res, sub)) return true;
  }
  return false;
}

/**
 * Build a plain `http.RequestListener` over a set of mounts — buffers +
 * JSON-parses the body itself. This is the unit-test harness (supertest
 * accepts a listener directly); production traffic instead arrives
 * through distributed-core's AdmissionHttpServer, which does its own
 * bounded body read before `startServer`'s onRequest builds the same
 * req/res adapters.
 */
export function createRequestListener(...mounts: Mount[]): http.RequestListener {
  return (nodeReq, nodeRes) => {
    const chunks: Buffer[] = [];
    nodeReq.on('data', (c: Buffer) => chunks.push(c));
    nodeReq.on('end', () => {
      void (async () => {
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
        const req = makeRouteRequest(nodeReq, body);
        const res = makeRouteResponse(nodeRes);
        const handled = await dispatchMounts(req, res, mounts);
        if (!handled && !nodeRes.headersSent) {
          nodeRes.writeHead(404, { 'Content-Type': 'application/json' });
          nodeRes.end(JSON.stringify({ error: 'NotFound', path: req.path }));
        }
      })();
    });
  };
}
