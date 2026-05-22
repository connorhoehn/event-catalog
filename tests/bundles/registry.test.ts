// tests/bundles/registry.test.ts
//
// Unit tests for FeatureBundleRegistry and module-level bundle functions.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FeatureBundleRegistry,
  computeFingerprint,
  type FeatureBundle,
  type EventReference,
} from '../../src/bundles/FeatureBundle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBundle(overrides: Partial<Omit<FeatureBundle, 'fingerprint'>> = {}): Omit<FeatureBundle, 'fingerprint'> {
  return {
    name: 'test-bundle',
    version: '1.0.0',
    transport: 'signal',
    events: [
      { name: 'ws.chat.message', required: true },
      { name: 'ws.chat.joined', required: true },
    ],
    ...overrides,
  };
}

/** Minimal IRegistry stub that knows about a fixed set of events. */
function makeRegistry(events: Array<{ name: string; transport: 'signal' | 'durable'; version?: number }>) {
  return {
    get: (name: string) => {
      const ev = events.find((e) => e.name === name);
      if (!ev) return undefined;
      return { name: ev.name, transport: ev.transport, version: ev.version ?? 1 };
    },
    declare: () => ({ version: 1, compatible: true, violations: [], schemaFingerprint: '' }),
    list: () => [],
    addSubscriber: () => {},
    removeSubscriber: () => {},
    updateStats: () => {},
    remove: () => false,
    getTopology: () => ({ nodes: [], edges: [] }),
    validate: () => ({ valid: true }),
    checkSchemaCompat: () => ({ compatible: true, mode: 'backward' as const, violations: [] }),
    size: () => events.length,
    clear: () => {},
  };
}

// ---------------------------------------------------------------------------
// FeatureBundleRegistry tests
// ---------------------------------------------------------------------------

