// tests/compression-sse.test.ts
//
// The regression this file guards: response compression must not touch
// `/api/flow` or `/api/audit`.
//
// Those are long-lived `text/event-stream` responses whose entire value
// is that a frame reaches the browser the instant it is written. A
// whole-buffer compressor would hold every frame until the stream ended
// — which for these two routes is never — and even a per-frame flush
// would undo the fan-out work that made one tap event reach 250 streams
// 9.7x faster, because each stream would then pay its own deflate.
//
// So the decision is: SSE is EXCLUDED, structurally rather than by a
// path allowlist. `makeRouteResponse` only ever compresses the one-shot
// `json()` / `send()` / `end(body)` paths; `flushHeaders()` and
// `write()` — the only two calls an SSE route makes — latch a flag that
// disables compression for the rest of that response's life. A new
// streaming route therefore inherits the exclusion for free.
//
// The proof below is not "the header is absent". It is that a frame
// published AFTER the response headers arrived is read by the client
// while the response is still open (`res.complete === false`), i.e.
// incrementally, rather than all at once at stream end.

import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'node:http';
import { createRequestListener } from '../src/server/http-router.js';
import { DEFAULT_COMPRESSION } from '../src/server/compression.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { tapEmitter, type TapEvent } from '../src/server/tap-emitter.js';
import { sseRegistry } from '../src/server/sse.js';

const servers: http.Server[] = [];

afterAll(async () => {
  sseRegistry.closeAll();
  await Promise.all(
    servers.map(s => new Promise<void>(resolve => s.close(() => resolve()))),
  );
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
      description: `synthetic declaration ${i} — big enough, in aggregate, to clear the compression threshold`,
    });
  }
  return registry;
}

function deps(declarations = 0): RoutesDeps {
  return {
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
  };
}

/** Boot the real /api router with compression fully enabled. */
async function startFlowServer(declarations = 0): Promise<number> {
  const listener = createRequestListener(
    { compression: DEFAULT_COMPRESSION },
    ['/api', createRoutes(deps(declarations))],
  );
  const server = http.createServer(listener);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('did not bind');
  return addr.port;
}

function tapEvent(name: string): TapEvent {
  return {
    eventName: name,
    namespace: 'pipeline',
    producer: 'pipeline-worker',
    transport: 'signal',
    timestamp: new Date().toISOString(),
    channel: `events:${name}`,
    envelope: { eventName: name, payload: { n: 1 }, metadata: {} },
  };
}

/** Open the stream and resolve once the response headers are in. */
function openStream(port: number, path: string, acceptEncoding: string): Promise<{
  res: http.IncomingMessage;
  req: http.ClientRequest;
  /** Text received so far, decoded as UTF-8 (never through a decompressor). */
  text: () => string;
  /** Wait until `text()` contains `needle`, or reject after `ms`. */
  waitFor: (needle: string, ms?: number) => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { 'Accept-Encoding': acceptEncoding, Accept: 'text/event-stream' },
      },
      res => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { buffer += chunk; });
        resolve({
          res,
          req,
          text: () => buffer,
          waitFor: (needle, ms = 2000) => new Promise<void>((ok, fail) => {
            if (buffer.includes(needle)) { ok(); return; }
            const timer = setTimeout(() => {
              res.off('data', check);
              fail(new Error(`timed out waiting for ${JSON.stringify(needle)}; got ${JSON.stringify(buffer.slice(0, 400))}`));
            }, ms);
            function check(): void {
              if (!buffer.includes(needle)) return;
              clearTimeout(timer);
              res.off('data', check);
              ok();
            }
            res.on('data', check);
          }),
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('SSE is excluded from response compression', () => {
  it('serves /api/flow uncompressed and unbuffered to a client that offered gzip/br', async () => {
    const port = await startFlowServer();
    const stream = await openStream(port, '/api/flow', 'gzip, deflate, br');

    // 1. Headers say stream, not encoded body — and carry no
    //    Content-Length, which for an endless response would be a lie.
    expect(stream.res.headers['content-type']).toBe('text/event-stream');
    expect(stream.res.headers['content-encoding']).toBeUndefined();
    expect(stream.res.headers['content-length']).toBeUndefined();
    expect(stream.res.headers['x-accel-buffering']).toBe('no');

    // 2. The preamble is already readable as plain text — a gzip member
    //    would start with the 0x1f 0x8b magic and decode to nothing.
    await stream.waitFor(': connected;');
    expect(stream.text().startsWith(': connected;')).toBe(true);

    // 3. INCREMENTAL: publish after the connection is live and read the
    //    frame back while the response is still open. If anything
    //    buffered the body, `waitFor` would time out here and only
    //    resolve at stream end.
    tapEmitter.publish(tapEvent('pipeline:step:one'));
    await stream.waitFor('pipeline:step:one');
    expect(stream.res.complete).toBe(false);

    // 4. And again, so we know it is a live stream rather than one
    //    lucky flush.
    tapEmitter.publish(tapEvent('pipeline:step:two'));
    await stream.waitFor('pipeline:step:two');
    expect(stream.res.complete).toBe(false);

    // Frame ordering survived: two distinct events, in order.
    const body = stream.text();
    expect(body.indexOf('pipeline:step:one')).toBeLessThan(body.indexOf('pipeline:step:two'));

    stream.req.destroy();
  });

  it('serves /api/audit the same way', async () => {
    const port = await startFlowServer();
    const stream = await openStream(port, '/api/audit', 'br, gzip');
    expect(stream.res.headers['content-type']).toBe('text/event-stream');
    expect(stream.res.headers['content-encoding']).toBeUndefined();
    expect(stream.res.headers['content-length']).toBeUndefined();
    stream.req.destroy();
  });

  it('a non-stream route on the same server still compresses', async () => {
    // Guards against "SSE works because compression silently broke".
    const port = await startFlowServer(200);
    const body = await new Promise<{ enc: string | undefined; len: number }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/events', method: 'GET', headers: { 'Accept-Encoding': 'gzip' } },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({
            enc: res.headers['content-encoding'],
            len: Buffer.concat(chunks).length,
          }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(body.enc).toBe('gzip');
    expect(body.len).toBeGreaterThan(0);
  });
});
