// src/registry/namespace.ts
//
// Phase E7 — namespace derivation.
//
// When a declaration omits `namespace`, the registry derives it from the
// event name. This is the soft-migration bridge: existing declarations
// keep working without edits, and the field becomes hard-required in
// v0.5 once everyone has updated.
//
// Derivation rules (first match wins):
//   1. dot-form  — `pipeline.approval.requested` → `pipeline`
//   2. colon-form — `pipeline:run:started`        → `pipeline`
//   3. single-word — `error`, `social`            → use the whole name
//
// Mixed-form names (e.g. `ws.pipeline.event`) take the first segment
// before *either* delimiter, whichever appears first.

/**
 * Derive a namespace from an event name when no explicit namespace was
 * declared. Always returns a non-empty string.
 */
export function deriveNamespace(name: string): string {
  if (!name) return '';
  const dotIdx = name.indexOf('.');
  const colonIdx = name.indexOf(':');
  // Pick the earliest delimiter (and skip absent ones).
  const candidates = [dotIdx, colonIdx].filter((i) => i > 0);
  if (candidates.length === 0) return name;
  const splitAt = Math.min(...candidates);
  return name.slice(0, splitAt);
}

/**
 * Resolve the effective namespace for an EventDeclaration: its explicit
 * `namespace` field if set, else the derived one. Trim and lowercase
 * normalization stays out of scope — namespaces are case-sensitive
 * tokens, just like event names.
 */
export function resolveNamespace(name: string, declared: string | undefined): string {
  if (declared && declared.trim().length > 0) return declared;
  return deriveNamespace(name);
}
