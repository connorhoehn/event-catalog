// tests/compression-negotiation.test.ts
//
// Content-coding negotiation, in isolation. Every case here is a way to
// hand a client bytes it cannot decode — which is strictly worse than
// sending it a large body — so the matrix is exhaustive rather than
// representative.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMPRESSION,
  DEFAULT_COMPRESSION_THRESHOLD,
  chooseCompression,
  compressBody,
  isCompressibleType,
  negotiateEncoding,
  parseAcceptEncoding,
  parseBooleanFlag,
  type Encoding,
} from '../src/server/compression.js';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

describe('parseAcceptEncoding()', () => {
  it('defaults an unqualified token to q=1', () => {
    expect(parseAcceptEncoding('gzip')).toEqual([{ token: 'gzip', q: 1 }]);
  });

  it('reads qvalues and lowercases tokens', () => {
    expect(parseAcceptEncoding('GZIP;q=0.5, Deflate;q=0.25')).toEqual([
      { token: 'gzip', q: 0.5 },
      { token: 'deflate', q: 0.25 },
    ]);
  });

  it('treats an unparseable qvalue as q=0 rather than guessing q=1', () => {
    // Guessing "yes, compress" from junk is the failure mode that
    // produces an unreadable response.
    expect(parseAcceptEncoding('gzip;q=banana')).toEqual([{ token: 'gzip', q: 0 }]);
    expect(parseAcceptEncoding('gzip;q=2')).toEqual([{ token: 'gzip', q: 0 }]);
    expect(parseAcceptEncoding('gzip;q=-1')).toEqual([{ token: 'gzip', q: 0 }]);
  });

  it('ignores non-q parameters and empty elements', () => {
    expect(parseAcceptEncoding('gzip;foo=bar, , deflate')).toEqual([
      { token: 'gzip', q: 1 },
      { token: 'deflate', q: 1 },
    ]);
  });
});

describe('negotiateEncoding()', () => {
  const cases: Array<[header: string | undefined, expected: Encoding, why: string]> = [
    // ── the must-not-compress column ────────────────────────────────────
    [undefined, 'identity', 'no header at all — client expressed no preference'],
    ['', 'identity', 'empty header means only identity is acceptable'],
    ['   ', 'identity', 'whitespace-only header is an empty header'],
    ['identity', 'identity', 'identity named alone'],
    ['identity;q=1, gzip;q=0', 'identity', 'gzip explicitly refused'],
    ['gzip;q=0', 'identity', 'the only coding offered is refused'],
    ['gzip;q=0, br;q=0, deflate;q=0', 'identity', 'every coding refused'],
    ['identity;q=1, gzip;q=0.5', 'identity', 'client prefers identity on quality'],
    ['compress, zstd', 'identity', 'only codings this server cannot produce'],
    ['identity;q=0', 'identity', 'nothing acceptable at all — 406 territory, we stay safe'],
    [
      'gzip;q=0.001',
      'identity',
      'identity is acceptable by default at q=1, so a barely-tolerated gzip loses',
    ],

    // ── the compress column ─────────────────────────────────────────────
    ['gzip', 'gzip', 'the classic'],
    ['x-gzip', 'gzip', 'historical alias'],
    ['gzip, deflate', 'gzip', 'gzip preferred over deflate'],
    ['deflate', 'deflate', 'deflate alone'],
    ['gzip, deflate, br', 'br', 'br preferred — smaller AND cheaper here'],
    ['br;q=0.5, gzip;q=1', 'gzip', 'quality beats server preference'],
    ['*', 'br', 'wildcard admits everything; server preference decides'],
    ['identity;q=0, gzip', 'gzip', 'identity refused, gzip offered'],
    ['GZIP', 'gzip', 'tokens are case-insensitive'],
    ['gzip;q=1.000, br;q=1.0', 'br', 'three-decimal qvalues parse'],
    ['*;q=0, gzip', 'gzip', 'wildcard zero, gzip named explicitly'],
    [
      '*;q=1, gzip;q=0',
      'br',
      'the explicit q=0 rules out gzip only — the wildcard still admits br',
    ],
  ];

  for (const [header, expected, why] of cases) {
    it(`${JSON.stringify(header)} -> ${expected} (${why})`, () => {
      expect(negotiateEncoding(header)).toBe(expected);
    });
  }

  it('honors a restricted `available` list', () => {
    expect(negotiateEncoding('gzip, deflate, br', ['gzip'])).toBe('gzip');
    expect(negotiateEncoding('br', ['gzip', 'deflate'])).toBe('identity');
  });

  it('a wildcard q=0 with no explicit token forbids compression', () => {
    // `*;q=0` rules out every coding it does not name — but identity is
    // still acceptable because we never let it fall below "usable".
    expect(negotiateEncoding('*;q=0')).toBe('identity');
  });
});

