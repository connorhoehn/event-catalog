// tests/robustness-hostile-input.test.ts
//
// Hostile-input sweep over the two surfaces that accept operator-supplied
// JSON Schema: `POST /api/events`, `POST /api/events/bulk`, and the
// `Registry.declare` they both funnel into.
//
// tests/security-input-limits.test.ts bounds *how many* things one request
// creates. This file bounds *what one thing can be*: how deep, how wide,
// how long its strings are, what its keys are called, and — the one that
// is not a size at all — what a caller-supplied `pattern` costs to run.
//
// The rule for every case here is the same: a request must either be
// rejected cleanly or accepted at a cost proportional to its size.
// "Costs a stack unwind and returns a message naming nothing" is a
// failure even when the status code happens to be 400.
//
// Whole-file runtime is ~1.5s, nearly all of it the two deliberate
// measurements (100 000-key object, catastrophic-backtracking regex).
// Both timing assertions are ratios or ceilings with three orders of
// magnitude of margin, measured in-process so machine speed cancels — a
// loaded CI box cannot flake them.

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { stableStringify, computeSchemaFingerprint } from '../src/registry/fingerprint.js';
import { validateSchemaShape } from '../src/registry/schema-shape.js';
import { MAX_SCHEMA_DEPTH } from '../src/server/routes/limits.js';
import { allDeclarations } from '../src/declarations/index.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeApp() {
  const registry = new Registry();
  const app = expressLikeApp();
  app.use(
    '/api',
    createRoutes({
      registry,
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
      dlqStore: {
        list: async () => [],
        remove: async () => true,
        findById: async () => null,
        put: async () => ({}),
      } as unknown as RoutesDeps['dlqStore'],
      startedAt: Date.now(),
    }),
  );
  return { app, registry };
}

/** `{"not":{"not":...{"type":"object"}}}` — 8 body bytes per level. */
function nested(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = { type: 'object' };
  for (let i = 0; i < levels; i++) node = { not: node };
  return node;
}

/** Nesting depth of a JSON value, counting the root as level 1. */
function depthOf(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  let deepest = 0;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const d = depthOf((value as Record<string, unknown>)[key]);
    if (d > deepest) deepest = d;
  }
  return deepest + 1;
}

