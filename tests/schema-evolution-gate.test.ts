// tests/schema-evolution-gate.test.ts
//
// The schema-evolution gate is the guarantee this repo sells: event-catalog
// refuses a schema change that would break an existing consumer. This file
// audits that claim keyword by keyword.
//
// The method matters. Every "breaking" case below is proved breaking against
// the validator that actually runs at publish time — the hand-rolled
// distributed-core fallback (`ajv` is not a dependency here, so the fallback
// is the real code path). `expectRealBreak()` builds a payload that the OLD
// schema accepts and the NEW schema rejects, asserts the validator agrees,
// and only then asserts that the compat gate flagged it. That keeps the gate
// honest in both directions: a rule about a keyword the validator ignores
// would be theatre, and a missing rule about one it enforces is a real hole.
//
// The keywords the fallback honours, and therefore the only ones worth
// gating on:
//   type, enum, properties, required, pattern, items,
//   additionalProperties, minimum, maximum, minLength, maxLength,
//   minItems, maxItems

import { describe, it, expect } from 'vitest';
import { JsonSchemaValidator } from 'distributed-core/messaging-queue';
import { checkBackwardCompat, checkForwardCompat } from '../src/registry/schema-compat.js';
import { Registry } from '../src/registry/index.js';

const validator = new JsonSchemaValidator({ mode: 'fallback' });

function accepts(schema: Record<string, unknown>, payload: unknown): boolean {
  return validator.validate(schema, payload).ok;
}

/**
 * Assert that `payload` demonstrates a genuine backward break — the old
 * schema accepts it, the new schema rejects it, per the real validator — and
 * that `checkBackwardCompat` flags the change.
 */
function expectRealBreak(
  oldSchema: Record<string, unknown>,
  newSchema: Record<string, unknown>,
  payload: unknown,
): string[] {
  expect(accepts(oldSchema, payload), 'old schema should accept the witness payload').toBe(true);
  expect(accepts(newSchema, payload), 'new schema should reject the witness payload').toBe(false);

  const result = checkBackwardCompat(oldSchema, newSchema);
  expect(result.compatible, `gate failed to reject: ${JSON.stringify(newSchema)}`).toBe(false);
  return result.violations;
}

/** Assert a change is accepted, and that nothing the old schema accepted breaks. */
function expectSafe(
  oldSchema: Record<string, unknown>,
  newSchema: Record<string, unknown>,
  payloads: unknown[] = [],
): void {
  for (const p of payloads) {
    expect(accepts(oldSchema, p), 'witness should be valid under old').toBe(true);
    expect(accepts(newSchema, p), 'witness should stay valid under new').toBe(true);
  }
  const result = checkBackwardCompat(oldSchema, newSchema);
  expect(result.compatible, `gate wrongly rejected: ${result.violations.join('; ')}`).toBe(true);
}

const obj = (
  properties: Record<string, unknown>,
  required?: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
  ...extra,
});

// ===========================================================================
// Breaking changes — the gate MUST reject each of these
// ===========================================================================

