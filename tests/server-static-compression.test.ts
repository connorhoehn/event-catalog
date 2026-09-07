// tests/server-static-compression.test.ts
//
// The admin UI is the largest thing this service sends, and until now it
// was the only thing it sent uncompressed: `makeRouteResponse` negotiates
// a coding for all ~45 API handlers, but distributed-core's `serveStatic`
// takes the raw `http.ServerResponse` and writes the file to the socket
// itself, so the 272 KiB graph vendor chunk went out raw while a 2 KiB
// JSON body got brotli'd.
//
// These tests pin the wrapper that closes that gap, and in particular the
// three things that would make a "just compress it" change worse than the
// large download it replaced:
//
//   1. The wrapped handler's true/false contract is untouched. A path
//      `serveStatic` declines must still be declined, with NOTHING written
//      to the socket, or the SPA fallback never runs and every deep link
//      404s.
//   2. `serveStatic`'s own logic still decides everything that is easy to
//      get wrong — the 403 on traversal, the MIME table, `no-cache` for
//      HTML vs `immutable` for hashed assets. The wrapper only rewrites
//      the body and the two headers that describe it.
//   3. A client that did not ask for a coding gets identity, and a body
//      is never framed with a Content-Length that describes the
//      pre-compression bytes.
//
// The last block measures the real built bundle, so the numbers in the
// module header stay honest.

import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { serveStatic } from 'distributed-core/server';
import {
  withStaticCompression,
  sendStaticBuffer,
  StaticCompressionCache,
} from '../src/server/static-compression.js';
import {
  DEFAULT_COMPRESSION,
  compressBody,
  isCompressibleType,
  negotiateEncoding,
  type CompressionConfig,
} from '../src/server/compression.js';

const ADMIN_DIST = path.resolve(__dirname, '../src/admin/dist');

// ---------------------------------------------------------------------------
// A fake ServerResponse that records what actually reached the socket.
// ---------------------------------------------------------------------------

interface Recorded {
  status: number | undefined;
  headers: Record<string, string>;
  body: Buffer;
  ended: boolean;
}

function fakeResponse(): { res: http.ServerResponse; out: Recorded } {
  const out: Recorded = { status: undefined, headers: {}, body: Buffer.alloc(0), ended: false };
  const chunks: Buffer[] = [];
  const res = {
    headersSent: false,
    setHeader(name: string, value: unknown): void {
      out.headers[name.toLowerCase()] = String(value);
    },
    getHeader(name: string): string | undefined {
      return out.headers[name.toLowerCase()];
    },
    removeHeader(name: string): void {
      delete out.headers[name.toLowerCase()];
    },
    writeHead(code: number, headers?: Record<string, unknown>): unknown {
      out.status = code;
      (this as { headersSent: boolean }).headersSent = true;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) out.headers[k.toLowerCase()] = String(v);
      }
      return this;
    },
    write(chunk: Buffer | string): boolean {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk?: Buffer | string): unknown {
      if (chunk !== undefined && typeof chunk !== 'function') {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      out.body = Buffer.concat(chunks);
      out.ended = true;
      return this;
    },
  } as unknown as http.ServerResponse;
  return { res, out };
}

function fakeRequest(url: string, acceptEncoding?: string): http.IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  } as unknown as http.IncomingMessage;
}

/** A wrapped serveStatic bound to the real admin build. */
function wrapped(config: CompressionConfig | undefined = DEFAULT_COMPRESSION, cache?: StaticCompressionCache | null) {
  return withStaticCompression(
    serveStatic({ staticDir: ADMIN_DIST }),
    { compression: config, cache: cache === undefined ? null : cache },
  );
}

