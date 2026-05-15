// tests/schema-compat.test.ts
//
// Phase E4 — direct unit tests for checkBackwardCompat and checkForwardCompat.
//
// These functions are the core of EC's strict-enforcement gate. The integration
// paths (Registry.declare, POST /events with strict mode) are covered in
// strict-mode.test.ts; this file covers the pure functions directly so that
// individual violation kinds are pinned at the lowest possible level.
//
// Coverage goals:
//   E4.A — checkBackwardCompat: field removal, new required field, type narrowing
//   E4.B — checkForwardCompat: new required field (old consumers can't handle),
//           type widening, required field made optional
//   E4.C — Registry.checkSchemaCompat with all CompatibilityMode variants
//           (none, backward, forward, full)
//   E4.D — "full" mode catches violations from both directions

import { describe, it, expect, beforeEach } from 'vitest';
import { checkBackwardCompat, checkForwardCompat } from '../src/registry/schema-compat.js';
import { Registry } from '../src/registry/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Factory functions — each call produces a NEW object so the fingerprint
// walker never sees a shared reference (which it treats as circular).
const str = () => ({ type: 'string' });
const num = () => ({ type: 'number' });
const strOrNum = () => ({ type: ['string', 'number'] });

function schema(
  props: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: 'object', properties: props, required };
}

// ---------------------------------------------------------------------------
// E4.A — checkBackwardCompat
// ---------------------------------------------------------------------------