describe('backward gate rejects genuinely breaking changes', () => {
  it('adding a required field', () => {
    const v = expectRealBreak(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']),
      { a: 'x' },
    );
    expect(v.some((m) => /"b"/.test(m) && /required/i.test(m))).toBe(true);
  });

  it('promoting an existing optional field to required', () => {
    const v = expectRealBreak(
      obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a']),
      obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']),
      { a: 'x' },
    );
    expect(v.some((m) => /"b"/.test(m) && /became required/i.test(m))).toBe(true);
  });

  it('removing a property', () => {
    // With additionalProperties open the validator still accepts the payload,
    // so this is a contract-level break rather than a validation one: a
    // consumer reading `b` finds it undeclared. The gate reports it either way.
    const oldS = obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a']);
    const newS = obj({ a: { type: 'string' } }, ['a']);
    const result = checkBackwardCompat(oldS, newS);
    expect(result.compatible).toBe(false);
    expect(result.violations.some((m) => /"b"/.test(m) && /removed/i.test(m))).toBe(true);
  });

  it('removing a property when additionalProperties is closed (a real validation break)', () => {
    expectRealBreak(
      obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a'], { additionalProperties: false }),
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: false }),
      { a: 'x', b: 'y' },
    );
  });

  it('narrowing a type: string -> integer', () => {
    const v = expectRealBreak(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: 'integer' } }, ['a']),
      { a: 'x' },
    );
    expect(v.some((m) => /"a"/.test(m) && /narrowed/i.test(m))).toBe(true);
  });

  it('narrowing a type: number -> integer', () => {
    expectRealBreak(
      obj({ a: { type: 'number' } }, ['a']),
      obj({ a: { type: 'integer' } }, ['a']),
      { a: 1.5 },
    );
  });

  it('shrinking an enum', () => {
    const v = expectRealBreak(
      obj({ mode: { type: 'string', enum: ['a', 'b', 'c'] } }, ['mode']),
      obj({ mode: { type: 'string', enum: ['a', 'b'] } }, ['mode']),
      { mode: 'c' },
    );
    expect(v.some((m) => /enum/i.test(m))).toBe(true);
  });

  it('introducing an enum where the field was unconstrained', () => {
    expectRealBreak(
      obj({ mode: { type: 'string' } }, ['mode']),
      obj({ mode: { type: 'string', enum: ['a', 'b'] } }, ['mode']),
      { mode: 'zzz' },
    );
  });

  it('flipping additionalProperties from true to false', () => {
    const v = expectRealBreak(
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: true }),
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: false }),
      { a: 'x', extra: 1 },
    );
    expect(v.some((m) => /additionalProperties/i.test(m))).toBe(true);
  });

  it('flipping additionalProperties from absent (open) to false', () => {
    expectRealBreak(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: false }),
      { a: 'x', extra: 1 },
    );
  });

  it('constraining previously-open additionalProperties with a schema', () => {
    expectRealBreak(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: { type: 'string' } }),
      { a: 'x', extra: 1 },
    );
  });

  it('adding a pattern', () => {
    const v = expectRealBreak(
      obj({ id: { type: 'string' } }, ['id']),
      obj({ id: { type: 'string', pattern: '^evt_' } }, ['id']),
      { id: 'plain' },
    );
    expect(v.some((m) => /pattern/i.test(m))).toBe(true);
  });

  it('changing an existing pattern', () => {
    expectRealBreak(
      obj({ id: { type: 'string', pattern: '^evt_' } }, ['id']),
      obj({ id: { type: 'string', pattern: '^msg_' } }, ['id']),
      { id: 'evt_1' },
    );
  });

  it('raising a minimum', () => {
    const v = expectRealBreak(
      obj({ n: { type: 'number', minimum: 0 } }, ['n']),
      obj({ n: { type: 'number', minimum: 10 } }, ['n']),
      { n: 5 },
    );
    expect(v.some((m) => /minimum/i.test(m))).toBe(true);
  });

  it('introducing a minimum where there was none', () => {
    expectRealBreak(
      obj({ n: { type: 'number' } }, ['n']),
      obj({ n: { type: 'number', minimum: 10 } }, ['n']),
      { n: 5 },
    );
  });

  it('lowering a maximum', () => {
    expectRealBreak(
      obj({ n: { type: 'number', maximum: 100 } }, ['n']),
      obj({ n: { type: 'number', maximum: 10 } }, ['n']),
      { n: 50 },
    );
  });

  it('shrinking a maxLength', () => {
    const v = expectRealBreak(
      obj({ s: { type: 'string', maxLength: 64 } }, ['s']),
      obj({ s: { type: 'string', maxLength: 4 } }, ['s']),
      { s: 'abcdefgh' },
    );
    expect(v.some((m) => /maxLength/i.test(m))).toBe(true);
  });

  it('raising a minLength', () => {
    expectRealBreak(
      obj({ s: { type: 'string' } }, ['s']),
      obj({ s: { type: 'string', minLength: 5 } }, ['s']),
      { s: 'ab' },
    );
  });

  it('shrinking maxItems / raising minItems', () => {
    expectRealBreak(
      obj({ xs: { type: 'array', items: { type: 'string' } } }, ['xs']),
      obj({ xs: { type: 'array', items: { type: 'string' }, maxItems: 1 } }, ['xs']),
      { xs: ['a', 'b'] },
    );
    expectRealBreak(
      obj({ xs: { type: 'array', items: { type: 'string' } } }, ['xs']),
      obj({ xs: { type: 'array', items: { type: 'string' }, minItems: 3 } }, ['xs']),
      { xs: ['a'] },
    );
  });

  it("changing an array's items type", () => {
    const v = expectRealBreak(
      obj({ xs: { type: 'array', items: { type: 'string' } } }, ['xs']),
      obj({ xs: { type: 'array', items: { type: 'number' } } }, ['xs']),
      { xs: ['a'] },
    );
    expect(v.some((m) => /xs\[\]/.test(m) && /narrowed/i.test(m))).toBe(true);
  });

  it("introducing an items constraint where the array was unconstrained", () => {
    expectRealBreak(
      obj({ xs: { type: 'array' } }, ['xs']),
      obj({ xs: { type: 'array', items: { type: 'number' } } }, ['xs']),
      { xs: ['a'] },
    );
  });
});

