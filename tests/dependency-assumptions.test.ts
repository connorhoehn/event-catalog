/**
 * Executable pin of the `distributed-core` behaviors this repo works around.
 *
 * Every assertion here documents a workaround we carry. If an upgrade to
 * distributed-core FIXES one of these, the corresponding test fails — that is
 * the signal to delete our workaround, not to "fix" the test. If an upgrade
 * CHANGES one in a way we did not expect, it fails here rather than silently
 * in production (a dropped Prometheus scrape, an unenforced discriminator).
 *
 * Verified against distributed-core pinned at
 * b6f38f57b781a8bf74ff9e31a35b6062f7193dc9 (package.json version 0.42.1;
 * the packed tarball's version field reads 0.42.0, but dist/ is byte-identical
 * to that SHA).
 *
 * Each failing test's message says what to do about it.
 */

import { describe, it, expect } from 'vitest';
import { JsonSchemaValidator } from 'distributed-core/messaging-queue';
import { MetricsRegistry, formatPrometheus } from 'distributed-core/monitoring';
import { CircuitBreaker } from 'distributed-core/transport';
import * as dcServer from 'distributed-core/server';

// ───────────────────────────────────────────────────────────────────────────
// 1. JsonSchemaValidator — no ajv, so `const` and `format` are inert
// ───────────────────────────────────────────────────────────────────────────

