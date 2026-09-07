// tests/security-sse-limits.test.ts
//
// Concurrency + lifecycle bounds on the SSE surfaces (/api/flow,
// /api/audit).
//
// distributed-core's admission control does not bound these: its
// `dispatch` releases the slot in a `finally` right after `onRequest`
// resolves, and an SSE handler resolves as soon as it has registered its
// emitter listener. So before this, one client could hold an unlimited
// number of open streams, each with a socket, a heartbeat timer and a
// listener on a process-singleton emitter that receives every event the
// catalog observes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { SseRegistry, sseRegistry, DEFAULT_MAX_SSE_STREAMS } from '../src/server/sse.js';
import { makeRouteRequest, makeRouteResponse } from '../src/server/http-router.js';
import { tapEmitter } from '../src/server/tap-emitter.js';
import { createFlowHandlers } from '../src/server/routes/flow.js';
import type { RoutesDeps } from '../src/server/routes/_shared.js';

/**
 * A fake req/res pair good enough for the SSE routes: they only use
 * `req.on('close')`, the response's header/write/end surface, and
 * `res.raw` for socket-level state.
 */
function fakePair(): {
  req: ReturnType<typeof makeRouteRequest>;
  res: ReturnType<typeof makeRouteResponse>;
  written: string[];
  status: () => number | undefined;
  destroyed: () => boolean;
  disconnect: () => void;
  /** Pretend the peer has stopped reading: force a large write backlog. */
  setBacklog: (bytes: number) => void;
} {
  const written: string[] = [];
  let statusCode: number | undefined;
  let destroyed = false;
  let backlog = 0;

  const nodeReq = new EventEmitter() as unknown as http.IncomingMessage;
  Object.assign(nodeReq, { url: '/api/flow', method: 'GET', headers: {} });

  const nodeRes = new EventEmitter() as unknown as http.ServerResponse;
  Object.assign(nodeRes, {
    headersSent: false,
    setHeader() {},
    writeHead(code: number) { statusCode = code; (nodeRes as unknown as { headersSent: boolean }).headersSent = true; },
    flushHeaders() {},
    write(chunk: string) { written.push(chunk); return true; },
    end(body?: string) { if (body) written.push(body); },
    destroy() { destroyed = true; },
  });
  Object.defineProperty(nodeRes, 'writableLength', { get: () => backlog });

  return {
    req: makeRouteRequest(nodeReq, undefined),
    res: makeRouteResponse(nodeRes),
    written,
    status: () => statusCode,
    destroyed: () => destroyed,
    disconnect: () => nodeReq.emit('close'),
    setBacklog: (bytes: number) => { backlog = bytes; },
  };
}

describe('SseRegistry', () => {
  it('caps concurrent streams and answers 503 past the ceiling', () => {
    const registry = new SseRegistry({ maxStreams: 2, backlogBytes: 0 });
    const a = fakePair();
    const b = fakePair();
    const c = fakePair();

    expect(registry.open(a.req, a.res, () => {})).not.toBeNull();
    expect(registry.open(b.req, b.res, () => {})).not.toBeNull();
    expect(registry.size).toBe(2);

    const third = registry.open(c.req, c.res, () => {});
    expect(third).toBeNull();
    expect(c.status()).toBe(503);
    expect(c.written.join('')).toContain('TooManyStreams');
    expect(registry.size).toBe(2);
  });

  it('frees capacity when a peer disconnects, and runs the teardown once', () => {
    const registry = new SseRegistry({ maxStreams: 1, backlogBytes: 0 });
    const a = fakePair();
    let teardowns = 0;

    expect(registry.open(a.req, a.res, () => { teardowns += 1; })).not.toBeNull();
    expect(registry.size).toBe(1);

    a.disconnect();
    expect(registry.size).toBe(0);
    expect(teardowns).toBe(1);

    // The slot is reusable, and a second close is a no-op.
    a.disconnect();
    expect(teardowns).toBe(1);

    const b = fakePair();
    expect(registry.open(b.req, b.res, () => {})).not.toBeNull();
  });

  it('drops a stream whose write backlog exceeds the limit', () => {
    const registry = new SseRegistry({ maxStreams: 10, backlogBytes: 1024 });
    const a = fakePair();
    let torndown = false;

    const stream = registry.open(a.req, a.res, () => { torndown = true; })!;
    expect(stream.write('data: small\n\n')).toBe(true);

    // The peer has stopped reading; frames would otherwise pile up in
    // this process's socket buffer without limit.
    a.setBacklog(2048);
    expect(stream.write('data: too much\n\n')).toBe(false);

    expect(stream.closed).toBe(true);
    expect(torndown).toBe(true);
    expect(registry.size).toBe(0);
    expect(a.destroyed()).toBe(true);
  });

  it('closeAll() ends every open stream — the shutdown path depends on it', () => {
    const registry = new SseRegistry({ maxStreams: 10, backlogBytes: 0 });
    const pairs = [fakePair(), fakePair(), fakePair()];
    for (const p of pairs) registry.open(p.req, p.res, () => {});
    expect(registry.size).toBe(3);

    expect(registry.closeAll()).toBe(3);
    expect(registry.size).toBe(0);
    // end() alone leaves a keep-alive socket open, which is exactly what
    // stalls http.Server.close(); the socket must be destroyed too.
    for (const p of pairs) expect(p.destroyed()).toBe(true);
  });

  it('defaults to a finite ceiling', () => {
    expect(sseRegistry.getLimits().maxStreams).toBe(DEFAULT_MAX_SSE_STREAMS);
    expect(sseRegistry.getLimits().maxStreams).toBeGreaterThan(0);
  });
});

describe('GET /api/flow leaves no listener behind', () => {
  const deps = {} as RoutesDeps;
  const before = tapEmitter.listenerCount('publish');

  beforeEach(() => {
    sseRegistry.configure({ maxStreams: 2 });
  });

  afterEach(() => {
    sseRegistry.closeAll();
    sseRegistry.configure({ maxStreams: DEFAULT_MAX_SSE_STREAMS });
  });

  it('detaches its tap listener on disconnect and on closeAll()', () => {
    const { stream } = createFlowHandlers(deps);

    const a = fakePair();
    stream(a.req, a.res);
    expect(tapEmitter.listenerCount('publish')).toBe(before + 1);

    a.disconnect();
    expect(tapEmitter.listenerCount('publish')).toBe(before);

    // Same for a shutdown-initiated close.
    const b = fakePair();
    stream(b.req, b.res);
    expect(tapEmitter.listenerCount('publish')).toBe(before + 1);
    sseRegistry.closeAll();
    expect(tapEmitter.listenerCount('publish')).toBe(before);
  });

  it('answers 503 without registering a listener once at the ceiling', () => {
    const { stream } = createFlowHandlers(deps);
    const open = [fakePair(), fakePair()];
    for (const p of open) stream(p.req, p.res);
    expect(tapEmitter.listenerCount('publish')).toBe(before + 2);

    const rejected = fakePair();
    stream(rejected.req, rejected.res);
    expect(rejected.status()).toBe(503);
    expect(tapEmitter.listenerCount('publish')).toBe(before + 2);
  });
});