// ===========================================================================
// Nested schemas — the most likely blind spot
// ===========================================================================

describe('backward gate descends into nested schemas', () => {
  const deep = (leaf: Record<string, unknown>, leafRequired?: string[]) =>
    obj(
      {
        outer: obj(
          {
            middle: obj(
              { inner: obj({ leaf }, leafRequired) },
              ['inner'],
            ),
          },
          ['middle'],
        ),
      },
      ['outer'],
    );

  it('type narrowed three levels deep', () => {
    const v = expectRealBreak(
      deep({ type: 'string' }),
      deep({ type: 'integer' }),
      { outer: { middle: { inner: { leaf: 'x' } } } },
    );
    expect(v.some((m) => /outer\.middle\.inner\.leaf/.test(m))).toBe(true);
  });

  it('required added three levels deep', () => {
    const v = expectRealBreak(
      deep({ type: 'string' }),
      deep({ type: 'string' }, ['leaf']),
      { outer: { middle: { inner: {} } } },
    );
    expect(v.some((m) => /outer\.middle\.inner\.leaf/.test(m) && /required/i.test(m))).toBe(true);
  });

  it('enum shrunk three levels deep', () => {
    expectRealBreak(
      deep({ type: 'string', enum: ['a', 'b'] }),
      deep({ type: 'string', enum: ['a'] }),
      { outer: { middle: { inner: { leaf: 'b' } } } },
    );
  });

  it('additionalProperties closed on a nested object', () => {
    expectRealBreak(
      obj({ payload: obj({ a: { type: 'string' } }) }),
      obj({ payload: obj({ a: { type: 'string' } }, undefined, { additionalProperties: false }) }),
      { payload: { a: 'x', extra: 1 } },
    );
  });

  it('bound tightened on a nested field', () => {
    expectRealBreak(
      obj({ payload: obj({ n: { type: 'number', maximum: 100 } }) }),
      obj({ payload: obj({ n: { type: 'number', maximum: 1 } }) }),
      { payload: { n: 50 } },
    );
  });

  it('property removed from a nested object', () => {
    const result = checkBackwardCompat(
      obj({ payload: obj({ a: { type: 'string' }, b: { type: 'string' } }) }),
      obj({ payload: obj({ a: { type: 'string' } }) }),
    );
    expect(result.compatible).toBe(false);
    expect(result.violations.some((m) => /payload\.b/.test(m) && /removed/i.test(m))).toBe(true);
  });

  it('additionalProperties schema tightened on a nested map', () => {
    expectRealBreak(
      obj({ bag: { type: 'object', properties: {}, additionalProperties: {} } }),
      obj({ bag: { type: 'object', properties: {}, additionalProperties: { type: 'string' } } }),
      { bag: { k: 1 } },
    );
  });
});

