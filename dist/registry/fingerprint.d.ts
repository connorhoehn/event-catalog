/**
 * Serialize a JSON-compatible value deterministically so the byte output
 * is identical regardless of key insertion order. Arrays preserve order
 * (they're position-significant); object keys are sorted.
 *
 * Throws on circular references — schemas should never carry cycles, so
 * the throw is a guardrail against a corrupted input rather than a
 * supported branch.
 */
export declare function stableStringify(value: unknown): string;
/**
 * Compute a sha256 fingerprint of an EventDeclaration's schema. The
 * fingerprint is byte-stable across re-serializations: a schema declared
 * with `{type:'object',required:['a','b']}` produces the same fingerprint
 * regardless of whether `required` is listed before `type` or after.
 *
 * Returns lowercase 64-char hex. Consumers may truncate to ~12 chars for
 * display; the catalog always stores and returns the full hash.
 */
export declare function computeSchemaFingerprint(schema: Record<string, unknown>): string;
//# sourceMappingURL=fingerprint.d.ts.map