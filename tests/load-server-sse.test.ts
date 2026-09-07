// tests/load-server-sse.test.ts
//
// SSE lifecycle *at* the limit, sustained.
//
// `tests/security-sse-limits.test.ts` proves the cap exists and that one
// clean disconnect frees one slot. This file asks the question that only
// matters after a week: does the registry still hold exactly zero slots,
// zero heartbeat timers and zero emitter listeners after thousands of
// streams have come and gone — including the ones that ended badly
// (socket reset, error event, slow-reader backlog drop) rather than
// cleanly?
//
// Every assertion is an observable count — registry size, listener
// count, fake-timer count. No wall-clock, no memory sampling.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { SseRegistry, SSE_HEARTBEAT_MS, DEFAULT_MAX_SSE_STREAMS } from '../src/server/sse.js';
import { makeRouteRequest, makeRouteResponse } from '../src/server/http-router.js';
import { tapEmitter } from '../src/server/tap-emitter.js';
import { auditEmitter } from '../src/server/audit-emitter.js';
import { createFlowHandlers } from '../src/server/routes/flow.js';
import { createAuditHandlers } from '../src/server/routes/audit.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import type { RoutesDeps } from '../src/server/routes/_shared.js';

interface Pair {
  req: ReturnType<typeof makeRouteRequest>;
  res: ReturnType<typeof makeRouteResponse>;
  written: string[];
  status: () => number | undefined;
  /** Peer reset: the request stream closes without a clean end. */
  reset: () => void;
  /** Socket-level failure: an 'error' on the response, no 'close' first. */
  fail: () => void;
  setBacklog: (bytes: number) => void;
}

function fakePair(url = '/api/flow'): Pair {
  const written: string[] = [];
  let statusCode: number | undefined;
  let backlog = 0;

  const nodeReq = new EventEmitter() as unknown as http.IncomingMessage;
  Object.assign(nodeReq, { url, method: 'GET', headers: {} });

  const nodeRes = new EventEmitter() as unknown as http.ServerResponse;
  Object.assign(nodeRes, {
    headersSent: false,
    setHeader() {},
    writeHead(code: number) {
      statusCode = code;
      (nodeRes as unknown as { headersSent: boolean }).headersSent = true;
    },
    flushHeaders() {},
    write(chunk: string) { written.push(chunk); return true; },
    end(body?: string) { if (body) written.push(body); },
    destroy() { nodeRes.emit('close'); },
  });
  Object.defineProperty(nodeRes, 'writableLength', { get: () => backlog });

  return {
    req: makeRouteRequest(nodeReq, undefined),
    res: makeRouteResponse(nodeRes),
    written,
    status: () => statusCode,
    reset: () => nodeReq.emit('close'),
    fail: () => nodeRes.emit('error', new Error('ECONNRESET')),
    setBacklog: (bytes: number) => { backlog = bytes; },
  };
}

const deps = {} as RoutesDeps;

afterEach(async () => {
  // The routes open on the module singleton, so a test that leaves a
  // stream open would hand the next one a saturated registry. Closing it
  // here is exactly what the shutdown path does.
  const { sseRegistry } = await import('../src/server/sse.js');
  sseRegistry.closeAll();
  vi.useRealTimers();
  tapEmitter.removeAllListeners('publish');
  auditEmitter.removeAllListeners('audit');
});