/** The largest compressible asset in the built bundle. */
function biggestAsset(): { url: string; bytes: Buffer } {
  const assets = path.join(ADMIN_DIST, 'assets');
  const files = fs.readdirSync(assets)
    .filter(f => f.endsWith('.js') || f.endsWith('.css'))
    .map(f => ({ f, size: fs.statSync(path.join(assets, f)).size }))
    .sort((a, b) => b.size - a.size);
  const winner = files[0];
  return {
    url: `/assets/${winner.f}`,
    bytes: fs.readFileSync(path.join(assets, winner.f)),
  };
}

const hasBuild = fs.existsSync(path.join(ADMIN_DIST, 'index.html'));
const whenBuilt = hasBuild ? describe : describe.skip;

// ---------------------------------------------------------------------------

whenBuilt('serveStatic can be wrapped rather than replaced', () => {
  it('a request it declines is still declined, with nothing written', () => {
    const handler = wrapped();
    const { res, out } = fakeResponse();

    const handled = handler(fakeRequest('/definitely/not/a/file.js', 'br, gzip'), res);

    expect(handled).toBe(false);
    expect(out.ended).toBe(false);
    expect(out.status).toBeUndefined();
    expect(out.body).toHaveLength(0);
  });

  it('serveStatic still owns the MIME type and the cache policy', () => {
    const { url } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest(url, 'br'), res);

    expect(out.status).toBe(200);
    // Untouched by the wrapper — these come out of serveStatic's own
    // extension table and max-age logic.
    expect(out.headers['content-type']).toMatch(/javascript|text\/css/);
    expect(out.headers['cache-control']).toContain('immutable');
  });

  it('index.html keeps no-cache, not the immutable policy', () => {
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest('/index.html', 'br, gzip'), res);

    expect(out.headers['cache-control']).toBe('no-cache');
  });

  it('the traversal 403 still comes from serveStatic and carries no body', () => {
    const handler = wrapped();
    const { res, out } = fakeResponse();

    // path.join collapses the ..; the resolved path escapes staticDir.
    const handled = handler(fakeRequest('/../../package.json', 'br, gzip'), res);

    expect(handled).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body).toHaveLength(0);
    expect(out.headers['content-encoding']).toBeUndefined();
  });
});

whenBuilt('negotiation', () => {
  it('brotli is preferred and the body decompresses to the file on disk', () => {
    const { url, bytes } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest(url, 'gzip, deflate, br'), res);

    expect(out.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(out.body).equals(bytes)).toBe(true);
  });

  it('falls back to gzip for a client that offers only gzip', () => {
    const { url, bytes } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest(url, 'gzip'), res);

    expect(out.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(out.body).equals(bytes)).toBe(true);
  });

  it('a request with no Accept-Encoding gets the raw bytes', () => {
    const { url, bytes } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest(url), res);

    expect(out.headers['content-encoding']).toBeUndefined();
    expect(out.body.equals(bytes)).toBe(true);
  });

  it('honours gzip;q=0 — a coding the client refused is never sent', () => {
    const { url, bytes } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest(url, 'gzip;q=0, identity'), res);

    expect(out.headers['content-encoding']).toBeUndefined();
    expect(out.body.equals(bytes)).toBe(true);
  });

  it('Content-Length always describes the bytes actually written', () => {
    const { url } = biggestAsset();
    for (const accept of [undefined, 'gzip', 'br']) {
      const handler = wrapped();
      const { res, out } = fakeResponse();
      handler(fakeRequest(url, accept), res);
      expect(Number(out.headers['content-length'])).toBe(out.body.length);
    }
  });

  it('sets Vary: Accept-Encoding even when it sends identity', () => {
    const { url } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();

    handler(fakeRequest(url), res);

    expect(out.headers['content-encoding']).toBeUndefined();
    expect(out.headers['vary']).toBe('Accept-Encoding');
  });

  it('appends to an existing Vary rather than clobbering the CORS one', () => {
    const { url } = biggestAsset();
    const handler = wrapped();
    const { res, out } = fakeResponse();
    res.setHeader('Vary', 'Origin');

    handler(fakeRequest(url, 'br'), res);

    expect(out.headers['vary']).toBe('Origin, Accept-Encoding');
  });

  it('does not compress a file below the threshold', () => {
    // index.html is 481 bytes — under the 1 KiB floor, where a gzip
    // member's own header and trailer make the response larger.
    const raw = fs.readFileSync(path.join(ADMIN_DIST, 'index.html'));
    expect(raw.length).toBeLessThan(DEFAULT_COMPRESSION.threshold);

    const handler = wrapped();
    const { res, out } = fakeResponse();
    handler(fakeRequest('/index.html', 'br, gzip'), res);

    expect(out.headers['content-encoding']).toBeUndefined();
    expect(out.body.equals(raw)).toBe(true);
  });

  it('compression disabled returns the original handler untouched', () => {
    const off: CompressionConfig = { ...DEFAULT_COMPRESSION, enabled: false };
    const original = serveStatic({ staticDir: ADMIN_DIST });
    expect(withStaticCompression(original, { compression: off })).toBe(original);
    expect(withStaticCompression(original, { compression: undefined })).toBe(original);
  });
});

