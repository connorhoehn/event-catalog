// tests/compression-http.test.ts
//
// Response compression over a real socket.
//
// Raw `http.request` on purpose: supertest/superagent transparently
// gunzips, which would hide exactly the bug this file exists to catch (a
// `Content-Encoding` that does not match the bytes, or a stale
// `Content-Length` that hangs the peer). Node's `http.request` sends no
// `Accept-Encoding` of its own and decodes nothing, so every header and
// every byte asserted below is what actually went down the wire.

import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'node:http';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { Router, createRequestListener } from '../src/server/http-router.js';
import {
  DEFAULT_COMPRESSION,
  DEFAULT_COMPRESSION_THRESHOLD,
  type CompressionConfig,
} from '../src/server/compression.js';

// ─── harness ─────────────────────────────────────────────────────────────────

const servers: http.Server[] = [];

afterAll(async () => {
  await Promise.all(
    servers.map(s => new Promise<void>(resolve => s.close(() => resolve()))),
  );
});

/** A body big enough to clear the threshold, and highly compressible. */
const BIG = { events: Array.from({ length: 500 }, (_, i) => ({ name: `evt:${i}`, transport: 'signal' })) };
const BIG_JSON = Buffer.from(JSON.stringify(BIG), 'utf8');

function buildRouter(): ReturnType<typeof Router> {
  const router = Router();
  // The shape every real route takes: res.json() of something large.
  router.get('/big', (_req, res) => { res.json(BIG); });
  // 200 bytes — the health-check shape that gets BIGGER when gzipped.
  router.get('/small', (_req, res) => { res.json({ status: 'healthy', uptimeMs: 1234 }); });
  // Exact-length plain text, for the threshold boundary.
  router.get('/text/:n', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('x'.repeat(Number(req.params.n)));
  });
  // A media type that must never be compressed, at a size that would be.
  router.get('/binary', (_req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send('x'.repeat(50_000));
  });
  // A route that already set Vary for CORS — appending must not clobber it.
  router.get('/varied', (_req, res) => {
    res.setHeader('Vary', 'Origin');
    res.json(BIG);
  });
  router.get('/no-content', (_req, res) => { res.status(204).send(''); });
  return router;
}

async function startServer(compression?: CompressionConfig): Promise<number> {
  const listener = compression === undefined
    ? createRequestListener(['/api', buildRouter()])
    : createRequestListener({ compression }, ['/api', buildRouter()]);
  const server = http.createServer(listener);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('did not bind');
  return addr.port;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Exactly the bytes on the wire — never decoded. */
  body: Buffer;
}