describe('SSE churn at the concurrency ceiling', () => {
  it('releases every slot, listener and heartbeat across repeated saturation cycles', () => {
    vi.useFakeTimers();
    const registry = new SseRegistry({ maxStreams: DEFAULT_MAX_SSE_STREAMS, backlogBytes: 0 });
    const baseTimers = vi.getTimerCount();
    // Six cycles of "fill to the cap, then kill them all abruptly".
    for (let cycle = 0; cycle < 6; cycle++) {
      const pairs: Pair[] = [];
      for (let i = 0; i < DEFAULT_MAX_SSE_STREAMS; i++) {
        const p = fakePair();
        pairs.push(p);
        const stream = registry.open(p.req, p.res, () => tapEmitter.off('publish', () => {}));
        expect(stream).not.toBeNull();
      }
      expect(registry.size).toBe(DEFAULT_MAX_SSE_STREAMS);
      expect(vi.getTimerCount()).toBe(baseTimers + DEFAULT_MAX_SSE_STREAMS);

      // Half reset the request stream, half fail at the socket. Neither is
      // a clean `end()`; both must run the teardown exactly once.
      pairs.forEach((p, i) => (i % 2 === 0 ? p.reset() : p.fail()));

      expect(registry.size).toBe(0);
      expect(vi.getTimerCount()).toBe(baseTimers);
    }
  });

  it('the flow route detaches its tap listener on every abrupt close', async () => {
    // The route attaches to a process-singleton emitter that receives a
    // serialized copy of every event the catalog observes, so a listener
    // that survives its stream is both a leak and a per-publish cost that
    // never goes away.
    vi.useFakeTimers();
    const { sseRegistry } = await import('../src/server/sse.js');
    const flow = createFlowHandlers(deps);
    const base = tapEmitter.listenerCount('publish');

    for (let cycle = 0; cycle < 8; cycle++) {
      const pairs: Pair[] = [];
      for (let i = 0; i < 200; i++) {
        const p = fakePair();
        pairs.push(p);
        flow.stream(p.req, p.res);
      }
      expect(tapEmitter.listenerCount('publish')).toBe(base + 200);
      expect(sseRegistry.size).toBe(200);

      pairs.forEach((p, i) => (i % 2 === 0 ? p.reset() : p.fail()));

      expect(tapEmitter.listenerCount('publish')).toBe(base);
      expect(sseRegistry.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('does not leak a slot when the peer vanishes between preamble and first write', () => {
    vi.useFakeTimers();
    const registry = new SseRegistry({ maxStreams: 8, backlogBytes: 0 });
    for (let i = 0; i < 2_000; i++) {
      const p = fakePair();
      const stream = registry.open(p.req, p.res, () => {});
      expect(stream).not.toBeNull();
      // Reset arrives before the route writes its `: connected` comment —
      // the write must be a no-op on a closed stream, not a re-open.
      p.reset();
      expect(stream!.write(': connected\n\n')).toBe(false);
    }
    expect(registry.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a slow reader is dropped and gives its slot back', () => {
    vi.useFakeTimers();
    const registry = new SseRegistry({ maxStreams: 4, backlogBytes: 1024 });
    let teardowns = 0;

    for (let i = 0; i < 1_000; i++) {
      const p = fakePair();
      const stream = registry.open(p.req, p.res, () => { teardowns += 1; })!;
      p.setBacklog(4096);
      expect(stream.write('data: x\n\n')).toBe(false);
      expect(stream.closed).toBe(true);
    }
    expect(teardowns).toBe(1_000);
    expect(registry.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('heartbeats keep firing for the life of a stream and stop at close', () => {
    vi.useFakeTimers();
    const registry = new SseRegistry({ maxStreams: 4, backlogBytes: 0 });
    const p = fakePair();
    registry.open(p.req, p.res, () => {});
    const beforeBeats = p.written.length;

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS * 10);
    expect(p.written.length).toBe(beforeBeats + 10);

    registry.closeAll();
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS * 10);
    expect(p.written.length).toBe(beforeBeats + 10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closeAll detaches both routes\' emitter listeners', async () => {
    vi.useFakeTimers();
    const flow = createFlowHandlers(deps);
    const audit = createAuditHandlers({ auditLog: undefined } as unknown as RoutesDeps);
    const baseFlow = tapEmitter.listenerCount('publish');
    const baseAudit = auditEmitter.listenerCount('audit');

    const pairs: Pair[] = [];
    for (let i = 0; i < 60; i++) {
      const f = fakePair();
      pairs.push(f);
      flow.stream(f.req, f.res);
      const a = fakePair('/api/audit');
      pairs.push(a);
      await audit.stream(a.req, a.res);
    }
    expect(tapEmitter.listenerCount('publish')).toBe(baseFlow + 60);
    expect(auditEmitter.listenerCount('audit')).toBe(baseAudit + 60);

    // The shared module singleton is what the shutdown path calls.
    const { sseRegistry } = await import('../src/server/sse.js');
    sseRegistry.closeAll();

    expect(tapEmitter.listenerCount('publish')).toBe(baseFlow);
    expect(auditEmitter.listenerCount('audit')).toBe(baseAudit);
    expect(sseRegistry.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('DEFECT: a refused stream is invisible in /metrics', () => {
    // `SseRegistry.open` (src/server/sse.ts:267) answers 503 `TooManyStreams` and returns null,
    // but nothing calls `PromMetrics.recordSseRejected()` — it has zero
    // callers in src/ (prom-metrics.ts:456). So the counter that exists
    // precisely to tell an operator "the server has started refusing flow
    // streams" is never registered and never rendered: saturation is only
    // inferable from `sse_streams_active` happening to equal
    // `sse_streams_max` at scrape time, which misses every refusal
    // between scrapes.
    vi.useFakeTimers();
    const registry = new SseRegistry({ maxStreams: 2, backlogBytes: 0 });
    const held = [fakePair(), fakePair()];
    for (const p of held) registry.open(p.req, p.res, () => {});

    for (let i = 0; i < 200; i++) {
      const p = fakePair();
      expect(registry.open(p.req, p.res, () => {})).toBeNull();
      expect(p.status()).toBe(503);
    }

    const prom = new PromMetrics();
    prom.collect(() => {
      prom.setSseStreams(registry.size, registry.getLimits().maxStreams);
    });
    const body = prom.renderProm();
    expect(body).toContain('event_catalog_sse_streams_active');
    expect(body).not.toContain('sse_streams_rejected_total');

    registry.closeAll();
  });
});
