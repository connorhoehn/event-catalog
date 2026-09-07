// tests/server-compression.test.ts
//
// Compression through the PRODUCTION transport.
//
// `tests/compression-http.test.ts` drives `createRequestListener`, which
// is the unit-test harness. This file binds a real
// distributed-core `AdmissionHttpServer` and wires it exactly the way
// `startServer`'s `onRequest` does — `makeRouteRequest` +
// `makeRouteResponse(nodeRes, compressionFor(nodeReq, compression))` —
// because the transport does things the harness does not: it reads the
// request body itself, wraps the response in its own helper object, and
// releases an admission slot in a `finally` after `onRequest` resolves.
//
// Two things are proven here that only this layer can prove:
//   1. A large JSON response really is gzipped on the way out, with a
//      Content-Length matching the compressed bytes.
//   2. `/api/flow` still streams incrementally through it — the same SSE
//      guarantee, but past the real body reader and admission control
//      rather than past the harness's.

import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { AdmissionHttpServer } from 'distributed-core/server';
import {
  compressionFor,
  makeRouteRequest,
  makeRouteResponse,
} from '../src/server/http-router.js';
import { DEFAULT_COMPRESSION } from '../src/server/compression.js';
import { REQUEST_BODY_LIMITS } from '../src/server/index.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { tapEmitter } from '../src/server/tap-emitter.js';
import { sseRegistry } from '../src/server/sse.js';

const servers: AdmissionHttpServer[] = [];

afterAll(async () => {
  sseRegistry.closeAll();
  while (servers.length > 0) await servers.pop()?.stop().catch(() => {});
});

function seededRegistry(count: number): Registry {
  const registry = new Registry();
  for (let i = 0; i < count; i++) {
    registry.declare({
      name: `pipeline:step:${i}:completed`,
      schema: {
        type: 'object',
        properties: {
          stepId: { type: 'string' },
          pipelineId: { type: 'string' },
          durationMs: { type: 'number' },
        },
        required: ['stepId'],
      },
      transport: 'signal',
      producer: 'pipeline-worker',
      description: `synthetic declaration ${i}`,
    });
  }
  return registry;
}

/**
 * Bind an AdmissionHttpServer whose `onRequest` is the same three lines
 * `startServer` runs for every `/api` request.
 */
async function startProdLikeServer(declarations: number): Promise<number> {
  const routes = createRoutes({
    registry: seededRegistry(declarations),
    metrics: new MetricsCollector(60),
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getHistory: async () => [],
    } as unknown as RoutesDeps['signal'],
    durable: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
    } as unknown as RoutesDeps['durable'],
    dlqStore: { list: async () => [] } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
  });

  const server = new AdmissionHttpServer({
    port: 0,
    hostname: '127.0.0.1',
    bodyLimits: REQUEST_BODY_LIMITS,
    onRequest: async (areq, ares) => {
      const req = makeRouteRequest(areq.raw, undefined);
      const res = makeRouteResponse(
        ares.nodeRes,
        compressionFor(areq.raw, DEFAULT_COMPRESSION),
      );
      const sub = req.path.replace(/^\/api/, '') || '/';
      const handled = await routes.handle(req, res, sub);
      if (!handled && !res.headersSent) res.status(404).json({ error: 'NotFound' });
    },
  });
  await server.start();
  servers.push(server);
  const addr = server.address();
  if (addr === null) throw new Error('did not bind');
  return addr.port;
}

function get(port: number, path: string, headers: http.OutgoingHttpHeaders): Promise<{
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('compression through AdmissionHttpServer', () => {
  it('gzips GET /api/events and round-trips to the uncompressed body', async () => {
    const port = await startProdLikeServer(200);
    const plain = await get(port, '/api/events', {});
    const gz = await get(port, '/api/events', { 'Accept-Encoding': 'gzip' });

    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(String(gz.headers.vary).toLowerCase()).toContain('accept-encoding');
    expect(Number(gz.headers['content-length'])).toBe(gz.body.length);
    expect(gunzipSync(gz.body).equals(plain.body)).toBe(true);
    // The whole point: an order-of-magnitude smaller response.
    expect(gz.body.length).toBeLessThan(plain.body.length / 5);
  });

  it('still streams /api/flow incrementally to a gzip-capable client', async () => {
    const port = await startProdLikeServer(4);
    const frames: string[] = [];

    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/flow',
          headers: { 'Accept-Encoding': 'gzip, deflate, br' },
        },
        r => {
          r.setEncoding('utf8');
          r.on('data', (c: string) => frames.push(c));
          resolve(r);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).toBeUndefined();

    await waitUntil(() => frames.join('').includes(': connected;'));

    // Published after the stream is live, and read back while the
    // response is still open — the property that makes /api/flow useful.
    tapEmitter.publish({
      eventName: 'pipeline:step:live',
      namespace: 'pipeline',
      producer: 'pipeline-worker',
      transport: 'signal',
      timestamp: new Date().toISOString(),
      channel: 'c',
      envelope: {},
    });
    await waitUntil(() => frames.join('').includes('pipeline:step:live'));
    expect(res.complete).toBe(false);

    res.destroy();
  });
});

/** Poll until `predicate` holds, or fail after `ms`. */
async function waitUntil(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for stream data');
    await new Promise(r => setTimeout(r, 10));
  }
}