describe('backward gate descends into arrays of objects', () => {
  const arrayOf = (item: Record<string, unknown>) =>
    obj({ rows: { type: 'array', items: item } }, ['rows']);

  it('required added inside an array item', () => {
    const v = expectRealBreak(
      arrayOf(obj({ id: { type: 'string' }, note: { type: 'string' } }, ['id'])),
      arrayOf(obj({ id: { type: 'string' }, note: { type: 'string' } }, ['id', 'note'])),
      { rows: [{ id: 'a' }] },
    );
    expect(v.some((m) => /rows\[\]\.note/.test(m) && /required/i.test(m))).toBe(true);
  });

  it('type narrowed inside an array item', () => {
    expectRealBreak(
      arrayOf(obj({ id: { type: 'string' } }, ['id'])),
      arrayOf(obj({ id: { type: 'integer' } }, ['id'])),
      { rows: [{ id: 'a' }] },
    );
  });

  it('property removed from an array item', () => {
    const result = checkBackwardCompat(
      arrayOf(obj({ id: { type: 'string' }, note: { type: 'string' } }, ['id'])),
      arrayOf(obj({ id: { type: 'string' } }, ['id'])),
    );
    expect(result.compatible).toBe(false);
    expect(result.violations.some((m) => /rows\[\]\.note/.test(m) && /removed/i.test(m))).toBe(true);
  });

  it('enum shrunk inside an array of objects nested in an object', () => {
    expectRealBreak(
      obj({ page: obj({ rows: { type: 'array', items: obj({ k: { enum: ['x', 'y'] } }) } }) }),
      obj({ page: obj({ rows: { type: 'array', items: obj({ k: { enum: ['x'] } }) } }) }),
      { page: { rows: [{ k: 'y' }] } },
    );
  });
});

// ===========================================================================
// Safe changes — the gate MUST allow each of these
// ===========================================================================

describe('backward gate allows genuinely safe changes', () => {
  it('identical schemas', () => {
    expectSafe(obj({ a: { type: 'string' } }, ['a']), obj({ a: { type: 'string' } }, ['a']), [
      { a: 'x' },
    ]);
  });

  it('adding an optional property', () => {
    expectSafe(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: 'string' }, b: { type: 'number' } }, ['a']),
      [{ a: 'x' }],
    );
  });

  it('adding an optional property to a nested object', () => {
    expectSafe(
      obj({ payload: obj({ a: { type: 'string' } }, ['a']) }),
      obj({ payload: obj({ a: { type: 'string' }, b: { type: 'number' } }, ['a']) }),
      [{ payload: { a: 'x' } }],
    );
  });

  it('widening an enum', () => {
    expectSafe(
      obj({ mode: { enum: ['a', 'b'] } }),
      obj({ mode: { enum: ['a', 'b', 'c'] } }),
      [{ mode: 'b' }],
    );
  });

  it('adding a description', () => {
    expectSafe(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: 'string', description: 'the id' } }, ['a'], { description: 'an event' }),
      [{ a: 'x' }],
    );
  });

  it('relaxing a lower bound', () => {
    expectSafe(
      obj({ n: { type: 'number', minimum: 10 } }),
      obj({ n: { type: 'number', minimum: 0 } }),
      [{ n: 50 }],
    );
  });

  it('relaxing an upper bound', () => {
    expectSafe(
      obj({ s: { type: 'string', maxLength: 4 } }),
      obj({ s: { type: 'string', maxLength: 64 } }),
      [{ s: 'abcd' }],
    );
  });

  it('dropping a bound entirely', () => {
    expectSafe(
      obj({ n: { type: 'number', minimum: 10, maximum: 20 } }),
      obj({ n: { type: 'number' } }),
      [{ n: 15 }],
    );
  });

  it('loosening additionalProperties from false to true', () => {
    expectSafe(
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: false }),
      obj({ a: { type: 'string' } }, ['a'], { additionalProperties: true }),
      [{ a: 'x' }],
    );
  });

  it('widening a type: string -> string|number', () => {
    expectSafe(
      obj({ a: { type: 'string' } }, ['a']),
      obj({ a: { type: ['string', 'number'] } }, ['a']),
      [{ a: 'x' }],
    );
  });

  it('widening a type: integer -> number (integer is a subset of number)', () => {
    // Regression: the old checker treated this as a narrowing because it
    // compared type tokens as opaque strings, so a perfectly safe widening
    // was rejected.
    expectSafe(obj({ n: { type: 'integer' } }), obj({ n: { type: 'number' } }), [{ n: 3 }]);
  });

  it('dropping a type constraint entirely', () => {
    // Regression: previously reported as "narrowed from [string] to [any]".
    expectSafe(obj({ a: { type: 'string' } }), obj({ a: {} }), [{ a: 'x' }]);
  });

  it('demoting a required field to optional', () => {
    expectSafe(
      obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']),
      obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a']),
      [{ a: 'x', b: 'y' }],
    );
  });

  it('dropping a pattern', () => {
    expectSafe(
      obj({ id: { type: 'string', pattern: '^evt_' } }),
      obj({ id: { type: 'string' } }),
      [{ id: 'evt_1' }],
    );
  });

  it('relaxing items from a narrow type to an open one', () => {
    expectSafe(
      obj({ xs: { type: 'array', items: { type: 'string' } } }),
      obj({ xs: { type: 'array', items: {} } }),
      [{ xs: ['a'] }],
    );
  });

  it('ignores keywords the runtime validator does not enforce', () => {
    // `format`, `exclusiveMinimum`, `multipleOf`, `uniqueItems`, `const` and
    // the `*Of` combinators are all inert in the fallback validator, so
    // tightening them cannot reject a payload — and must not block a deploy.
    const oldS = obj({ a: { type: 'string' }, n: { type: 'number' } });
    const newS = obj({
      a: { type: 'string', format: 'uuid' },
      n: { type: 'number', exclusiveMinimum: 5, multipleOf: 3 },
    });
    expect(accepts(newS, { a: 'not-a-uuid', n: 1 })).toBe(true);
    expect(checkBackwardCompat(oldS, newS).compatible).toBe(true);
  });

  it('adopting a schema where there was none is not gated', () => {
    // An empty schema is the absence of a contract, not a permissive one.
    // Bulk-registration entries carry no schema; adopting one later must not
    // be reported as "type narrowed from [any] to [object]".
    expect(checkBackwardCompat({}, {}).compatible).toBe(true);
    expect(checkBackwardCompat({}, obj({ a: { type: 'string' } })).compatible).toBe(true);
    expect(checkForwardCompat({}, obj({ a: { type: 'string' } })).compatible).toBe(true);
    expect(checkBackwardCompat(obj({ a: { type: 'string' } }), {}).compatible).toBe(true);
  });

  it('but a declared-but-unconstrained FIELD is still gated when it gains a type', () => {
    // `{}` at the root is "no contract". `{}` for one property inside a real
    // schema is a genuine any-value promise, and constraining it is a break.
    expectRealBreak(obj({ a: {} }), obj({ a: { type: 'string' } }), { a: 42 });
  });
});

