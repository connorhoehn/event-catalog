// tests/bundles/validate-bundle-adversarial.test.ts
//
// validateBundle, attacked rather than demonstrated.
//
// This is the check every CRD lint sits on top of. It was rewritten from
// transport EQUALITY to transport SATISFIABILITY after
// agentic-pipeline-durable@1.0.0 shipped invalid against its own registry
// (its three members are declared `transport: 'both'`, which the old
// equality rule read as "not durable"). A loosening like that is exactly
// where a hole gets introduced, so every case below is a bundle that
// SHOULD be rejected, plus the narrow set that should still pass.
//
// The two holes this file was written to pin down, both now closed:
//
//   1. An empty member list satisfied any transport claim vacuously.
//   2. So did a member list where every entry was optional and none were
//      registered — "unfalsifiable" was being reported as "valid".

import { describe, it, expect } from 'vitest';

import { Registry } from '../../src/registry/index.js';
import {
  validateBundle,
  isBundleTransport,
  BUNDLE_TRANSPORTS,
  type FeatureBundle,
  type EventReference,
} from '../../src/bundles/FeatureBundle.js';
import type { IRegistry } from '../../src/registry/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Transport = 'signal' | 'durable' | 'both';

/** Registry stub that knows a fixed event set. Transport may be omitted. */
function registryOf(
  events: Array<{ name: string; transport?: string; version?: number }>,
): IRegistry {
  return {
    get: (name: string) => {
      const ev = events.find((e) => e.name === name);
      if (!ev) return undefined;
      return { name: ev.name, transport: ev.transport, version: ev.version ?? 1 } as never;
    },
    list: () => events.map((e) => ({ name: e.name })) as never,
    declare: () => ({ version: 1, compatible: true, schemaFingerprint: '' }),
    addSubscriber: () => {},
    removeSubscriber: () => {},
    updateStats: () => {},
    remove: () => false,
    getTopology: () => ({ nodes: [], edges: [] }) as never,
    validate: () => ({ valid: true }),
    checkSchemaCompat: () => ({ compatible: true, mode: 'backward', violations: [] }) as never,
    size: () => events.length,
    clear: () => {},
  } as IRegistry;
}

function bundleOf(transport: Transport | string, events: EventReference[]): FeatureBundle {
  return {
    name: 'subject',
    version: '1.0.0',
    fingerprint: '',
    transport: transport as Transport,
    events,
  };
}

const req = (name: string): EventReference => ({ name, required: true });
const opt = (name: string): EventReference => ({ name, required: false });

// ---------------------------------------------------------------------------
// The cases the rewrite must still reject
// ---------------------------------------------------------------------------