describe('isCompressibleType()', () => {
  it('compresses JSON, text and the structured suffixes', () => {
    for (const t of [
      'application/json',
      'application/json; charset=utf-8',
      'text/plain; version=0.0.4; charset=utf-8',
      'text/html',
      'text/csv',
      'application/xml',
      'application/problem+json',
      'application/atom+xml',
      'image/svg+xml',
      'application/javascript',
    ]) {
      expect(isCompressibleType(t), t).toBe(true);
    }
  });

  it('never compresses a stream or an already-compressed payload', () => {
    for (const t of [
      'text/event-stream',
      'image/png',
      'image/jpeg',
      'video/mp4',
      'audio/mpeg',
      'font/woff2',
      'application/zip',
      'application/gzip',
      'application/octet-stream',
      'application/pdf',
      'application/wasm',
      undefined,
      '',
    ]) {
      expect(isCompressibleType(t), String(t)).toBe(false);
    }
  });
});

describe('chooseCompression()', () => {
  const cfg = DEFAULT_COMPRESSION;

  it('declines below the threshold and accepts at it', () => {
    const t = DEFAULT_COMPRESSION_THRESHOLD;
    expect(chooseCompression(cfg, 'gzip', 'application/json', t - 1)).toBeNull();
    expect(chooseCompression(cfg, 'gzip', 'application/json', t)).toBe('gzip');
  });

  it('declines when negotiation landed on identity', () => {
    expect(chooseCompression(cfg, 'identity', 'application/json', 100_000)).toBeNull();
  });

  it('declines for a stream or a compressed media type however large', () => {
    expect(chooseCompression(cfg, 'gzip', 'text/event-stream', 100_000)).toBeNull();
    expect(chooseCompression(cfg, 'gzip', 'image/png', 100_000)).toBeNull();
  });

  it('declines entirely when the policy is disabled', () => {
    const off = { ...cfg, enabled: false };
    expect(chooseCompression(off, 'gzip', 'application/json', 100_000)).toBeNull();
  });
});

describe('compressBody() round-trips', () => {
  // ~40 KiB of realistic repetitive JSON — the shape this API actually
  // serves.
  const payload = Buffer.from(
    JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({
        name: `pipeline:step:${i}:completed`,
        namespace: 'pipeline',
        transport: 'signal',
        producer: 'distributed-core',
        schema: { type: 'object', properties: { stepId: { type: 'string' } } },
      })),
    ),
    'utf8',
  );

  it('gzip decompresses to the identical bytes', () => {
    const out = compressBody(payload, 'gzip', 6);
    expect(out.length).toBeLessThan(payload.length / 4);
    expect(gunzipSync(out).equals(payload)).toBe(true);
  });

  it('deflate decompresses to the identical bytes', () => {
    const out = compressBody(payload, 'deflate', 6);
    expect(inflateSync(out).equals(payload)).toBe(true);
  });

  it('brotli decompresses to the identical bytes', () => {
    const out = compressBody(payload, 'br', 6);
    expect(brotliDecompressSync(out).equals(payload)).toBe(true);
  });

  it('identity is the input buffer untouched', () => {
    expect(compressBody(payload, 'identity', 6)).toBe(payload);
  });
});

describe('parseBooleanFlag()', () => {
  it('accepts the obvious spellings', () => {
    for (const t of ['true', 'TRUE', '1', 'yes', 'on', ' On ']) {
      expect(parseBooleanFlag(t)).toEqual({ ok: true, value: true });
    }
    for (const f of ['false', '0', 'no', 'off']) {
      expect(parseBooleanFlag(f)).toEqual({ ok: true, value: false });
    }
  });

  it('rejects anything else instead of guessing', () => {
    expect(parseBooleanFlag('maybe').ok).toBe(false);
    expect(parseBooleanFlag('').ok).toBe(false);
  });
});
