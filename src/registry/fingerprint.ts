// src/registry/fingerprint.ts
//
// Phase E6 — deterministic schema fingerprints (formerly roadmap item
// E5.5, promoted from deferred per the 2026-05-15 vision refresh).
//
// A fingerprint is a content-addressable identifier for a declared
// schema's *shape*: identical shape → identical fingerprint, regardless
// of key ordering in the source declaration. Consumers cache + compare
// fingerprints to detect drift without a registry round-trip.
//
// The two pieces:
//
//   stableStringify(obj)        — deterministic JSON serialization with
//                                 sorted object keys. Zero dependencies.
//   computeSchemaFingerprint()  — sha256(stableStringify(schema)) as
//                                 lowercase 64-char hex.

import { createHash } from 'node:crypto';

/**
 * Serialize a JSON-compatible value deterministically so the byte output
 * is identical regardless of key insertion order. Arrays preserve order
 * (they're position-significant); object keys are sorted.
 *
 * Throws on circular references — schemas should never carry cycles, so
 * the throw is a guardrail against a corrupted input rather than a
 * supported branch.
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) {
      throw new Error('stableStringify: circular reference encountered');
    }
    seen.add(v as object);
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    const entries = Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => [k, walk((v as Record<string, unknown>)[k])] as const);
    const out: Record<string, unknown> = {};
    for (const [k, vv] of entries) out[k] = vv;
    return out;
  };
  return JSON.stringify(walk(value));
}

/**
 * Compute a sha256 fingerprint of an EventDeclaration's schema. The
 * fingerprint is byte-stable across re-serializations: a schema declared
 * with `{type:'object',required:['a','b']}` produces the same fingerprint
 * regardless of whether `required` is listed before `type` or after.
 *
 * Returns lowercase 64-char hex. Consumers may truncate to ~12 chars for
 * display; the catalog always stores and returns the full hash.
 */
export function computeSchemaFingerprint(schema: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(schema)).digest('hex');
}
