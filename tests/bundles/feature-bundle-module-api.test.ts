// tests/bundles/feature-bundle-module-api.test.ts
//
// Covers the module-level (singleton) half of src/bundles/FeatureBundle.ts —
// registerFeatureBundle / getFeatureBundle / listFeatureBundles /
// findBundleByFingerprint / getCrdSchema — plus the transport-inference
// arm of validateBundle, which the class-level suite (registry.test.ts)
// only exercises through the OO wrapper.
//
// The module store is a process singleton with no reset hook, so every
// bundle name here is uniquely suffixed to keep tests independent of
// each other and of any other suite that touches the same module.

import { describe, it, expect } from 'vitest';
import {
  registerFeatureBundle,
  getFeatureBundle,
  listFeatureBundles,
  findBundleByFingerprint,
  getCrdSchema,
  validateBundle,
  computeFingerprint,
  FeatureBundleRegistry,
  type FeatureBundle,
} from '../../src/bundles/FeatureBundle.js';
import { Registry } from '../../src/registry/index.js';

let seq = 0;
/** Unique bundle name per call — the module store is never cleared. */
function uniqueName(base: string): string {
  return `${base}-${process.pid}-${++seq}`;
}

function bundleOf(
  name: string,
  version: string,
  events: Array<{ name: string; version?: number; required?: boolean }>,
  transport: 'signal' | 'durable' | 'both' = 'signal',
): Omit<FeatureBundle, 'fingerprint'> {
  return { name, version, events, transport };
}

describe('registerFeatureBundle (module singleton)', () => {
  it('stamps a computed fingerprint, ignoring whatever the caller passed', () => {
    const name = uniqueName('stamp');
    const registered = registerFeatureBundle({
      ...bundleOf(name, '1.0.0', [{ name: 'a:one' }]),
      // A stale/garbage fingerprint must never survive registration.
      fingerprint: 'deadbeef',
    } as Omit<FeatureBundle, 'fingerprint'> & { fingerprint: string });

    expect(registered.fingerprint).toBe(
      computeFingerprint({ name, version: '1.0.0', events: [{ name: 'a:one' }] }),
    );
    expect(registered.fingerprint).not.toBe('deadbeef');
  });

  it('is idempotent for an identical re-registration and does not duplicate the entry', () => {
    const name = uniqueName('idem');
    const first = registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'a:one' }]));
    const second = registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'a:one' }]));

    // Same object identity: the stored entry is returned, not a fresh copy.
    expect(second).toBe(first);
    expect(listFeatureBundles().filter(b => b.name === name)).toHaveLength(1);
  });

  it('throws when the same name+version is re-registered with a different event set', () => {
    const name = uniqueName('conflict');
    registerFeatureBundle(bundleOf(name, '2.1.0', [{ name: 'a:one' }]));

    expect(() =>
      registerFeatureBundle(bundleOf(name, '2.1.0', [{ name: 'a:one' }, { name: 'a:two' }])),
    ).toThrow(/already registered with a different event set/);

    // The conflicting write must not have landed.
    const stored = getFeatureBundle(name, '2.1.0');
    expect(stored?.events).toHaveLength(1);
  });

  it('event ordering does not count as a different event set (no false conflict)', () => {
    const name = uniqueName('order');
    registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'z:last' }, { name: 'a:first' }]));

    expect(() =>
      registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'a:first' }, { name: 'z:last' }])),
    ).not.toThrow();
  });
});

describe('getFeatureBundle / listFeatureBundles (module singleton)', () => {
  it('returns undefined for an unregistered name', () => {
    expect(getFeatureBundle(uniqueName('missing'))).toBeUndefined();
  });

  it('returns undefined for a known name at an unknown version', () => {
    const name = uniqueName('ver');
    registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'a:one' }]));
    expect(getFeatureBundle(name, '9.9.9')).toBeUndefined();
  });

  it('resolves the latest version numerically, not lexicographically', () => {
    const name = uniqueName('latest');
    registerFeatureBundle(bundleOf(name, '1.9.0', [{ name: 'a:one' }]));
    registerFeatureBundle(bundleOf(name, '1.10.0', [{ name: 'a:two' }]));

    // Plain string compare would pick 1.9.0 here.
    expect(getFeatureBundle(name)?.version).toBe('1.10.0');
  });

  it('sorts same-name bundles by version ascending within the global list', () => {
    const name = uniqueName('sort');
    registerFeatureBundle(bundleOf(name, '1.10.0', [{ name: 'a:two' }]));
    registerFeatureBundle(bundleOf(name, '1.2.0', [{ name: 'a:one' }]));

    const versions = listFeatureBundles()
      .filter(b => b.name === name)
      .map(b => b.version);
    expect(versions).toEqual(['1.2.0', '1.10.0']);
  });
});

