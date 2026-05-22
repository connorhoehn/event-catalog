// src/bundles/FeatureBundle.ts
//
// FeatureBundle — capability-level grouping of related events.
//
// A bundle is a named, versioned set of event references that together
// constitute a deployable feature (e.g. "chat", "presence"). The
// fingerprint is a content-addressable hash of the bundle's identity
// so CRDs can pin to a specific bundle state and detect drift without
// a live registry round-trip.
//
// API surface (module-level functions):
//   registerFeatureBundle(bundle)  — compute + stamp fingerprint, store
//   getFeatureBundle(name, version?) — lookup; latest when version omitted
//   listFeatureBundles()           — all registered bundles
//   validateBundle(bundle, registry) — event-existence + transport checks
//   findBundleByFingerprint(fp)    — reverse lookup for CRD pinning
//   getCrdSchema(bundleName)       — JSON Schema fragment for K8s CRD spec

import { createHash } from 'node:crypto';
import { stableStringify } from '../registry/fingerprint.js';
import type { IRegistry } from '../registry/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventReference {
  /** Canonical event name, e.g. "ws.chat.message". */
  name: string;
  /**
   * Pin to a specific event schema version. When omitted the bundle
   * accepts the current registered version.
   */
  version?: number;
  /**
   * When true this event MUST be registered before the bundle is
   * considered valid. Optional events may be omitted by a lightweight
   * implementation.
   */
  required?: boolean;
}

export interface FeatureBundle {
  /** Short machine-readable identifier. Used as the CRD kind lower-case. */
  name: string;
  /** Semver string. Bumped when the event set or any required schema changes. */
  version: string;
  /**
   * Content-addressable fingerprint: sha256 of { name, version, events.sorted }.
   * Computed automatically by registerFeatureBundle(); callers should
   * leave this empty ('') in declarations — it is stamped at registration.
   */
  fingerprint: string;
  /** All events that make up this capability. */
  events: EventReference[];
  /**
   * Aggregate transport: 'signal' if all events are signal, 'durable' if
   * all are durable, 'both' if mixed. Declared here for CRD gate checks
   * that run before a live catalog is available.
   */
  transport: 'signal' | 'durable' | 'both';
  description?: string;
  deprecated?: {
    since: string;
    replacement?: string;
  };
}

export interface BundleValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic fingerprint for a bundle.
 * Only name, version, and the sorted event reference list feed the hash;
 * description and deprecated are excluded so documentation edits don't
 * invalidate CRD pins.
 *
 * Returns lowercase 64-char hex. Consumers may truncate to 12 chars for
 * display; the registry always stores and returns the full hash.
 */