whenBuilt('the compressed-variant cache', () => {
  it('serves a second request from cache and produces the identical bytes', () => {
    const { url } = biggestAsset();
    const cache = new StaticCompressionCache();
    const handler = wrapped(DEFAULT_COMPRESSION, cache);

    const first = fakeResponse();
    handler(fakeRequest(url, 'br'), first.res);
    expect(cache.size).toBe(1);

    const second = fakeResponse();
    handler(fakeRequest(url, 'br'), second.res);

    expect(second.out.body.equals(first.out.body)).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('a changed file under the same name invalidates its entry', () => {
    const cache = new StaticCompressionCache();
    const before = Buffer.from('a'.repeat(4096));
    const after = Buffer.from('b'.repeat(4096));
    const compressed = compressBody(before, 'br', DEFAULT_COMPRESSION.level);

    cache.set('/x br', before, compressed);
    expect(cache.get('/x br', before)).toBe(compressed);
    // index.html is not content-hashed, so this is a real rebuild case.
    expect(cache.get('/x br', after)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('stays inside its byte budget', () => {
    const cache = new StaticCompressionCache(20_000);
    for (let i = 0; i < 50; i++) {
      const raw = Buffer.alloc(4096, i);
      cache.set(`/f${i} br`, raw, compressBody(raw, 'br', 6));
    }
    expect(cache.byteLength).toBeLessThanOrEqual(20_000);
    expect(cache.size).toBeGreaterThan(0);
  });

  it('refuses to cache anything larger than the whole budget', () => {
    const cache = new StaticCompressionCache(1024);
    const raw = Buffer.alloc(64 * 1024, 7);
    cache.set('/huge br', raw, compressBody(raw, 'br', 6));
    expect(cache.size).toBe(0);
  });
});

describe('sendStaticBuffer (the SPA index.html fallback path)', () => {
  it('compresses a large HTML fallback and frames it correctly', () => {
    const html = Buffer.from(`<!doctype html><body>${'x'.repeat(8192)}</body>`);
    const { res, out } = fakeResponse();

    sendStaticBuffer(
      fakeRequest('/some/deep/link', 'br'),
      res,
      200,
      html,
      new Map([['content-type', 'text/html'], ['cache-control', 'no-cache']]),
      DEFAULT_COMPRESSION,
    );

    expect(out.status).toBe(200);
    expect(out.headers['content-encoding']).toBe('br');
    expect(out.headers['cache-control']).toBe('no-cache');
    expect(Number(out.headers['content-length'])).toBe(out.body.length);
    expect(brotliDecompressSync(out.body).equals(html)).toBe(true);
  });

  it('sends no body and no Content-Length on a 304', () => {
    const { res, out } = fakeResponse();

    sendStaticBuffer(
      fakeRequest('/x', 'br'),
      res,
      304,
      Buffer.alloc(0),
      new Map(),
      DEFAULT_COMPRESSION,
    );

    expect(out.status).toBe(304);
    expect(out.body).toHaveLength(0);
    expect(out.headers['content-length']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Measured: what this actually saves on the real build.
// ---------------------------------------------------------------------------

whenBuilt('measured transfer size of the built admin bundle', () => {
  it('ships materially fewer bytes to a modern browser', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(ADMIN_DIST);

    let raw = 0;
    let sent = 0;
    const rows: string[] = [];
    for (const file of files) {
      const bytes = fs.readFileSync(file);
      const url = '/' + path.relative(ADMIN_DIST, file).split(path.sep).join('/');
      const handler = wrapped();
      const { res, out } = fakeResponse();
      handler(fakeRequest(url, 'gzip, deflate, br'), res);

      // Every file in the build must be served, compressed or not.
      expect(out.status).toBe(200);
      raw += bytes.length;
      sent += out.body.length;
      if (bytes.length > 10_000) {
        rows.push(
          `${path.basename(file).padEnd(30)} ${String(bytes.length).padStart(7)} -> `
          + `${String(out.body.length).padStart(7)} (${out.headers['content-encoding'] ?? 'identity'})`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n  admin bundle over the wire:\n    ${rows.join('\n    ')}\n`
      + `    ${'TOTAL'.padEnd(30)} ${String(raw).padStart(7)} -> ${String(sent).padStart(7)}`
      + ` (${(100 - (sent / raw) * 100).toFixed(1)}% saved)\n`,
    );

    // The build is ~629 KiB raw and ~196 KiB brotli today. Assert the
    // shape of the win, not the exact figure, so a bundle change does
    // not break the test.
    expect(sent).toBeLessThan(raw * 0.5);
    expect(raw).toBeGreaterThan(300_000);
  });
});

// ---------------------------------------------------------------------------
// The fake response above is a convenience, not the contract. The proxy
// wraps a real `http.ServerResponse`, whose writeHead/end are native and
// whose framing (Content-Length vs chunked, HEAD body suppression) is
// decided inside Node. Prove it over an actual socket.
// ---------------------------------------------------------------------------

whenBuilt('over a real socket', () => {
  async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
    const handler = withStaticCompression(
      serveStatic({ staticDir: ADMIN_DIST }),
      { compression: DEFAULT_COMPRESSION, cache: null },
    );
    const server = http.createServer((req, res) => {
      if (handler(req, res)) return;
      res.writeHead(404);
      res.end('fell through');
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    try {
      return await fn(port);
    } finally {
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    }
  }

  /** Raw fetch — no client-side content decoding, so we see the wire bytes. */
  function raw(port: number, url: string, accept?: string, method = 'GET') {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
      resolve => {
        const req = http.request(
          { port, path: url, method, headers: accept ? { 'accept-encoding': accept } : {} },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }));
          },
        );
        req.end();
      },
    );
  }

  it('delivers a brotli body a real client can decode, framed by Content-Length', async () => {
    const { url, bytes } = biggestAsset();
    await withServer(async port => {
      const res = await raw(port, url, 'gzip, deflate, br');
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(Number(res.headers['content-length'])).toBe(res.body.length);
      // serveStatic set no Content-Length, so every asset used to go out
      // chunk-framed; with a compressed body a correct length is required.
      expect(res.headers['transfer-encoding']).toBeUndefined();
      expect(brotliDecompressSync(res.body).equals(bytes)).toBe(true);
    });
  });

  it('still falls through to the caller for an unknown path', async () => {
    await withServer(async port => {
      const res = await raw(port, '/no/such/file.js', 'br');
      expect(res.status).toBe(404);
      expect(res.body.toString()).toBe('fell through');
    });
  });

  it('HEAD sends no body but advertises the compressed length', async () => {
    const { url } = biggestAsset();
    await withServer(async port => {
      const get = await raw(port, url, 'br');
      const head = await raw(port, url, 'br', 'HEAD');
      expect(head.status).toBe(200);
      expect(head.body).toHaveLength(0);
      expect(head.headers['content-length']).toBe(String(get.body.length));
      expect(head.headers['content-encoding']).toBe('br');
    });
  });
});

describe('the negotiation itself is the API path\'s, not a second implementation', () => {
  it('reuses compression.ts rather than restating the rules', () => {
    // If these ever diverge, a static asset and an API response would
    // answer the same Accept-Encoding differently.
    expect(
      negotiateEncoding('br;q=0.1, gzip;q=0.9, identity;q=0.5', DEFAULT_COMPRESSION.encodings),
    ).toBe('gzip');
    // Unmentioned identity is acceptable at q=1, so it beats an
    // explicitly de-prioritised gzip — the rule that keeps a client which
    // would rather have raw bytes from getting compressed ones.
    expect(negotiateEncoding('br;q=0.1, gzip;q=0.9', DEFAULT_COMPRESSION.encodings)).toBe('identity');
    expect(negotiateEncoding(undefined, DEFAULT_COMPRESSION.encodings)).toBe('identity');
    expect(isCompressibleType('application/javascript')).toBe(true);
    expect(isCompressibleType('image/png')).toBe(false);
    expect(isCompressibleType('font/woff2')).toBe(false);
  });
});

// ─── Work done after the peer has gone ───────────────────────────────────
//
// The same gate `finish()` in http-router.ts needed, for the same reason,
// on the path that handles the biggest bodies in the service. The measured
// cost at the top of static-compression.ts is 4.4 ms of blocked event loop
// for one uncached brotli pass over the 272 KiB graph vendor chunk — spent
// on a socket nobody is reading, for a client that only had to open a
// connection with `Accept-Encoding: br` and reset it.

describe('sendStaticBuffer() with a peer that has already disconnected', () => {
  function recordingRes(destroyed: boolean): {
    calls: Array<[string, unknown]>;
    res: http.ServerResponse;
  } {
    const calls: Array<[string, unknown]> = [];
    const headers = new Map<string, string>();
    const res = {
      destroyed,
      headersSent: false,
      setHeader: (k: string, v: string) => {
        headers.set(k.toLowerCase(), String(v));
        calls.push(['setHeader', [k, v]]);
      },
      getHeader: (k: string) => headers.get(k.toLowerCase()),
      writeHead: (code: number) => calls.push(['writeHead', code]),
      end: (body?: unknown) => calls.push(['end', body]),
      write: () => true,
    } as unknown as http.ServerResponse;
    return { calls, res };
  }

  const brotliReq = {
    url: '/assets/vendor-graph.js',
    headers: { 'accept-encoding': 'br' },
  } as unknown as http.IncomingMessage;

  /** Big enough to be worth compressing and to make the cost visible. */
  const asset = Buffer.from('a'.repeat(256 * 1024), 'utf8');
  const assetHeaders = new Map<string, string>([['content-type', 'application/javascript']]);

  it('writes nothing at all for a destroyed socket', () => {
    const { calls, res } = recordingRes(true);

    sendStaticBuffer(brotliReq, res, 200, asset, assetHeaders, DEFAULT_COMPRESSION);

    // Not even the asset's own headers: the whole call is a no-op.
    expect(calls).toEqual([]);
  });

  it('still compresses and writes for a peer that is still connected', () => {
    const { calls, res } = recordingRes(false);

    sendStaticBuffer(brotliReq, res, 200, asset, assetHeaders, DEFAULT_COMPRESSION);

    const set = calls.filter(([k]) => k === 'setHeader').map(([, v]) => v as [string, string]);
    expect(set.some(([k, v]) => k.toLowerCase() === 'content-encoding' && v === 'br')).toBe(true);
    expect(calls.some(([k]) => k === 'end')).toBe(true);
  });
});