// ===========================================================================
// Forward direction — mirror image
// ===========================================================================

describe('forward gate', () => {
  it('rejects a widened enum (old consumers have no branch for the new value)', () => {
    const r = checkForwardCompat(obj({ m: { enum: ['a'] } }), obj({ m: { enum: ['a', 'b'] } }));
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /enum/i.test(v) && /widened/i.test(v))).toBe(true);
  });

  it('accepts a shrunk enum', () => {
    expect(
      checkForwardCompat(obj({ m: { enum: ['a', 'b'] } }), obj({ m: { enum: ['a'] } })).compatible,
    ).toBe(true);
  });

  it('rejects a relaxed bound', () => {
    const r = checkForwardCompat(
      obj({ n: { type: 'number', maximum: 10 } }),
      obj({ n: { type: 'number', maximum: 1000 } }),
    );
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /maximum/i.test(v) && /relaxed/i.test(v))).toBe(true);
  });

  it('rejects additionalProperties loosened from false to true', () => {
    const r = checkForwardCompat(
      obj({ a: { type: 'string' } }, undefined, { additionalProperties: false }),
      obj({ a: { type: 'string' } }, undefined, { additionalProperties: true }),
    );
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /additionalProperties/i.test(v))).toBe(true);
  });

  it('rejects a dropped pattern', () => {
    const r = checkForwardCompat(
      obj({ id: { type: 'string', pattern: '^evt_' } }),
      obj({ id: { type: 'string' } }),
    );
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /pattern/i.test(v) && /relaxed/i.test(v))).toBe(true);
  });

  it('descends into nested objects and array items', () => {
    const deepOld = obj({ p: obj({ rows: { type: 'array', items: obj({ k: { type: 'string' } }) } }) });
    const deepNew = obj({
      p: obj({ rows: { type: 'array', items: obj({ k: { type: ['string', 'number'] } }) } }),
    });
    const r = checkForwardCompat(deepOld, deepNew);
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /p\.rows\[\]\.k/.test(v) && /widened/i.test(v))).toBe(true);
  });

  it('reports a brand-new required field nested inside an array item', () => {
    const r = checkForwardCompat(
      obj({ rows: { type: 'array', items: obj({ id: { type: 'string' } }, ['id']) } }),
      obj({
        rows: {
          type: 'array',
          items: obj({ id: { type: 'string' }, extra: { type: 'string' } }, ['id', 'extra']),
        },
      }),
    );
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /rows\[\]\.extra/.test(v) && /old consumers/i.test(v))).toBe(true);
  });

  it('accepts an added optional property (old consumers ignore it)', () => {
    expect(
      checkForwardCompat(
        obj({ a: { type: 'string' } }, ['a']),
        obj({ a: { type: 'string' }, b: { type: 'string' } }, ['a']),
      ).compatible,
    ).toBe(true);
  });
});