export function computeFingerprint(
  bundle: Pick<FeatureBundle, 'name' | 'version' | 'events'>,
): string {
  const sortedEvents = [...bundle.events].sort((a, b) => a.name.localeCompare(b.name));
  const payload = { name: bundle.name, version: bundle.version, events: sortedEvents };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

// ---------------------------------------------------------------------------
// In-process registry (module singleton)
// ---------------------------------------------------------------------------

// Map<name, FeatureBundle[]> — multiple versions may be registered.
const _store = new Map<string, FeatureBundle[]>();

/**
 * Add a bundle to the in-process registry. Computes and stamps the
 * fingerprint automatically; the caller's `fingerprint` field is ignored
 * (computed fresh each time).
 *
 * Throws if a bundle with the same name+version is already registered
 * with a different event set (fingerprint mismatch → likely a bug).
 */
export function registerFeatureBundle(
  bundle: Omit<FeatureBundle, 'fingerprint'>,
): FeatureBundle {
  const fingerprint = computeFingerprint(bundle);
  const full: FeatureBundle = { ...bundle, fingerprint };

  const existing = _store.get(bundle.name) ?? [];
  const same = existing.find((b) => b.version === bundle.version);

  if (same) {
    if (same.fingerprint !== fingerprint) {
      throw new Error(
        `FeatureBundleRegistry: bundle "${bundle.name}" v${bundle.version} already registered with a different event set. ` +
          `Existing fingerprint: ${same.fingerprint.slice(0, 12)}, new: ${fingerprint.slice(0, 12)}`,
      );
    }
    // Idempotent re-registration with the same content — no-op.
    return same;
  }

  existing.push(full);
  _store.set(bundle.name, existing);
  return full;
}

/**
 * Look up a bundle. When version is omitted returns the highest semver
 * among all registered versions for that name.
 */
export function getFeatureBundle(name: string, version?: string): FeatureBundle | undefined {
  const versions = _store.get(name);
  if (!versions || versions.length === 0) return undefined;
  if (version !== undefined) {
    return versions.find((b) => b.version === version);
  }
  // Return latest: simple lexicographic semver sort (sufficient for x.y.z).
  return versions.slice().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
}

/** Returns all registered bundles, sorted by name then version. */
export function listFeatureBundles(): FeatureBundle[] {
  const all: FeatureBundle[] = [];
  for (const versions of _store.values()) {
    all.push(...versions);
  }
  return all.sort((a, b) => {
    const nameOrd = a.name.localeCompare(b.name);
    if (nameOrd !== 0) return nameOrd;
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });
}

/**
 * Validate that:
 *   1. Every required EventReference.name exists in the supplied registry.
 *   2. When EventReference.version is pinned, the registry entry's version matches.
 *   3. The declared transport is consistent with the registered events' transports
 *      (where the registry has transport information).
 *
 * Returns a structured result so callers can surface errors gracefully
 * at boot rather than crashing.
 */
export function validateBundle(
  bundle: FeatureBundle,
  registry: IRegistry,
): BundleValidationResult {
  const errors: string[] = [];

  for (const ref of bundle.events) {
    const entry = registry.get(ref.name);

    if (!entry) {
      if (ref.required !== false) {
        // required: true or required: undefined (default required) both fail
        errors.push(`Required event "${ref.name}" is not registered in the catalog.`);
      }
      // optional missing events are silently skipped
      continue;
    }

    if (ref.version !== undefined && entry.version !== ref.version) {
      errors.push(
        `Event "${ref.name}" version mismatch: bundle pins v${ref.version} but registry has v${entry.version}.`,
      );
    }
  }

  // Transport coherence check: infer aggregate transport from registered events.
  const registeredTransports = new Set<string>();
  for (const ref of bundle.events) {
    const entry = registry.get(ref.name);
    if (entry && entry.transport) {
      registeredTransports.add(entry.transport);
    }
  }

  if (registeredTransports.size > 0) {
    let inferredTransport: 'signal' | 'durable' | 'both';
    if (registeredTransports.has('signal') && registeredTransports.has('durable')) {
      inferredTransport = 'both';
    } else if (registeredTransports.has('durable')) {
      inferredTransport = 'durable';
    } else {
      inferredTransport = 'signal';
    }

    if (bundle.transport !== inferredTransport) {
      errors.push(
        `Bundle transport "${bundle.transport}" does not match inferred transport "${inferredTransport}" from registered events.`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Reverse lookup: find a bundle by its fingerprint.
 * Used by CRD controllers that embed fingerprints and need to resolve
 * back to the full bundle descriptor.
 */
export function findBundleByFingerprint(fingerprint: string): FeatureBundle | undefined {
  for (const versions of _store.values()) {
    const match = versions.find((b) => b.fingerprint === fingerprint);
    if (match) return match;
  }
  return undefined;
}

/**
 * Generate a minimal JSON Schema fragment suitable for embedding in a
 * Kubernetes CRD's `spec.versions[].schema.openAPIV3Schema`. The schema
 * covers the `bundle` field of the CRD spec with required name, version,
 * and fingerprint fields.
 *
 * Returns undefined when the named bundle is not registered.
 */
export function getCrdSchema(bundleName: string): Record<string, unknown> | undefined {
  const bundle = getFeatureBundle(bundleName);
  if (!bundle) return undefined;

  return {
    type: 'object',
    required: ['name', 'version', 'fingerprint'],
    properties: {
      name: { type: 'string', enum: [bundleName] },
      version: { type: 'string' },
      fingerprint: { type: 'string', minLength: 64 },
    },
  };
}

// ---------------------------------------------------------------------------
// FeatureBundleRegistry class (object-oriented alternative surface)
// ---------------------------------------------------------------------------

/**
 * Object-oriented wrapper around the module-level bundle store.
 * Useful for dependency injection in tests or when an isolated registry
 * is needed (e.g. the test suite instantiates one per test).
 */
export class FeatureBundleRegistry {
  private readonly _store = new Map<string, FeatureBundle[]>();

  register(bundle: Omit<FeatureBundle, 'fingerprint'>): FeatureBundle {
    const fingerprint = computeFingerprint(bundle);
    const full: FeatureBundle = { ...bundle, fingerprint };

    const existing = this._store.get(bundle.name) ?? [];
    const same = existing.find((b) => b.version === bundle.version);

    if (same) {
      if (same.fingerprint !== fingerprint) {
        throw new Error(
          `FeatureBundleRegistry: bundle "${bundle.name}" v${bundle.version} already registered with a different event set.`,
        );
      }
      return same;
    }

    existing.push(full);
    this._store.set(bundle.name, existing);
    return full;
  }

  get(name: string, version?: string): FeatureBundle | undefined {
    const versions = this._store.get(name);
    if (!versions || versions.length === 0) return undefined;
    if (version !== undefined) {
      return versions.find((b) => b.version === version);
    }
    return versions.slice().sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    )[0];
  }

  list(): FeatureBundle[] {
    const all: FeatureBundle[] = [];
    for (const versions of this._store.values()) {
      all.push(...versions);
    }
    return all.sort((a, b) => {
      const nameOrd = a.name.localeCompare(b.name);
      if (nameOrd !== 0) return nameOrd;
      return a.version.localeCompare(b.version, undefined, { numeric: true });
    });
  }

  validate(bundle: FeatureBundle, registry: IRegistry): BundleValidationResult {
    return validateBundle(bundle, registry);
  }

  findByFingerprint(fingerprint: string): FeatureBundle | undefined {
    for (const versions of this._store.values()) {
      const match = versions.find((b) => b.fingerprint === fingerprint);
      if (match) return match;
    }
    return undefined;
  }

  /**
   * Mark a specific bundle version as deprecated. Updates the in-place entry
   * and recomputes the fingerprint because deprecation metadata changes the
   * bundle definition (the hash excludes deprecated, so the fingerprint is
   * unchanged — see computeFingerprint). This mutates the stored entry so
   * subsequent gets() return the updated deprecated field.
   *
   * Returns the updated bundle, or undefined if the bundle/version is not found.
   */
  deprecate(
    name: string,
    version: string,
    deprecation: { since: string; replacement?: string },
  ): FeatureBundle | undefined {
    const versions = this._store.get(name);
    if (!versions) return undefined;
    const idx = versions.findIndex((b) => b.version === version);
    if (idx < 0) return undefined;
    const existing = versions[idx]!;
    // Re-stamp fingerprint: deprecated field is excluded from hash but we
    // regenerate to ensure consistency with any future algorithm changes.
    const updated: FeatureBundle = {
      ...existing,
      deprecated: deprecation,
      fingerprint: computeFingerprint(existing),
    };
    versions[idx] = updated;
    this._store.set(name, versions);
    return updated;
  }

  /** Returns all registered bundles that have a `deprecated` field set. */
  listDeprecated(): FeatureBundle[] {
    return this.list().filter((b) => b.deprecated !== undefined);
  }
}