describe('checkBackwardCompat (Phase E4.A)', () => {
  it('compatible: identical schemas', () => {
    const s = schema({ a: str() }, ['a']);
    const result = checkBackwardCompat(s, s);
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('compatible: new optional field added', () => {
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: str(), b: str() }, ['a']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('compatible: required field demoted to optional', () => {
    // Making a field optional is backward-compatible — old messages that
    // include the field still match; new messages may omit it.
    const old = schema({ a: str(), b: str() }, ['a', 'b']);
    const next = schema({ a: str(), b: str() }, ['a']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(true);
  });

  it('compatible: type widened (string → string|number)', () => {
    // Widening is backward-compatible: old messages (with strings) still valid.
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: strOrNum() }, ['a']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(true);
  });

  it('compatible: empty schemas', () => {
    const result = checkBackwardCompat({}, {});
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('compatible: schema with no properties key', () => {
    const result = checkBackwardCompat({ type: 'object' }, { type: 'object' });
    expect(result.compatible).toBe(true);
  });

  it('VIOLATION: existing field removed', () => {
    const old = schema({ a: str(), b: str() }, ['a']);
    const next = schema({ a: str() }, ['a']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"b"') && /removed/i.test(v))).toBe(true);
  });

  it('VIOLATION: brand-new required field added', () => {
    // b is not in old schema at all; adding it as required means old messages
    // won't include it.
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: str(), b: str() }, ['a', 'b']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"b"') && /required|added/i.test(v))).toBe(true);
  });

  it('VIOLATION: existing optional field promoted to required', () => {
    // b was optional; making it required breaks old messages that omit it.
    const old = schema({ a: str(), b: str() }, ['a']);
    const next = schema({ a: str(), b: str() }, ['a', 'b']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"b"') && /required/i.test(v))).toBe(true);
  });

  it('VIOLATION: field type narrowed (string|number → number)', () => {
    // Old messages may carry strings; narrowing rejects them.
    const old = schema({ a: strOrNum() }, ['a']);
    const next = schema({ a: num() }, ['a']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"a"') && /narrow/i.test(v))).toBe(true);
  });

  it('VIOLATION: multiple violations accumulate', () => {
    // Remove b AND promote optional c to required
    const old = schema({ a: str(), b: str(), c: str() }, ['a']);
    const next = schema({ a: str(), c: str() }, ['a', 'c']);
    const result = checkBackwardCompat(old, next);
    expect(result.compatible).toBe(false);
    // b removed + c promoted
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// E4.B — checkForwardCompat
// ---------------------------------------------------------------------------

describe('checkForwardCompat (Phase E4.B)', () => {
  it('compatible: identical schemas', () => {
    const s = schema({ a: str() }, ['a']);
    const result = checkForwardCompat(s, s);
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('compatible: new optional field added', () => {
    // Old consumers receive new messages; extra optional field is ignorable.
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: str(), b: str() }, ['a']);
    const result = checkForwardCompat(old, next);
    expect(result.compatible).toBe(true);
  });

  it('compatible: type narrowed (string|number → string)', () => {
    // New messages are a strict subset; old consumers that handle string|number
    // also handle plain strings.
    const old = schema({ a: strOrNum() }, ['a']);
    const next = schema({ a: str() }, ['a']);
    const result = checkForwardCompat(old, next);
    expect(result.compatible).toBe(true);
  });

  it('compatible: empty schemas', () => {
    const result = checkForwardCompat({}, {});
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('VIOLATION: brand-new required field added (old consumers can\'t handle it)', () => {
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: str(), b: str() }, ['a', 'b']);
    const result = checkForwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"b"'))).toBe(true);
  });

  it('VIOLATION: type widened (string → string|number)', () => {
    // Old consumers only handle strings; new messages may carry numbers.
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: strOrNum() }, ['a']);
    const result = checkForwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"a"') && /widen/i.test(v))).toBe(true);
  });

  it('VIOLATION: previously-required field made optional', () => {
    // Old consumers expect b always present; new messages may omit it.
    const old = schema({ a: str(), b: str() }, ['a', 'b']);
    const next = schema({ a: str(), b: str() }, ['a']);
    const result = checkForwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => v.includes('"b"') && /no longer required/i.test(v))).toBe(true);
  });

  it('VIOLATION: multiple forward violations accumulate', () => {
    // Widen a's type AND demote b from required
    const old = schema({ a: str(), b: str() }, ['a', 'b']);
    const next = schema({ a: strOrNum(), b: str() }, ['a']);
    const result = checkForwardCompat(old, next);
    expect(result.compatible).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// E4.C — Registry.checkSchemaCompat with all CompatibilityMode variants
// ---------------------------------------------------------------------------

describe('Registry.checkSchemaCompat (Phase E4.C)', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  it('returns compatible=true for unknown event (nothing to compare)', () => {
    const breaking = schema({ a: str(), b: str() }, ['a', 'b']);
    const result = registry.checkSchemaCompat('unknown.event', breaking);
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('mode=backward (default): rejects adding new required field', () => {
    registry.declare({
      name: 'e.backward',
      schema: schema({ a: str() }, ['a']),
      transport: 'signal',
      producer: 'svc',
    });
    const breaking = schema({ a: str(), b: str() }, ['a', 'b']);
    const result = registry.checkSchemaCompat('e.backward', breaking);
    expect(result.compatible).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('mode=backward: accepts additive optional change', () => {
    registry.declare({
      name: 'e.backward.ok',
      schema: schema({ a: str() }, ['a']),
      transport: 'signal',
      producer: 'svc',
    });
    const additive = schema({ a: str(), b: str() }, ['a']);
    const result = registry.checkSchemaCompat('e.backward.ok', additive);
    expect(result.compatible).toBe(true);
  });

  it('mode=none: always compatible, even for breaking changes', () => {
    registry.declare({
      name: 'e.none',
      schema: schema({ a: str() }, ['a']),
      transport: 'signal',
      producer: 'svc',
      compatibilityMode: 'none',
    });
    const breaking = schema({ a: str(), b: str() }, ['a', 'b']);
    const result = registry.checkSchemaCompat('e.none', breaking);
    expect(result.compatible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('mode=forward: rejects type widening', () => {
    registry.declare({
      name: 'e.forward',
      schema: schema({ a: str() }, ['a']),
      transport: 'signal',
      producer: 'svc',
      compatibilityMode: 'forward',
    });
    const widened = schema({ a: strOrNum() }, ['a']);
    const result = registry.checkSchemaCompat('e.forward', widened);
    expect(result.compatible).toBe(false);
    expect(result.violations.some(v => /widen/i.test(v))).toBe(true);
  });

  it('mode=forward: accepts type narrowing', () => {
    registry.declare({
      name: 'e.forward.narrow',
      schema: schema({ a: strOrNum() }, ['a']),
      transport: 'signal',
      producer: 'svc',
      compatibilityMode: 'forward',
    });
    const narrowed = schema({ a: str() }, ['a']);
    const result = registry.checkSchemaCompat('e.forward.narrow', narrowed);
    expect(result.compatible).toBe(true);
  });

  it('mode=full: rejects change that violates both backward and forward', () => {
    registry.declare({
      name: 'e.full',
      schema: schema({ a: str(), b: str() }, ['a', 'b']),
      transport: 'signal',
      producer: 'svc',
      compatibilityMode: 'full',
    });
    // Remove b (backward violation: field removed) and widen a (forward violation)
    const bothBroken = schema({ a: strOrNum() }, ['a']);
    const result = registry.checkSchemaCompat('e.full', bothBroken);
    expect(result.compatible).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('mode=full: accepts additive optional change (passes both directions)', () => {
    registry.declare({
      name: 'e.full.ok',
      schema: schema({ a: str() }, ['a']),
      transport: 'signal',
      producer: 'svc',
      compatibilityMode: 'full',
    });
    const additive = schema({ a: str(), b: str() }, ['a']);
    const result = registry.checkSchemaCompat('e.full.ok', additive);
    expect(result.compatible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E4.D — directional asymmetry: which mode catches which violation kinds
// ---------------------------------------------------------------------------

describe('compat directional asymmetry (Phase E4.D)', () => {
  it('type-widening violates forward but NOT backward', () => {
    const old = schema({ a: str() }, ['a']);
    const next = schema({ a: strOrNum() }, ['a']);
    expect(checkBackwardCompat(old, next).compatible).toBe(true);
    expect(checkForwardCompat(old, next).compatible).toBe(false);
  });

  it('type-narrowing violates backward but NOT forward', () => {
    const old = schema({ a: strOrNum() }, ['a']);
    const next = schema({ a: str() }, ['a']);
    expect(checkBackwardCompat(old, next).compatible).toBe(false);
    expect(checkForwardCompat(old, next).compatible).toBe(true);
  });

  it('field removal violates backward', () => {
    const old = schema({ a: str(), b: str() }, ['a']);
    const next = schema({ a: str() }, ['a']);
    expect(checkBackwardCompat(old, next).compatible).toBe(false);
  });

  it('required demoted to optional violates forward', () => {
    const old = schema({ a: str(), b: str() }, ['a', 'b']);
    const next = schema({ a: str(), b: str() }, ['a']);
    expect(checkForwardCompat(old, next).compatible).toBe(false);
    // but backward is fine (removing required constraint)
    expect(checkBackwardCompat(old, next).compatible).toBe(true);
  });

  it('full-mode violations array contains contributions from both directions', () => {
    // demote b (forward violation) + remove c (backward violation)
    const old = schema({ a: str(), b: str(), c: str() }, ['a', 'b']);
    const next = schema({ a: str(), b: str() }, ['a']); // c removed + b demoted
    const backward = checkBackwardCompat(old, next);
    const forward = checkForwardCompat(old, next);
    // Both directions detect violations
    expect(backward.compatible).toBe(false); // c removed
    expect(forward.compatible).toBe(false);  // b demoted
    const combined = [...backward.violations, ...forward.violations];
    expect(combined.length).toBeGreaterThanOrEqual(2);
  });
});