describe('findBundleByFingerprint (module singleton)', () => {
  it('resolves a fingerprint back to the exact name+version that produced it', () => {
    const name = uniqueName('fp');
    registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'a:one' }]));
    const v2 = registerFeatureBundle(bundleOf(name, '2.0.0', [{ name: 'a:one' }, { name: 'a:two' }]));

    const found = findBundleByFingerprint(v2.fingerprint);
    expect(found?.name).toBe(name);
    expect(found?.version).toBe('2.0.0');
  });

  it('returns undefined for a fingerprint that matches nothing', () => {
    expect(findBundleByFingerprint('0'.repeat(64))).toBeUndefined();
  });
});

describe('getCrdSchema', () => {
  it('returns undefined for an unregistered bundle', () => {
    expect(getCrdSchema(uniqueName('nocrd'))).toBeUndefined();
  });

  it('pins the CRD name enum to the bundle and requires a full-length fingerprint', () => {
    const name = uniqueName('crd');
    registerFeatureBundle(bundleOf(name, '1.0.0', [{ name: 'a:one' }]));

    const schema = getCrdSchema(name) as {
      type: string;
      required: string[];
      properties: {
        name: { enum: string[] };
        fingerprint: { minLength: number };
      };
    };

    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['name', 'version', 'fingerprint']);
    expect(schema.properties.name.enum).toEqual([name]);
    // 64 == full sha256 hex; a truncated display fingerprint must not validate.
    expect(schema.properties.fingerprint.minLength).toBe(64);
  });
});