/** Elapsed wall-clock ms for `fn`, in-process so load affects both sides. */
function elapsed(fn: () => void): number {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// ---------------------------------------------------------------------------
// 1. Nesting depth — the dimension the 1 MiB body cap does not bound
// ---------------------------------------------------------------------------

describe('nesting depth', () => {
  it('MAX_SCHEMA_DEPTH leaves an order of magnitude over the deepest real declaration', () => {
    let deepest = 0;
    let deepestName = '';
    for (const decl of allDeclarations) {
      const d = depthOf(decl.schema);
      if (d > deepest) { deepest = d; deepestName = decl.name; }
    }
    // Pins the ceiling to reality rather than to a guess. If a real
    // declaration ever gets within 4x of the limit, this fails and the
    // limit gets re-argued instead of silently rejecting a valid schema.
    expect(deepest, `deepest real declaration is "${deepestName}"`).toBeGreaterThan(0);
    expect(deepest * 4).toBeLessThan(MAX_SCHEMA_DEPTH);
  });

  it('stableStringify accepts exactly MAX_SCHEMA_DEPTH levels', () => {
    // nested(n) wraps n times around a leaf object, so total depth = n + 1.
    expect(() => stableStringify(nested(MAX_SCHEMA_DEPTH - 1))).not.toThrow();
  });

  it('stableStringify rejects past the limit with a plain Error, not a RangeError', () => {
    let thrown: unknown;
    try { stableStringify(nested(MAX_SCHEMA_DEPTH)); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toMatch(/nests deeper than the maximum of 100 levels/);
    // Actionable: names the dimension and what to do about it.
    expect((thrown as Error).message).toMatch(/flatten the schema/);
  });

  it('computeSchemaFingerprint inherits the guard', () => {
    expect(() => computeSchemaFingerprint(nested(MAX_SCHEMA_DEPTH))).toThrow(/nests deeper/);
    expect(computeSchemaFingerprint(nested(5))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejecting a deep body costs no more than accepting a shallow one', () => {
    // The point of the limit: work is bounded by the limit, not by the
    // size of the input. A 100 000-level body must not cost 1000x a
    // 100-level one — it must cost the same, because the walk stops at
    // MAX_SCHEMA_DEPTH either way.
    const shallow = nested(MAX_SCHEMA_DEPTH);
    const enormous = nested(100_000);
    const tShallow = elapsed(() => { try { stableStringify(shallow); } catch { /* expected */ } });
    const tEnormous = elapsed(() => { try { stableStringify(enormous); } catch { /* expected */ } });
    // 50x margin over "identical"; the pre-fix behaviour was a full
    // 100 000-frame descent and unwind.
    expect(tEnormous).toBeLessThan(Math.max(tShallow, 0.05) * 50 + 25);
  });

  it('POST /api/events rejects a deep schema with 400 and an actionable message', async () => {
    const { app, registry } = makeApp();
    const res = await request(app).post('/api/events').send({
      name: 'deep.event',
      transport: 'signal',
      producer: 'attacker',
      schema: nested(500),
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/nests deeper than the maximum of 100 levels/);
    expect(registry.get('deep.event')).toBeUndefined();
  });

  it('POST /api/events never 5xxs on a body deep enough to exhaust the stack', async () => {
    // 60 000 levels is 480 KB — comfortably inside the 1 MiB body cap,
    // and past the depth at which `validateSchemaShape` (still recursive,
    // still unguarded — see the note in src/server/routes/limits.ts)
    // throws RangeError. `Registry.declare` runs it before the
    // fingerprint, so the depth guard added to stableStringify does not
    // get a chance to speak; the route's try/catch is what keeps this a
    // 400 rather than a 500. The status is the contract here; the
    // message is not yet, which is the remaining gap.
    //
    // Body is hand-assembled rather than JSON.stringify'd: supertest's
    // own serializer is recursive and blows its stack on this input
    // before the request is ever sent.
    const levels = 60_000;
    const raw = '{"name":"very.deep.event","transport":"signal","producer":"attacker","schema":'
      + '{"not":'.repeat(levels) + '{"type":"object"}' + '}'.repeat(levels)
      + '}';
    expect(raw.length).toBeLessThan(1_048_576);

    const { app, registry } = makeApp();
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(registry.get('very.deep.event')).toBeUndefined();
  });

  it('validateSchemaShape is the one walker still without a depth guard', () => {
    // Recorded rather than asserted-fixed: schema-shape.ts is outside
    // this change's file ownership. It survives ~6900 levels and then
    // throws RangeError — a full stack unwind per request, from a body
    // an order of magnitude inside the 1 MiB cap. If a depth guard is
    // added there, this test flips and should be replaced with the
    // clean-rejection assertion above.
    expect(validateSchemaShape(nested(MAX_SCHEMA_DEPTH)).ok).toBe(true);
    expect(() => validateSchemaShape(nested(60_000))).toThrow(RangeError);
  });

  it('POST /api/events/bulk skips a deep entry and declares its neighbours', async () => {
    const { app, registry } = makeApp();
    const res = await request(app).post('/api/events/bulk').send({
      serviceName: 'attacker',
      events: [
        { name: 'ok.before', transport: 'signal', schema: { type: 'object' } },
        { name: 'bulk.deep', transport: 'signal', schema: nested(500) },
        { name: 'ok.after', transport: 'signal', schema: { type: 'object' } },
      ],
    });
    expect(res.status).toBeLessThan(300);
    expect(registry.get('bulk.deep')).toBeUndefined();
    expect(registry.get('ok.before')).toBeDefined();
    expect(registry.get('ok.after')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Width and string length — bounded by the body cap, cost stays linear
// ---------------------------------------------------------------------------

describe('width and string length', () => {
  it('a 100 000-key properties map costs time proportional to its size', () => {
    // 2.6 MB serialized — past the 1 MiB body cap, so this is only
    // reachable from the library declare path. Included because the
    // question is whether cost is linear, not whether it is reachable.
    const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < 100_000; i++) properties['k' + i] = { type: 'string' };
    const schema = { type: 'object', properties };

    const registry = new Registry();
    const t = elapsed(() => {
      registry.declare({ name: 'wide.event', schema, transport: 'signal', producer: 'p' });
    });
    // Measured ~100ms for shape-check + sort + sha256 + persist. A 10s
    // ceiling is 100x margin: it catches an accidental O(n²) (which would
    // be minutes at this width) without flaking on a loaded box.
    expect(t).toBeLessThan(10_000);
    expect(registry.get('wide.event')?.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('900 KB strings in description, pattern and enum are accepted cheaply', () => {
    const huge = 'a'.repeat(900_000);
    for (const schema of [
      { type: 'string', description: huge },
      { type: 'string', pattern: huge },
      { enum: [huge] },
    ]) {
      const registry = new Registry();
      const t = elapsed(() => {
        registry.declare({ name: 'big.event', schema, transport: 'signal', producer: 'p' });
      });
      // A long string is hashed once; nothing here is quadratic in length.
      expect(t).toBeLessThan(5_000);
      expect(registry.get('big.event')?.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Catastrophic-backtracking `pattern` — UNFIXED, characterised here
// ---------------------------------------------------------------------------

describe('caller-supplied regex pattern (ReDoS)', () => {
  it('declare accepts a catastrophic pattern without running it', () => {
    // Declaring is cheap: nothing compiles or executes the pattern at
    // declare time, so the catalog stores the weapon without noticing.
    const registry = new Registry();
    const t = elapsed(() => {
      registry.declare({
        name: 'redos.event',
        schema: { type: 'object', required: ['s'], properties: { s: { type: 'string', pattern: '^(a+)+$' } } },
        transport: 'signal',
        producer: 'attacker',
      });
    });
    expect(t).toBeLessThan(1_000);
    expect(registry.get('redos.event')).toBeDefined();
  });

  it('validating a 29-byte payload against it costs orders of magnitude more than a benign pattern', () => {
    // This is the disproportion. Both halves run in this process under
    // whatever load the machine is under, so the RATIO is the assertion —
    // machine speed and CI contention cancel out.
    const registry = new Registry();
    registry.declare({
      name: 'redos.evil',
      schema: { type: 'object', required: ['s'], properties: { s: { type: 'string', pattern: '^(a+)+$' } } },
      transport: 'signal',
      producer: 'attacker',
    });
    registry.declare({
      name: 'redos.benign',
      schema: { type: 'object', required: ['s'], properties: { s: { type: 'string', pattern: '^a+$' } } },
      transport: 'signal',
      producer: 'ops',
    });

    // 22 a's + a non-matching tail: ~2^22 backtracking steps. Kept small
    // deliberately — 30 a's is 5.4 seconds on this machine, which is the
    // finding, not something to pay for on every test run.
    const payload = { s: 'a'.repeat(22) + '!' };
    expect(JSON.stringify(payload).length).toBeLessThan(40);

    let evilResult: ReturnType<typeof registry.validate> | undefined;
    const tBenign = Math.max(elapsed(() => { registry.validate('redos.benign', payload); }), 0.001);
    const tEvil = elapsed(() => { evilResult = registry.validate('redos.evil', payload); });

    // Measured ratio is ~10 000x. Asserting only 100x leaves two orders
    // of magnitude of headroom, so this fails only if a future runtime
    // (or a fix in this repo) actually removes the backtracking blowup —
    // in which case the finding below should be re-read, not the
    // threshold lowered.
    expect(
      tEvil / tBenign,
      `evil=${tEvil.toFixed(1)}ms benign=${tBenign.toFixed(3)}ms — if this ratio collapsed, ReDoS may be fixed`,
    ).toBeGreaterThan(100);

    // And the payload is still correctly rejected — the cost buys nothing.
    expect(evilResult?.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Prototype-shaped keys, at every nesting level
// ---------------------------------------------------------------------------

describe('__proto__ / constructor / prototype keys', () => {
  // Built via JSON.parse, not object literals: `{"__proto__": x}` in JS
  // source sets the prototype, while JSON.parse creates a real own
  // property. The HTTP path is JSON.parse, so this is the honest input.
  const withProto = (json: string): Record<string, unknown> =>
    JSON.parse(json) as Record<string, unknown>;

  it('a __proto__ key at any depth changes the fingerprint', () => {
    // The regression this guards: `out['__proto__'] = v` on a normal
    // object hits Object.prototype's setter instead of creating an own
    // property, so the key vanished from the serialization. Two
    // materially different schemas then hashed identically — a silent
    // collision in the primitive that drift detection and pinned
    // consumer manifests are both built on.
    const cases: Array<[string, string]> = [
      ['root', '{"__proto__":{"x":1},"type":"object"}'],
      ['properties', '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"number"}}}'],
      ['three deep', '{"properties":{"a":{"properties":{"__proto__":{"type":"string"}}}}}'],
      ['inside items', '{"items":{"properties":{"__proto__":{"type":"string"}}}}'],
      ['inside an array', '{"oneOf":[{"__proto__":{"x":1}},{"type":"null"}]}'],
    ];
    for (const [where, json] of cases) {
      const polluted = withProto(json);
      const clean = JSON.parse(json.replace(/"__proto__"/g, '"benign"')) as Record<string, unknown>;
      expect(
        computeSchemaFingerprint(polluted),
        `__proto__ at ${where} must not hash the same as a schema without it`,
      ).not.toBe(computeSchemaFingerprint(clean));
      expect(stableStringify(polluted)).toContain('__proto__');
    }
  });

  it('constructor and prototype keys also survive serialization', () => {
    const s = withProto('{"properties":{"constructor":{"type":"string"},"prototype":{"type":"number"}}}');
    const out = stableStringify(s);
    expect(out).toContain('constructor');
    expect(out).toContain('prototype');
  });

  it('nothing on the declare path pollutes Object.prototype', () => {
    const { registry } = makeApp();
    const schema = withProto('{"properties":{"__proto__":{"polluted":true,"type":"string"}}}');
    registry.declare({ name: 'proto.event', schema, transport: 'signal', producer: 'attacker' });
    stableStringify(schema);
    computeSchemaFingerprint(schema);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).type).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('an event NAMED __proto__ is refused, but a PROPERTY named __proto__ is fine', async () => {
    const { app } = makeApp();
    const refused = await request(app).post('/api/events').send({
      name: '__proto__', transport: 'signal', producer: 'attacker', schema: { type: 'object' },
    });
    expect(refused.status).toBe(400);

    const accepted = await request(app).post('/api/events').send({
      name: 'legit.event',
      transport: 'signal',
      producer: 'ops',
      schema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const fetched = await request(app).get('/api/events/legit.event');
    expect(fetched.body.schema.properties).toHaveProperty('__proto__');
  });
});

// ---------------------------------------------------------------------------
// 5. Malformed and duplicate JSON
// ---------------------------------------------------------------------------

describe('duplicate and conflicting JSON keys', () => {
  it('a duplicated schema key resolves last-wins and is meta-validated on that value', async () => {
    const { app, registry } = makeApp();
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      // `type` appears twice: valid first, typo'd second. JSON.parse keeps
      // the last, so the typo must be what gets rejected — not silently
      // masked by the earlier valid value.
      .send('{"name":"dup.event","transport":"signal","producer":"p","schema":{"type":"object","type":"objct"}}');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/objct/);
    expect(registry.get('dup.event')).toBeUndefined();
  });

  it('a duplicated top-level key resolves last-wins', async () => {
    const { app, registry } = makeApp();
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('{"name":"first.name","name":"second.name","transport":"signal","producer":"p","schema":{}}');
    expect(res.status).toBe(201);
    expect(registry.get('second.name')).toBeDefined();
    expect(registry.get('first.name')).toBeUndefined();
  });

  it('malformed JSON does not reach the registry', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('{"name":"broken.event",');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 6. Unicode edges
// ---------------------------------------------------------------------------

describe('unicode', () => {
  it('a lone surrogate fingerprints deterministically instead of corrupting the hash input', () => {
    // JSON.stringify is well-formed since Node 12: a lone surrogate is
    // escaped to the ASCII sequence \ud800 before it reaches sha256, so
    // the UTF-8 replacement character never enters the digest and two
    // distinct lone surrogates cannot collide.
    const a = { type: 'string', description: '\uD800' };
    const b = { type: 'string', description: '\uD801' };
    expect(computeSchemaFingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSchemaFingerprint(a)).toBe(computeSchemaFingerprint({ description: '\uD800', type: 'string' }));
    expect(computeSchemaFingerprint(a)).not.toBe(computeSchemaFingerprint(b));
    expect(stableStringify(a)).toBe('{"description":"\\ud800","type":"string"}');
  });

  it('NFC and NFD spellings are different schemas, by design', () => {
    // Documented, not incidental: the fingerprint hashes bytes, and the
    // catalog does not normalize. A consumer that normalizes its local
    // copy would see spurious drift — which is the correct signal, since
    // the two byte sequences are genuinely different on the wire.
    const nfc = 'é';        // é
    const nfd = 'é';       // e + combining acute
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'));
    expect(computeSchemaFingerprint({ description: nfc })).not.toBe(
      computeSchemaFingerprint({ description: nfd }),
    );
  });

  it('astral-plane and combining-mark keys sort stably', () => {
    // Object.keys().sort() is UTF-16 code-unit order — total and stable,
    // so surrogate pairs cannot make the fingerprint order-dependent.
    const a = { '\u{1F600}': 1, 'é': 2, z: 3 };
    const b = { z: 3, 'é': 2, '\u{1F600}': 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('an event name containing a control character is refused', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/events').send({
      name: 'evil\u0000name', transport: 'signal', producer: 'p', schema: {},
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/control characters/);
  });
});

// ---------------------------------------------------------------------------
// 7. Numeric edges
// ---------------------------------------------------------------------------

describe('numeric edges', () => {
  it('-0 fingerprints as 0 (JSON has no signed zero)', () => {
    expect(stableStringify({ minimum: -0 })).toBe('{"minimum":0}');
    expect(computeSchemaFingerprint({ minimum: -0 })).toBe(computeSchemaFingerprint({ minimum: 0 }));
  });

  it('1e308 round-trips; NaN and Infinity collapse to null', () => {
    expect(stableStringify({ maximum: 1e308 })).toBe('{"maximum":1e+308}');
    // JSON.stringify has no representation for these, so they serialize
    // as null and every one of them hashes the same. Unreachable over
    // HTTP — JSON cannot carry NaN — but a library caller that computes
    // a bound and gets NaN silently declares the same schema as one with
    // an explicit `null`. Documented so a future change is deliberate.
    expect(stableStringify({ maximum: NaN })).toBe('{"maximum":null}');
    expect(stableStringify({ maximum: Infinity })).toBe('{"maximum":null}');
    expect(computeSchemaFingerprint({ maximum: NaN })).toBe(computeSchemaFingerprint({ maximum: null }));
  });

  it('a numeric string in a numeric slot is not coerced', () => {
    // "NaN" as a string stays a string: no implicit Number() anywhere on
    // the path, so the two are distinguishable schemas.
    expect(computeSchemaFingerprint({ maximum: 'NaN' })).not.toBe(
      computeSchemaFingerprint({ maximum: null }),
    );
    expect(validateSchemaShape({ type: 'number', maximum: 'NaN' }).ok).toBe(true);
  });
});