// ===========================================================================
// Wired through the Registry — the path strict mode actually takes
// ===========================================================================

describe('Registry.checkSchemaCompat wiring', () => {
  function withEvent(
    schema: Record<string, unknown>,
    compatibilityMode: 'backward' | 'forward' | 'full' | 'none' = 'backward',
  ): Registry {
    const registry = new Registry();
    registry.declare({
      name: 'evt.under.test',
      schema,
      transport: 'signal',
      producer: 'svc',
      compatibilityMode,
    });
    return registry;
  }

  it('rejects a nested breaking change through the registry, not just the pure function', () => {
    const registry = withEvent(obj({ p: obj({ k: { type: 'string' } }) }));
    const r = registry.checkSchemaCompat('evt.under.test', obj({ p: obj({ k: { type: 'integer' } }) }));
    expect(r.compatible).toBe(false);
    expect(r.violations.some((v) => /p\.k/.test(v))).toBe(true);
  });

  it('rejects an enum shrink through the registry', () => {
    const registry = withEvent(obj({ m: { enum: ['a', 'b'] } }));
    expect(registry.checkSchemaCompat('evt.under.test', obj({ m: { enum: ['a'] } })).compatible).toBe(
      false,
    );
  });

  it('mode=none still waves everything through', () => {
    const registry = withEvent(obj({ m: { enum: ['a', 'b'] } }), 'none');
    expect(registry.checkSchemaCompat('evt.under.test', obj({ m: { enum: ['a'] } })).compatible).toBe(
      true,
    );
  });

  it('declare() surfaces the violations on a redeclare with a tightened nested schema', () => {
    const registry = withEvent(obj({ p: obj({ k: { type: 'string' } }, []) }));
    const result = registry.declare({
      name: 'evt.under.test',
      schema: obj({ p: obj({ k: { type: 'string' } }, ['k']) }),
      transport: 'signal',
      producer: 'svc',
    });
    expect(result.compatible).toBe(false);
    expect(result.violations?.some((v) => /p\.k/.test(v) && /required/i.test(v))).toBe(true);
  });

  it('declare() accepts an additive nested change', () => {
    const registry = withEvent(obj({ p: obj({ k: { type: 'string' } }, ['k']) }));
    const result = registry.declare({
      name: 'evt.under.test',
      schema: obj({ p: obj({ k: { type: 'string' }, extra: { type: 'number' } }, ['k']) }),
      transport: 'signal',
      producer: 'svc',
    });
    expect(result.compatible).toBe(true);
  });

  it('terminates on a deeply nested schema instead of blowing the stack', () => {
    let deepA: Record<string, unknown> = { type: 'string' };
    let deepB: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 60; i++) {
      deepA = obj({ n: deepA });
      deepB = obj({ n: deepB });
    }
    expect(checkBackwardCompat(deepA, deepB).compatible).toBe(true);
  });
});