describe('validateBundle — transport inference', () => {
  function registryWith(events: Array<{ name: string; transport: 'signal' | 'durable' | 'both' }>): Registry {
    const registry = new Registry();
    for (const e of events) {
      registry.declare({
        name: e.name,
        transport: e.transport,
        producer: 'test-svc',
        schema: { type: 'object' },
      });
    }
    return registry;
  }

  it('accepts a "both" bundle whose events are themselves declared transport:"both"', () => {
    // Regression: a single 'both' entry used to infer 'signal', so every
    // bundle over `transport: 'both'` events (e.g. the pipeline approval
    // events) failed validation with a nonsensical message.
    const registry = registryWith([{ name: 'p:approval:requested', transport: 'both' }]);
    const bundle: FeatureBundle = {
      name: 'approval',
      version: '1.0.0',
      fingerprint: '',
      transport: 'both',
      events: [{ name: 'p:approval:requested' }],
    };

    expect(validateBundle(bundle, registry)).toEqual({ valid: true, errors: [] });
  });

  it('a "both" event still contributes both sides when mixed with a signal-only event', () => {
    const registry = registryWith([
      { name: 'p:approval:requested', transport: 'both' },
      { name: 'ws:typing', transport: 'signal' },
    ]);
    const bundle: FeatureBundle = {
      name: 'mixed',
      version: '1.0.0',
      fingerprint: '',
      transport: 'both',
      events: [{ name: 'p:approval:requested' }, { name: 'ws:typing' }],
    };

    expect(validateBundle(bundle, registry).valid).toBe(true);
  });

  it('ACCEPTS a bundle narrowing to "signal" over transport:"both" events', () => {
    // The transport check is satisfiability, not equality. A 'both' event is
    // published on both buses, so a bundle may legitimately claim just one —
    // which is exactly how agentic-pipeline-signal and -durable split the
    // same approval events. The old equality rule made
    // agentic-pipeline-durable@1.0.0 ship permanently INVALID.
    const registry = registryWith([{ name: 'p:approval:requested', transport: 'both' }]);
    const bundle: FeatureBundle = {
      name: 'understated',
      version: '1.0.0',
      fingerprint: '',
      transport: 'signal',
      events: [{ name: 'p:approval:requested' }],
    };

    expect(validateBundle(bundle, registry)).toEqual({ valid: true, errors: [] });
  });

  it('ACCEPTS a bundle narrowing to "durable" over transport:"both" events', () => {
    const registry = registryWith([{ name: 'p:approval:requested', transport: 'both' }]);
    const bundle: FeatureBundle = {
      name: 'audit',
      version: '1.0.0',
      fingerprint: '',
      transport: 'durable',
      events: [{ name: 'p:approval:requested' }],
    };

    expect(validateBundle(bundle, registry)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a "signal" bundle holding a durable-only event', () => {
    const registry = registryWith([{ name: 'job:queued', transport: 'durable' }]);
    const bundle: FeatureBundle = {
      name: 'jobs',
      version: '1.0.0',
      fingerprint: '',
      transport: 'signal',
      events: [{ name: 'job:queued' }],
    };

    const result = validateBundle(bundle, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not satisfiable');
    // The message must name the offending event — "inferred transport"
    // told an operator nothing about what to fix.
    expect(result.errors[0]).toContain('job:queued');
    expect(result.errors[0]).toContain('signal bus');
  });

  it('rejects a "durable" bundle holding a signal-only event', () => {
    const registry = registryWith([
      { name: 'p:approval:requested', transport: 'both' },
      { name: 'ws:typing', transport: 'signal' },
    ]);
    const bundle: FeatureBundle = {
      name: 'overreaching',
      version: '1.0.0',
      fingerprint: '',
      transport: 'durable',
      events: [{ name: 'p:approval:requested' }, { name: 'ws:typing' }],
    };

    const result = validateBundle(bundle, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('ws:typing');
  });

  it('rejects a "both" bundle whose events never reach the durable bus', () => {
    const registry = registryWith([{ name: 'ws:typing', transport: 'signal' }]);
    const bundle: FeatureBundle = {
      name: 'overclaimed',
      version: '1.0.0',
      fingerprint: '',
      transport: 'both',
      events: [{ name: 'ws:typing' }],
    };

    const result = validateBundle(bundle, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('durable bus');
  });

  it('rejects a "both" bundle whose events never reach the signal bus', () => {
    const registry = registryWith([{ name: 'job:queued', transport: 'durable' }]);
    const bundle: FeatureBundle = {
      name: 'overclaimed2',
      version: '1.0.0',
      fingerprint: '',
      transport: 'both',
      events: [{ name: 'job:queued' }],
    };

    const result = validateBundle(bundle, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('signal bus');
  });

  it('infers "both" from a signal event plus a durable event', () => {
    const registry = registryWith([
      { name: 'ws:typing', transport: 'signal' },
      { name: 'job:queued', transport: 'durable' },
    ]);
    const bundle: FeatureBundle = {
      name: 'span',
      version: '1.0.0',
      fingerprint: '',
      transport: 'both',
      events: [{ name: 'ws:typing' }, { name: 'job:queued' }],
    };

    expect(validateBundle(bundle, registry).valid).toBe(true);
  });

  it('rejects a bundle whose members are all optional and all unregistered', () => {
    const registry = new Registry();
    const bundle: FeatureBundle = {
      name: 'unknown',
      version: '1.0.0',
      fingerprint: '',
      transport: 'durable',
      events: [{ name: 'nope:one', required: false }],
    };

    // This used to pass. Every member optional and absent means no
    // missing-event error fires, which left the transport claim
    // unfalsifiable — and "unfalsifiable" was being reported as valid.
    // A bundle that asserts nothing must not gate a CRD.
    const result = validateBundle(bundle, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unverifiable');
  });

  it('an optional member that IS registered still constrains the transport', () => {
    const registry = registryWith([{ name: 'ws:typing', transport: 'signal' }]);
    const bundle: FeatureBundle = {
      name: 'narrow',
      version: '1.0.0',
      fingerprint: '',
      transport: 'durable',
      events: [{ name: 'ws:typing', required: false }],
    };

    const result = validateBundle(bundle, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('durable bus');
  });
});

describe('FeatureBundleRegistry.deprecate / listDeprecated', () => {
  it('marks a version deprecated in place without changing its fingerprint', () => {
    const reg = new FeatureBundleRegistry();
    const before = reg.register(bundleOf('chat', '1.0.0', [{ name: 'ws:chat' }]));

    const updated = reg.deprecate('chat', '1.0.0', { since: '2026-01-01', replacement: 'chat@2' });

    expect(updated?.deprecated).toEqual({ since: '2026-01-01', replacement: 'chat@2' });
    // Deprecation is documentation, not identity — CRD pins must survive it.
    expect(updated?.fingerprint).toBe(before.fingerprint);
    expect(reg.get('chat', '1.0.0')?.deprecated?.since).toBe('2026-01-01');
  });

  it('returns undefined for an unknown bundle name or unknown version', () => {
    const reg = new FeatureBundleRegistry();
    reg.register(bundleOf('chat', '1.0.0', [{ name: 'ws:chat' }]));

    expect(reg.deprecate('nope', '1.0.0', { since: '2026-01-01' })).toBeUndefined();
    expect(reg.deprecate('chat', '9.9.9', { since: '2026-01-01' })).toBeUndefined();
  });

  it('listDeprecated returns only the deprecated versions, leaving siblings alone', () => {
    const reg = new FeatureBundleRegistry();
    reg.register(bundleOf('chat', '1.0.0', [{ name: 'ws:chat' }]));
    reg.register(bundleOf('chat', '2.0.0', [{ name: 'ws:chat' }, { name: 'ws:chat:edit' }]));
    reg.register(bundleOf('presence', '1.0.0', [{ name: 'ws:presence' }]));

    expect(reg.listDeprecated()).toEqual([]);

    reg.deprecate('chat', '1.0.0', { since: '2026-01-01' });

    const deprecated = reg.listDeprecated();
    expect(deprecated.map(b => `${b.name}@${b.version}`)).toEqual(['chat@1.0.0']);
    expect(reg.get('chat', '2.0.0')?.deprecated).toBeUndefined();
  });
});