function get(
  port: number,
  path: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('response compression over HTTP', () => {
  it('gzips a large JSON response and round-trips to the identical bytes', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    const plain = await get(port, '/api/big');
    const gzipped = await get(port, '/api/big', { 'Accept-Encoding': 'gzip' });

    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(gzipped.headers['content-encoding']).toBe('gzip');
    expect(gzipped.body.length).toBeLessThan(plain.body.length / 2);
    // The round trip that matters: identical bytes, not merely equal JSON.
    expect(gunzipSync(gzipped.body).equals(plain.body)).toBe(true);
    expect(plain.body.equals(BIG_JSON)).toBe(true);
  });

  it('serves br and deflate when those are what the client asked for', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    const br = await get(port, '/api/big', { 'Accept-Encoding': 'br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(br.body).equals(BIG_JSON)).toBe(true);

    const df = await get(port, '/api/big', { 'Accept-Encoding': 'deflate' });
    expect(df.headers['content-encoding']).toBe('deflate');
    expect(inflateSync(df.body).equals(BIG_JSON)).toBe(true);
  });

  it('sends identity when the client did not ask, or refused', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    for (const headers of [
      {},
      { 'Accept-Encoding': 'identity' },
      { 'Accept-Encoding': 'identity;q=1, gzip;q=0' },
      { 'Accept-Encoding': '' },
      { 'Accept-Encoding': 'zstd' },
    ]) {
      const res = await get(port, '/api/big', headers);
      expect(res.headers['content-encoding'], JSON.stringify(headers)).toBeUndefined();
      expect(res.body.equals(BIG_JSON), JSON.stringify(headers)).toBe(true);
    }
  });

  it('sets a Content-Length equal to the bytes actually sent', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    for (const enc of [undefined, 'gzip', 'br', 'deflate']) {
      const res = await get(
        port,
        '/api/big',
        enc === undefined ? {} : { 'Accept-Encoding': enc },
      );
      // A Content-Length left over from the uncompressed body is a framing
      // error: the peer waits forever for bytes that will never come.
      expect(Number(res.headers['content-length']), String(enc)).toBe(res.body.length);
      expect(res.headers['transfer-encoding'], String(enc)).toBeUndefined();
    }
  });

  it('always advertises Vary: Accept-Encoding, and never clobbers an existing Vary', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    // Even an identity response must carry it — a shared cache keying only
    // on the URL would otherwise hand this body to a gzip client, or the
    // gzip body to this one.
    const plain = await get(port, '/api/big');
    expect(String(plain.headers.vary).toLowerCase()).toContain('accept-encoding');

    const gz = await get(port, '/api/big', { 'Accept-Encoding': 'gzip' });
    expect(String(gz.headers.vary).toLowerCase()).toContain('accept-encoding');

    const varied = await get(port, '/api/varied', { 'Accept-Encoding': 'gzip' });
    const vary = String(varied.headers.vary).toLowerCase();
    expect(vary).toContain('origin');
    expect(vary).toContain('accept-encoding');
    // Appended once, not duplicated.
    expect(vary.split('accept-encoding').length - 1).toBe(1);
  });

  it('leaves a sub-threshold response alone — gzip would make it bigger', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    const res = await get(port, '/api/small', { 'Accept-Encoding': 'gzip, br' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ status: 'healthy', uptimeMs: 1234 });
  });

  it('draws the threshold boundary at exactly the configured byte count', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    const t = DEFAULT_COMPRESSION_THRESHOLD;

    const below = await get(port, `/api/text/${t - 1}`, { 'Accept-Encoding': 'gzip' });
    expect(below.headers['content-encoding']).toBeUndefined();
    expect(below.body.length).toBe(t - 1);

    const at = await get(port, `/api/text/${t}`, { 'Accept-Encoding': 'gzip' });
    expect(at.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(at.body).length).toBe(t);
  });

  it('honors a custom threshold', async () => {
    const port = await startServer({ ...DEFAULT_COMPRESSION, threshold: 64 });
    const res = await get(port, '/api/text/100', { 'Accept-Encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(res.body).length).toBe(100);
  });

  it('never compresses an already-compressed media type, however large', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    const res = await get(port, '/api/binary', { 'Accept-Encoding': 'gzip, br' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.length).toBe(50_000);
  });

  it('sends no body and no Content-Length on a 204', async () => {
    const port = await startServer(DEFAULT_COMPRESSION);
    const res = await get(port, '/api/no-content', { 'Accept-Encoding': 'gzip' });
    expect(res.status).toBe(204);
    expect(res.body.length).toBe(0);
    expect(res.headers['content-length']).toBeUndefined();
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('is a no-op when the policy is disabled', async () => {
    const port = await startServer({ ...DEFAULT_COMPRESSION, enabled: false });
    const res = await get(port, '/api/big', { 'Accept-Encoding': 'gzip, br' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers.vary).toBeUndefined();
    expect(res.body.equals(BIG_JSON)).toBe(true);
  });

  it('is a no-op when no policy is configured at all (pre-existing behavior)', async () => {
    const port = await startServer();
    const res = await get(port, '/api/big', { 'Accept-Encoding': 'gzip, br' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.equals(BIG_JSON)).toBe(true);
  });
});