describe('validateBundle — transport claims that must be rejected', () => {
  it('rejects a "durable" bundle whose members are all signal-only', () => {
    const result = validateBundle(
      bundleOf('durable', [req('a'), req('b')]),
      registryOf([
        { name: 'a', transport: 'signal' },
        { name: 'b', transport: 'signal' },
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('not satisfiable');
    // Names the offenders and their real transports, not just "mismatch".
    expect(result.errors.join('\n')).toContain('a (transport: "signal")');
    expect(result.errors.join('\n')).toContain('b (transport: "signal")');
  });

  it('rejects a "signal" bundle whose members are all durable-only', () => {
    const result = validateBundle(
      bundleOf('signal', [req('a')]),
      registryOf([{ name: 'a', transport: 'durable' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('signal bus');
  });

  it('rejects a MIXED set under a narrowed claim — one bad member is enough', () => {
    // The dangerous shape: most members satisfy the claim, one does not.
    // A rule that looked at "any" rather than "every" would pass this.
    const result = validateBundle(
      bundleOf('durable', [req('a'), req('b'), req('c')]),
      registryOf([
        { name: 'a', transport: 'both' },
        { name: 'b', transport: 'durable' },
        { name: 'c', transport: 'signal' }, // the one that breaks it
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('c (transport: "signal")');
    expect(result.errors.join('\n')).toContain('1 event(s)');
  });

  it('rejects "both" when nothing in the set reaches the durable bus', () => {
    const result = validateBundle(
      bundleOf('both', [req('a'), req('b')]),
      registryOf([
        { name: 'a', transport: 'signal' },
        { name: 'b', transport: 'signal' },
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('delivered on the durable bus');
  });

  it('rejects "both" when nothing in the set reaches the signal bus', () => {
    const result = validateBundle(
      bundleOf('both', [req('a')]),
      registryOf([{ name: 'a', transport: 'durable' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('delivered on the signal bus');
  });

  it('rejects a transport value that is not a transport at all', () => {
    // Reachable from POST /api/feature-bundles/validate, where the body is
    // untyped JSON. Falling through to the 'both' branch by default meant
    // "kafka" got silently checked as if it were "both".
    const result = validateBundle(
      bundleOf('kafka', [req('a')]),
      registryOf([{ name: 'a', transport: 'signal' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('unknown transport');
  });
});

// ---------------------------------------------------------------------------
// Bundles that assert nothing
// ---------------------------------------------------------------------------

describe('validateBundle — bundles that assert nothing', () => {
  it('rejects an empty member list', () => {
    const result = validateBundle(bundleOf('durable', []), registryOf([]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('declares no events');
  });

  it('rejects an empty member list even against a full registry', () => {
    const result = validateBundle(
      bundleOf('signal', []),
      registryOf([{ name: 'a', transport: 'signal' }]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a set where every member is optional and none are registered', () => {
    const result = validateBundle(
      bundleOf('durable', [opt('ghost.one'), opt('ghost.two')]),
      registryOf([]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('unverifiable');
  });

  it('does NOT pile an "unverifiable" error on top of missing-required errors', () => {
    // Three required members, none registered: three errors, not four. The
    // operator's problem is the three missing events, said once each.
    const result = validateBundle(
      bundleOf('durable', [req('x'), req('y'), req('z')]),
      registryOf([]),
    );
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join('\n')).not.toContain('unverifiable');
  });

  it('rejects a duplicate member', () => {
    const result = validateBundle(
      bundleOf('signal', [req('a'), req('a')]),
      registryOf([{ name: 'a', transport: 'signal' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('listed more than once');
  });

  it('rejects a member the catalog has but with no transport recorded', () => {
    // Silently dropping these from the satisfiability set is how a bundle
    // full of them ends up satisfying any claim.
    const result = validateBundle(
      bundleOf('durable', [req('a')]),
      registryOf([{ name: 'a' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('no transport recorded');
  });
});

// ---------------------------------------------------------------------------
// The cases the rewrite exists to allow
// ---------------------------------------------------------------------------

describe('validateBundle — legitimate narrowing still passes', () => {
  it('accepts "durable" over members declared "both" — the shipped case', () => {
    // agentic-pipeline-durable@1.0.0. This is what the equality rule broke.
    const result = validateBundle(
      bundleOf('durable', [
        req('pipeline.approval.requested'),
        req('pipeline.approval.recorded'),
        req('pipeline.approval.resolved'),
      ]),
      registryOf([
        { name: 'pipeline.approval.requested', transport: 'both' },
        { name: 'pipeline.approval.recorded', transport: 'both' },
        { name: 'pipeline.approval.resolved', transport: 'both' },
      ]),
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('accepts "signal" over the same "both" members — the sibling bundle', () => {
    const result = validateBundle(
      bundleOf('signal', [req('pipeline.approval.requested')]),
      registryOf([{ name: 'pipeline.approval.requested', transport: 'both' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts "both" over a set that genuinely spans the two buses', () => {
    const result = validateBundle(
      bundleOf('both', [req('a'), req('b')]),
      registryOf([
        { name: 'a', transport: 'signal' },
        { name: 'b', transport: 'durable' },
      ]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts an optional member that is absent, as long as something is registered', () => {
    const result = validateBundle(
      bundleOf('signal', [req('a'), opt('ghost')]),
      registryOf([{ name: 'a', transport: 'signal' }]),
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Member schema pins (EventReference.version)
// ---------------------------------------------------------------------------

describe('validateBundle — EventReference.version pins the member SCHEMA', () => {
  it('passes when the pin equals the registry revision', () => {
    const result = validateBundle(
      bundleOf('signal', [{ name: 'a', required: true, version: 3 }]),
      registryOf([{ name: 'a', transport: 'signal', version: 3 }]),
    );
    expect(result.valid).toBe(true);
  });

  it('fails when the registry has moved past the pin', () => {
    const result = validateBundle(
      bundleOf('signal', [{ name: 'a', required: true, version: 3 }]),
      registryOf([{ name: 'a', transport: 'signal', version: 4 }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('pins v3 but registry has v4');
  });

  it('is exact equality, not a floor — an older registry also fails', () => {
    const result = validateBundle(
      bundleOf('signal', [{ name: 'a', required: true, version: 5 }]),
      registryOf([{ name: 'a', transport: 'signal', version: 2 }]),
    );
    expect(result.valid).toBe(false);
  });

  it('an unpinned member accepts whatever revision the registry holds', () => {
    const result = validateBundle(
      bundleOf('signal', [req('a')]),
      registryOf([{ name: 'a', transport: 'signal', version: 97 }]),
    );
    expect(result.valid).toBe(true);
  });

  it('a pin on an optional-and-absent member is not checked', () => {
    const result = validateBundle(
      bundleOf('signal', [req('a'), { name: 'ghost', required: false, version: 2 }]),
      registryOf([{ name: 'a', transport: 'signal' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('a pin breaks on a backward-COMPATIBLE schema edit — the documented trap', () => {
    // Registry.declare bumps `version` on any schema change, compatible or
    // not. So a pinned member fails the moment its producer adds an
    // optional field, even though nothing about the bundle stopped working.
    // This is why no shipped bundle pins, and why the field's doc comment
    // says to expect to bump it deliberately.
    const registry = new Registry();
    registry.declare({
      name: 'pinned.event',
      transport: 'signal',
      producer: 'svc',
      schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    } as never);

    const pinned = bundleOf('signal', [{ name: 'pinned.event', required: true, version: 1 }]);
    expect(validateBundle(pinned, registry).valid).toBe(true);

    // Purely additive, optional property: backward compatible by any rule.
    registry.declare({
      name: 'pinned.event',
      transport: 'signal',
      producer: 'svc',
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, note: { type: 'string' } },
        required: ['id'],
      },
    } as never);

    const after = validateBundle(pinned, registry);
    expect(after.valid).toBe(false);
    expect(after.errors[0]).toContain('pins v1 but registry has v2');
  });
});

// ---------------------------------------------------------------------------
// Error messages have to point at the typo, not at the CRD
// ---------------------------------------------------------------------------

describe('validateBundle — a missing member names the likely intent', () => {
  it('suggests the separator-correct name', () => {
    const result = validateBundle(
      bundleOf('signal', [req('pipeline.run.started')]),
      registryOf([{ name: 'pipeline:run:started', transport: 'signal' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Did you mean "pipeline:run:started"');
  });

  it('says nothing when no candidate is close', () => {
    const result = validateBundle(
      bundleOf('signal', [req('totally.unrelated.thing')]),
      registryOf([{ name: 'a', transport: 'signal' }]),
    );
    expect(result.errors[0]).not.toContain('Did you mean');
  });
});

// ---------------------------------------------------------------------------
// isBundleTransport
// ---------------------------------------------------------------------------

describe('isBundleTransport', () => {
  it('accepts exactly the three declared transports', () => {
    for (const t of BUNDLE_TRANSPORTS) expect(isBundleTransport(t)).toBe(true);
  });

  it('rejects anything else, including near misses and non-strings', () => {
    for (const bad of ['Signal', 'sqs', '', 'signal ', null, undefined, 1, {}]) {
      expect(isBundleTransport(bad)).toBe(false);
    }
  });
});