describe('distributed-core JsonSchemaValidator', () => {
  const validator = new JsonSchemaValidator({ mode: 'fallback' });

  it('pins fallback semantics even with AJV available through the queue package', () => {
    expect(require.resolve('ajv')).toBeTruthy();
    expect(validator.validate({ type: 'string', format: 'email' }, 'not-an-email').ok).toBe(true);
    expect(validator.validate({ type: 'number' }, 'wrong-type').ok).toBe(false);
  });

  it('ignores `const` entirely — this is why our declarations use `enum` for discriminators', () => {
    const result = validator.validate(
      { type: 'object', properties: { type: { const: 'a' } } },
      { type: 'DEFINITELY_NOT_A' },
    );
    expect(
      result.ok,
      '`const` is now enforced. Discriminators declared as single-value `enum` ' +
        'may be rewritten as `const`, and LVS-style `const` discriminators now actually gate.',
    ).toBe(true);
  });

  it('enforces `enum`, which is the keyword we substituted for `const`', () => {
    const result = validator.validate(
      { type: 'object', properties: { type: { enum: ['a'] } } },
      { type: 'DEFINITELY_NOT_A' },
    );
    expect(result.ok).toBe(false);
  });

  it('ignores `format` — `format: "email"`/`"uuid"` in a declaration enforces nothing', () => {
    const result = validator.validate({ type: 'string', format: 'email' }, 'not-an-email');
    expect(
      result.ok,
      '`format` is now enforced. Declarations carrying `format` gained teeth — ' +
        'existing payloads that were silently passing may start failing validation.',
    ).toBe(true);
  });

  it('supports exactly this keyword set — the schema-evolution gate is scoped to it', () => {
    // Our evolution gate deliberately declines to gate on keywords the
    // validator ignores: tightening a keyword that enforces nothing is not a
    // breaking change. If this set GROWS, that judgement must be revisited.
    const enforced: Record<string, { schema: unknown; bad: unknown }> = {
      type: { schema: { type: 'string' }, bad: 123 },
      enum: { schema: { enum: ['a'] }, bad: 'b' },
      pattern: { schema: { type: 'string', pattern: '^a$' }, bad: 'b' },
      minLength: { schema: { type: 'string', minLength: 2 }, bad: 'a' },
      maxLength: { schema: { type: 'string', maxLength: 1 }, bad: 'ab' },
      minimum: { schema: { type: 'number', minimum: 5 }, bad: 1 },
      maximum: { schema: { type: 'number', maximum: 5 }, bad: 9 },
      minItems: { schema: { type: 'array', minItems: 2 }, bad: [1] },
      maxItems: { schema: { type: 'array', maxItems: 1 }, bad: [1, 2] },
      required: { schema: { type: 'object', required: ['a'] }, bad: {} },
      additionalProperties: {
        schema: { type: 'object', properties: { a: {} }, additionalProperties: false },
        bad: { b: 1 },
      },
    };

    const ignored: Record<string, { schema: unknown; bad: unknown }> = {
      const: { schema: { const: 'a' }, bad: 'b' },
      format: { schema: { type: 'string', format: 'email' }, bad: 'nope' },
      oneOf: { schema: { oneOf: [{ type: 'string' }, { type: 'number' }] }, bad: { o: 1 } },
      anyOf: { schema: { anyOf: [{ type: 'string' }] }, bad: { o: 1 } },
      allOf: { schema: { allOf: [{ type: 'string' }] }, bad: { o: 1 } },
      not: { schema: { not: { type: 'string' } }, bad: 'a-string' },
      multipleOf: { schema: { type: 'number', multipleOf: 5 }, bad: 7 },
      uniqueItems: { schema: { type: 'array', uniqueItems: true }, bad: [1, 1] },
      exclusiveMinimum: { schema: { type: 'number', exclusiveMinimum: 5 }, bad: 5 },
      exclusiveMaximum: { schema: { type: 'number', exclusiveMaximum: 5 }, bad: 5 },
      minProperties: { schema: { type: 'object', minProperties: 2 }, bad: {} },
      maxProperties: { schema: { type: 'object', maxProperties: 1 }, bad: { a: 1, b: 2 } },
      patternProperties: {
        schema: { type: 'object', patternProperties: { '^a$': { type: 'string' } } },
        bad: { a: 123 },
      },
      dependentRequired: {
        schema: { type: 'object', dependentRequired: { a: ['b'] } },
        bad: { a: 1 },
      },
    };

    const nowIgnored = Object.entries(enforced)
      .filter(([, c]) => validator.validate(c.schema, c.bad).ok)
      .map(([k]) => k);
    expect(
      nowIgnored,
      `Keywords that USED to be enforced are now ignored: ${nowIgnored.join(', ')}. ` +
        'Validation got weaker — declarations relying on these no longer gate.',
    ).toEqual([]);

    const nowEnforced = Object.entries(ignored)
      .filter(([, c]) => !validator.validate(c.schema, c.bad).ok)
      .map(([k]) => k);
    expect(
      nowEnforced,
      `The validator's keyword set GREW: ${nowEnforced.join(', ')} now enforce. ` +
        'The schema-evolution gate deliberately skips keywords the validator ignores — ' +
        'that scoping must be widened to cover these, or tightening them silently breaks producers.',
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. formatPrometheus — label values are interpolated with zero escaping
// ───────────────────────────────────────────────────────────────────────────

describe('distributed-core formatPrometheus', () => {
  const render = (labels: Record<string, string>): string => {
    const registry = new MetricsRegistry({ nodeId: 'test-node' });
    registry.counter('ec_test', labels).inc();
    return formatPrometheus(registry.getSnapshot());
  };

  it('does NOT escape a double quote in a label value — one bad event name breaks the whole scrape', () => {
    // `evt"x` renders as ec_test{event="evt"x"}, which Prometheus rejects, and
    // a rejected line fails the ENTIRE scrape — not just that series. This is
    // why prom-metrics.ts escapes and length-bounds label values itself.
    const out = render({ event: 'evt"x' });
    expect(
      out.includes('event="evt"x"'),
      'formatPrometheus now escapes quotes. Our own escaping in prom-metrics.ts is ' +
        'redundant — but check for DOUBLE-escaping before deleting it.',
    ).toBe(true);
    expect(out).not.toContain('event="evt\\"x"');
  });

  it('does NOT escape a backslash in a label value', () => {
    const out = render({ event: 'a\\b' });
    expect(out).toContain('event="a\\b"');
  });

  it('does NOT escape a newline in a label value — it emits a raw line break mid-series', () => {
    const out = render({ event: 'line\nbreak' });
    expect(
      out.includes('event="line\nbreak"'),
      'formatPrometheus now escapes newlines. Our escaping may be redundant.',
    ).toBe(true);
  });

  it('does NOT bound label-value length — cardinality/size control is ours to do', () => {
    const long = 'x'.repeat(4096);
    expect(render({ event: long })).toContain(`event="${long}"`);
  });

  it('emits label keys sorted ascending — any cached prefix we build must match byte-for-byte', () => {
    // Upstream rebuilds an identical label string for every series on every
    // scrape (Object.keys().sort().map().join()). We cache the prefix instead.
    // The cache is only correct while upstream's ordering stays sorted-ascending.
    const out = render({ zeta: '1', alpha: '2', mid: '3' });
    expect(out).toContain('{alpha="2",mid="3",zeta="1"}');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. MetricsRegistry — repeated (name, labels) returns the EXISTING handle
// ───────────────────────────────────────────────────────────────────────────

describe('distributed-core MetricsRegistry', () => {
  it('returns the SAME handle for a repeated (name, labels) key rather than a fresh one', () => {
    // This is what silently broke MetricsCollector.reset(): re-requesting a
    // counter after a reset hands back the already-registered instance, so a
    // collector that rebuilds its handles keeps writing to the old series.
    const registry = new MetricsRegistry({ nodeId: 'test-node' });
    const first = registry.counter('ec_dup', { k: 'v' });
    const second = registry.counter('ec_dup', { k: 'v' });
    expect(
      first === second,
      'MetricsRegistry now hands back a FRESH handle for a repeated key. ' +
        'Any code that relied on getting the existing instance back (and any ' +
        'reset() workaround built around it) needs re-checking.',
    ).toBe(true);
  });

  it('throws when the same name is re-registered as a different metric type', () => {
    const registry = new MetricsRegistry({ nodeId: 'test-node' });
    registry.counter('ec_kind', { k: 'v' });
    expect(() => registry.gauge('ec_kind', { k: 'v' })).toThrow(/already registered/);
  });

  it('reset() zeroes values but KEEPS every series registered', () => {
    // reset() is not "start over": the series stay in the snapshot at 0, and
    // the handles stay live. A collector cannot use it to drop stale series.
    const registry = new MetricsRegistry({ nodeId: 'test-node' });
    registry.counter('ec_reset', { k: 'v' }).inc();
    expect(registry.getSnapshot().metrics).toHaveLength(1);

    registry.reset();
    const after = registry.getSnapshot().metrics;
    expect(
      after,
      'reset() now drops series instead of zeroing them. MetricsCollector.reset() ' +
        'assumptions change — re-check what survives a reset.',
    ).toHaveLength(1);
    expect(after[0]).toMatchObject({ name: 'ec_reset', value: 0 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. AdmissionHttpServer / serveStatic — no compression support
// ───────────────────────────────────────────────────────────────────────────

describe('distributed-core server transport', () => {
  it('exports serveStatic and AdmissionHttpServer from the /server subpath', () => {
    expect(typeof dcServer.serveStatic).toBe('function');
    expect(typeof dcServer.AdmissionHttpServer).toBe('function');
  });

  it('serveStatic takes no compression option — this is why we wrap it in a Proxy', () => {
    // ServeStaticOptions is { staticDir, mimeOverrides?, maxAgeSeconds? }.
    // There is no gzip/brotli hook, and AdmissionHttpServerConfig has no
    // compression field either, so we intercept the response ourselves.
    const handler = dcServer.serveStatic({ staticDir: __dirname });
    expect(typeof handler).toBe('function');

    const headers: Record<string, unknown> = {};
    const req = { url: '/no-such-file-here.txt', headers: { 'accept-encoding': 'gzip, br' } };
    const res = {
      writeHead(status: number, h?: Record<string, unknown>) {
        Object.assign(headers, h ?? {});
        return this;
      },
      setHeader(k: string, v: unknown) {
        headers[k] = v;
      },
      end() {
        return this;
      },
    };

    handler(req as never, res as never);

    const encodingHeader = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'content-encoding',
    );
    expect(
      encodingHeader,
      'serveStatic now negotiates Content-Encoding itself. The compression Proxy ' +
        'wrapper is redundant and may now double-compress — remove it.',
    ).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. CircuitBreaker defaults — we rely on them in SignalTransport
// ───────────────────────────────────────────────────────────────────────────

describe('distributed-core CircuitBreaker', () => {
  it('defaults successThreshold and halfOpenMaxCalls to the same value', () => {
    // src/client/signal.ts constructs a CircuitBreaker without setting either.
    // The v0.42.2 half-open deadlock only bites when successThreshold >
    // halfOpenMaxCalls, so equal defaults mean we were never exposed to it.
    // If a future version raises successThreshold above halfOpenMaxCalls, the
    // signal-redis breaker can wedge open — this test catches that.
    const breaker = new CircuitBreaker({ name: 'assumption-probe' }) as unknown as {
      options: { successThreshold: number; halfOpenMaxCalls: number };
    };
    const { successThreshold, halfOpenMaxCalls } = breaker.options;

    expect(typeof successThreshold).toBe('number');
    expect(typeof halfOpenMaxCalls).toBe('number');
    expect(
      successThreshold <= halfOpenMaxCalls,
      `Default successThreshold (${successThreshold}) now exceeds halfOpenMaxCalls ` +
        `(${halfOpenMaxCalls}). SignalTransport's breaker (src/client/signal.ts) sets ` +
        'neither, so it can now deadlock in HALF_OPEN. Set them explicitly.',
    ).toBe(true);
  });
});