describe('FeatureBundleRegistry', () => {
  let reg: FeatureBundleRegistry;

  beforeEach(() => {
    reg = new FeatureBundleRegistry();
  });

  // -------------------------------------------------------------------------
  // register + get round-trip
  // -------------------------------------------------------------------------

  it('register + get round-trip returns the bundle with a computed fingerprint', () => {
    const def = makeBundle();
    const result = reg.register(def);

    expect(result.name).toBe('test-bundle');
    expect(result.version).toBe('1.0.0');
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const fetched = reg.get('test-bundle', '1.0.0');
    expect(fetched).toBeDefined();
    expect(fetched!.fingerprint).toBe(result.fingerprint);
  });

  it('get without version returns the latest semver', () => {
    reg.register(makeBundle({ version: '1.0.0' }));
    reg.register(makeBundle({ version: '2.0.0' }));
    reg.register(makeBundle({ version: '1.5.0' }));

    const latest = reg.get('test-bundle');
    expect(latest!.version).toBe('2.0.0');
  });

  it('get with an unknown name returns undefined', () => {
    expect(reg.get('does-not-exist')).toBeUndefined();
  });

  it('get with a specific version returns that version', () => {
    reg.register(makeBundle({ version: '1.0.0' }));
    reg.register(makeBundle({ version: '2.0.0' }));

    expect(reg.get('test-bundle', '1.0.0')!.version).toBe('1.0.0');
    expect(reg.get('test-bundle', '2.0.0')!.version).toBe('2.0.0');
    expect(reg.get('test-bundle', '3.0.0')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  it('list returns all registered bundles sorted by name then version', () => {
    reg.register(makeBundle({ name: 'presence', version: '1.0.0' }));
    reg.register(makeBundle({ name: 'chat', version: '2.0.0' }));
    reg.register(makeBundle({ name: 'chat', version: '1.0.0' }));

    const listed = reg.list();
    expect(listed.map((b) => `${b.name}@${b.version}`)).toEqual([
      'chat@1.0.0',
      'chat@2.0.0',
      'presence@1.0.0',
    ]);
  });

  it('list returns empty array when nothing registered', () => {
    expect(reg.list()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // idempotent re-registration
  // -------------------------------------------------------------------------

  it('registering the same bundle twice (same events) is idempotent', () => {
    const def = makeBundle();
    const first = reg.register(def);
    const second = reg.register(def);

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(reg.list()).toHaveLength(1);
  });

  it('registering the same name+version with a different event set throws', () => {
    reg.register(makeBundle());
    expect(() =>
      reg.register(makeBundle({ events: [{ name: 'ws.chat.left', required: true }] })),
    ).toThrow(/different event set/);
  });

  // -------------------------------------------------------------------------
  // findByFingerprint
  // -------------------------------------------------------------------------

  it('findByFingerprint reverse lookup works', () => {
    const registered = reg.register(makeBundle());
    const found = reg.findByFingerprint(registered.fingerprint);

    expect(found).toBeDefined();
    expect(found!.name).toBe('test-bundle');
    expect(found!.fingerprint).toBe(registered.fingerprint);
  });

  it('findByFingerprint returns undefined for unknown fingerprint', () => {
    reg.register(makeBundle());
    expect(reg.findByFingerprint('0'.repeat(64))).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // validate — event existence
  // -------------------------------------------------------------------------

  it('validate passes when all required events exist in the registry', () => {
    const bundle = reg.register(makeBundle());
    const eventReg = makeRegistry([
      { name: 'ws.chat.message', transport: 'signal' },
      { name: 'ws.chat.joined', transport: 'signal' },
    ]);
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validate catches a missing required event', () => {
    const bundle = reg.register(makeBundle());
    const eventReg = makeRegistry([
      // ws.chat.joined is intentionally absent
      { name: 'ws.chat.message', transport: 'signal' },
    ]);
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ws.chat.joined'))).toBe(true);
  });

  it('validate does NOT fail when an optional event is missing', () => {
    const def = makeBundle({
      events: [
        { name: 'ws.chat.message', required: true },
        { name: 'ws.chat.joined', required: false }, // optional — may be absent
      ],
    });
    const bundle = reg.register(def);
    const eventReg = makeRegistry([
      { name: 'ws.chat.message', transport: 'signal' },
      // ws.chat.joined absent but optional
    ]);
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validate collects ALL errors (collect-all style, no fail-first)', () => {
    const def = makeBundle({
      events: [
        { name: 'ws.missing.a', required: true },
        { name: 'ws.missing.b', required: true },
        { name: 'ws.missing.c', required: true },
      ],
    });
    const bundle = reg.register(def);
    const eventReg = makeRegistry([]); // empty — all three will be missing
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // validate — version pinning
  // -------------------------------------------------------------------------

  it('validate catches a version mismatch when EventReference.version is pinned', () => {
    const def = makeBundle({
      events: [
        { name: 'ws.chat.message', required: true, version: 5 },
      ],
    });
    const bundle = reg.register(def);
    const eventReg = makeRegistry([
      { name: 'ws.chat.message', transport: 'signal', version: 3 }, // registry has v3, bundle wants v5
    ]);
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ws.chat.message') && e.includes('version mismatch'))).toBe(true);
  });

  it('validate passes when EventReference.version matches registry version', () => {
    const def = makeBundle({
      events: [
        { name: 'ws.chat.message', required: true, version: 3 },
      ],
    });
    const bundle = reg.register(def);
    const eventReg = makeRegistry([
      { name: 'ws.chat.message', transport: 'signal', version: 3 },
    ]);
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // validate — transport coherence
  // -------------------------------------------------------------------------

  it('validate catches a declared transport that does not match inferred transport', () => {
    const def = makeBundle({
      transport: 'durable', // declared durable but events are all signal
      events: [{ name: 'ws.chat.message', required: true }],
    });
    const bundle = reg.register(def);
    const eventReg = makeRegistry([
      { name: 'ws.chat.message', transport: 'signal' },
    ]);
    const result = reg.validate(bundle, eventReg as any);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('transport'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeFingerprint unit tests
// ---------------------------------------------------------------------------

describe('computeFingerprint', () => {
  it('returns a 64-char lowercase hex string', () => {
    const fp = computeFingerprint({ name: 'chat', version: '1.0.0', events: [] });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable — same input always yields the same fingerprint', () => {
    const def = { name: 'chat', version: '1.0.0', events: [{ name: 'ws.chat.message', required: true }] };
    expect(computeFingerprint(def)).toBe(computeFingerprint(def));
  });

  it('is sensitive — any name change yields a different fingerprint', () => {
    const a = { name: 'chat', version: '1.0.0', events: [] };
    const b = { name: 'chat-v2', version: '1.0.0', events: [] };
    expect(computeFingerprint(a)).not.toBe(computeFingerprint(b));
  });

  it('is sensitive — any version change yields a different fingerprint', () => {
    const a = { name: 'chat', version: '1.0.0', events: [] };
    const b = { name: 'chat', version: '1.0.1', events: [] };
    expect(computeFingerprint(a)).not.toBe(computeFingerprint(b));
  });

  it('is sensitive — adding an event changes the fingerprint', () => {
    const a = { name: 'chat', version: '1.0.0', events: [] };
    const b = { name: 'chat', version: '1.0.0', events: [{ name: 'ws.chat.message', required: true }] };
    expect(computeFingerprint(a)).not.toBe(computeFingerprint(b));
  });

  it('is insensitive to event list ordering (events are sorted before hashing)', () => {
    const events1: EventReference[] = [
      { name: 'ws.chat.joined', required: true },
      { name: 'ws.chat.message', required: true },
    ];
    const events2: EventReference[] = [
      { name: 'ws.chat.message', required: true },
      { name: 'ws.chat.joined', required: true },
    ];
    const a = { name: 'chat', version: '1.0.0', events: events1 };
    const b = { name: 'chat', version: '1.0.0', events: events2 };
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it('is insensitive to description and deprecated fields (excluded from hash input)', () => {
    const base = { name: 'chat', version: '1.0.0', events: [{ name: 'ws.chat.message' }] };
    const withDesc = { ...base, description: 'A chat bundle', deprecated: { since: '2026-01-01' } };
    // computeFingerprint only uses name/version/events, so these should match
    expect(computeFingerprint(base)).toBe(computeFingerprint(withDesc as any));
  });
});
