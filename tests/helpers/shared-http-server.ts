// tests/helpers/shared-http-server.ts
//
// Registered as a vitest `setupFiles` entry, so it applies to every test
// file without any of them having to opt in.
//
// THE DEFECT IT FIXES
//
// supertest binds a brand-new ephemeral `http.Server` for every single
// `request(app)` call, and superagent defaults to `agent: false`, which
// means a brand-new TCP connection for every request too. This suite issues
// ~364 of those bind + connect + close cycles in about nine seconds, spread
// over ~30 short-lived worker processes (four at a time). Every completed
// cycle parks a loopback 4-tuple in TIME_WAIT, and macOS draws both
// `listen(0)` ports and `connect()` source ports from the same 49152-65535
// range, so the two allocators end up fighting each other.
//
// The result was a genuine, measured flake: roughly one full-suite run in
// six died with a single connection-level failure on a random test --
// `connect EADDRNOTAVAIL 127.0.0.1:<port>`, `ECONNRESET`, or a truncated
// response surfacing as `Parse Error: Expected HTTP/, RTSP/ or ICE/`. Never
// an assertion failure; never the same test twice; never reproducible when
// a file was run on its own, because on its own it makes a few dozen
// connections instead of competing with three other processes doing the
// same thing.
//
// THE FIX
//
// One listening socket and one keep-alive connection pool per worker
// process instead of one of each per request -- ~364 binds and ~364
// connections become ~30 and ~30.
//
// supertest is intercepted at `Test.prototype.serverAddress`, the one hook
// that runs after the throwaway server is constructed but before anything
// listens on it. Each app listener handed to supertest is registered under
// an id; the id travels on a private request header which the shared server
// strips before dispatching, so the app under test sees a request that is
// byte-for-byte what it saw before.

import http from 'node:http';
import { afterAll } from 'vitest';
import request from 'supertest';

/** Private routing header. Stripped before the app under test sees it. */
const ROUTE_HEADER = 'x-vitest-app-id';

const idsByListener = new WeakMap<http.RequestListener, string>();
const listenersById = new Map<string, http.RequestListener>();
let nextId = 0;

/** Shared across every request in this worker process. */
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });

let sharedServer: http.Server | undefined;
let sharedOrigin = '';

function ensureSharedServer(): string {
  if (sharedOrigin !== '') return sharedOrigin;

  const server = http.createServer((req, res) => {
    const id = req.headers[ROUTE_HEADER];
    // Strip before dispatch: the app under test must not observe it.
    delete req.headers[ROUTE_HEADER];
    const listener = typeof id === 'string' ? listenersById.get(id) : undefined;
    if (listener === undefined) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('shared-http-server: unroutable test request');
      return;
    }
    listener(req, res);
  });

  // A pooled connection must never be closed by the server while the agent
  // still believes it is reusable -- that race is itself a source of
  // ECONNRESET. Node's 5s default would only bite if a file paused that long
  // between requests, but the whole suite runs in ~9s, so these windows are
  // effectively infinite and the race is designed out rather than left to
  // timing. The teardown below is what actually closes these sockets.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 240_000;

  // Hostless `listen(0)` binds synchronously, so `address()` is populated
  // before the 'listening' event fires -- supertest's own `serverAddress`
  // relies on exactly this, so it is not a new assumption. Passing a host
  // would NOT work: `net.Server.listen` routes any host through an async
  // `dns.lookup`, even an IP literal, and `address()` would still be null.
  server.listen(0);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('shared-http-server: listen(0) yielded no TCP address');
  }

  sharedServer = server;
  sharedOrigin = `http://127.0.0.1:${address.port}`;
  return sharedOrigin;
}

type ServerAddress = (app: unknown, path: string) => string;

const TestPrototype = request.Test.prototype as unknown as {
  serverAddress: ServerAddress;
  set(field: string, value: string): unknown;
  agent(agent: http.Agent): unknown;
};

const originalServerAddress = TestPrototype.serverAddress;

TestPrototype.serverAddress = function patchedServerAddress(
  this: typeof TestPrototype,
  app: unknown,
  path: string,
): string {
  const candidate = app as http.Server | undefined;

  // Only intercept the case supertest would otherwise solve with a fresh
  // `listen(0)`: a server it just wrapped around a plain request listener,
  // not yet bound. An already-listening server (a test that started its own)
  // and the HTTP/2 path both fall through untouched.
  const alreadyBound =
    typeof candidate?.address === 'function' ? candidate.address() !== null : true;
  const listener =
    typeof candidate?.listeners === 'function'
      ? (candidate.listeners('request')[0] as http.RequestListener | undefined)
      : undefined;

  if (alreadyBound || listener === undefined) {
    return originalServerAddress.call(this, app, path);
  }

  let id = idsByListener.get(listener);
  if (id === undefined) {
    id = String(nextId++);
    idsByListener.set(listener, id);
    listenersById.set(id, listener);
  }

  this.set(ROUTE_HEADER, id);
  this.agent(keepAliveAgent);

  // `this._server` deliberately stays unset, so supertest's `end()` does not
  // try to close a server that outlives the request.
  return ensureSharedServer() + path;
};

afterAll(async () => {
  keepAliveAgent.destroy();
  listenersById.clear();

  const server = sharedServer;
  sharedServer = undefined;
  sharedOrigin = '';
  if (server === undefined) return;

  server.closeAllConnections?.();
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });
});
