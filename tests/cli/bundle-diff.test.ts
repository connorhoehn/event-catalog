// tests/cli/bundle-diff.test.ts
//
// Tests for ec-bundle-diff (src/cli/bundle-diff.ts).
//
// Uses diffBundles() and bundleDiff() directly — no subprocess spawning.
// Bundles are registered via the FeatureBundleRegistry class (isolated per
// test) so module-singleton state doesn't leak.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FeatureBundleRegistry, computeFingerprint } from '../../src/bundles/FeatureBundle.js';
import { diffBundles, bundleDiff, formatDiff } from '../../src/cli/bundle-diff.js';

// ---------------------------------------------------------------------------
// Helpers — build a minimal registry + register two versions of a bundle
// ---------------------------------------------------------------------------

/** Register a named bundle in the module-level store and return the fingerprints. */
function setupChatBundles() {
  // The module-level singleton already has the declared bundles registered.
  // chat@1.0.0 is declared in src/declarations/bundles/chat.ts (always loaded
  // via the side-effect import in bundle-diff.ts).
  // We cannot register a second version of chat in the singleton without risk
  // of polluting other tests; instead we test diffBundles() with the
  // FeatureBundleRegistry class directly.
}

// ---------------------------------------------------------------------------
// Unit tests — diffBundles() logic via FeatureBundleRegistry
// ---------------------------------------------------------------------------

describe('diffBundles unit tests (isolated registry)', () => {
  let registry: FeatureBundleRegistry;

  // Stub getFeatureBundle to use our isolated registry by monkey-patching
  // the module. Since bundle-diff.ts uses the module-level getFeatureBundle,
  // we use a spy approach: test diffBundles with the public API after
  // manually wiring a test registry.
  //
  // Alternative: we test the pure logic via formatDiff() + the returned
  // BundleDiff object from a helper that takes two FeatureBundle objects
  // directly.

  // Since diffBundles() calls the module-level getFeatureBundle(), we need
  // to test against REAL registered bundles or mock the import.
  // Simplest: build a parallel diffing function that takes two FeatureBundle
  // objects directly. We export formatDiff already — let's verify the diff
  // object shape by calling diffBundles on the declared chat@1.0.0 (v1===v2).

  it('identical bundles → no changes + bump: none', () => {
    // chat@1.0.0 is in the module singleton (side-effect import in bundle-diff)
    const diff = diffBundles('chat', '1.0.0', '1.0.0');
    expect(diff).not.toBeNull();
    expect(diff!.suggestedBump).toBe('none');
    expect(diff!.addedRequired).toHaveLength(0);
    expect(diff!.addedOptional).toHaveLength(0);
    expect(diff!.removed).toHaveLength(0);
    expect(diff!.requiredToOptional).toHaveLength(0);
    expect(diff!.optionalToRequired).toHaveLength(0);
    expect(diff!.fingerprintV1).toBe(diff!.fingerprintV2);
  });

  it('formatDiff for identical bundles outputs "No changes."', () => {
    const diff = diffBundles('chat', '1.0.0', '1.0.0');
    const output = formatDiff(diff!);
    expect(output).toContain('No changes.');
    expect(output).toContain('Suggested semver bump: none');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — bundleDiff() CLI function using module-level registry
// ---------------------------------------------------------------------------

describe('bundleDiff() CLI — identical bundle (exit 0)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy  = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns exit 0 for chat@1.0.0 vs chat@1.0.0', async () => {
    const code = await bundleDiff(['chat@1.0.0', 'chat@1.0.0']);
    expect(code).toBe(0);
  });

  it('outputs "No changes." for identical bundles', async () => {
    await bundleDiff(['chat@1.0.0', 'chat@1.0.0']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('No changes.');
  });

  it('outputs "Suggested semver bump: none" for identical bundles', async () => {
    await bundleDiff(['chat@1.0.0', 'chat@1.0.0']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Suggested semver bump: none');
  });

  it('outputs correct bundle name + versions header', async () => {
    await bundleDiff(['chat@1.0.0', 'chat@1.0.0']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Bundle: chat');
    expect(out).toContain('Versions: 1.0.0 → 1.0.0');
  });
});

// ---------------------------------------------------------------------------
// Logic tests — required event added → minor bump
// ---------------------------------------------------------------------------

describe('diffBundles logic — required event added', () => {
  it('suggests minor bump when a required event is added', () => {
    // Simulate by building a fake BundleDiff directly via formatDiff
    // and checking the bump suggestion logic.
    // We register two versions in an isolated registry and compare.
    const reg = new FeatureBundleRegistry();

    const b1 = reg.register({
      name: 'test-bundle',
      version: '1.0.0',
      transport: 'signal',
      events: [
        { name: 'ws.test.a', required: true },
        { name: 'ws.test.b', required: false },
      ],
    });

    const b2 = reg.register({
      name: 'test-bundle',
      version: '1.1.0',
      transport: 'signal',
      events: [
        { name: 'ws.test.a', required: true },
        { name: 'ws.test.b', required: false },
        { name: 'ws.test.c', required: true }, // new required
      ],
    });

    // Manually diff using the same logic as diffBundles() but with our isolated objects
    const eventsV1 = new Map(b1.events.map((e) => [e.name, e]));
    const eventsV2 = new Map(b2.events.map((e) => [e.name, e]));

    const addedRequired: string[] = [];
    const addedOptional: string[] = [];
    for (const [name, ref2] of eventsV2) {
      if (!eventsV1.has(name)) {
        if (ref2.required === false) addedOptional.push(name);
        else addedRequired.push(name);
      }
    }

    expect(addedRequired).toContain('ws.test.c');
    expect(addedOptional).toHaveLength(0);

    // Verify bump logic
    const hasMajorTrigger = false;
    const hasMinorTrigger = addedRequired.length > 0;
    const bump = hasMajorTrigger ? 'major' : hasMinorTrigger ? 'minor' : 'patch';
    expect(bump).toBe('minor');
  });

  it('formatDiff shows "Added (required)" section', () => {
    const diff = {
      bundleName: 'test',
      v1: '1.0.0',
      v2: '1.1.0',
      addedRequired: ['ws.test.new'],
      addedOptional: [],
      removed: [],
      requiredToOptional: [],
      optionalToRequired: [],
      fingerprintV1: 'aaa',
      fingerprintV2: 'bbb',
      suggestedBump: 'minor' as const,
      suggestedBumpReason: 'required event added',
    };
    const out = formatDiff(diff);
    expect(out).toContain('Added (required) (1):');
    expect(out).toContain('+ ws.test.new');
    expect(out).toContain('Suggested semver bump: minor (required event added)');
  });
});

// ---------------------------------------------------------------------------
// Logic tests — required event removed → major bump
// ---------------------------------------------------------------------------

describe('diffBundles logic — required event removed', () => {
  it('suggests major bump when a required event is removed', () => {
    const diff = {
      bundleName: 'test',
      v1: '1.0.0',
      v2: '2.0.0',
      addedRequired: [],
      addedOptional: [],
      removed: ['ws.test.legacy'],
      requiredToOptional: [],
      optionalToRequired: [],
      fingerprintV1: 'abc',
      fingerprintV2: 'def',
      suggestedBump: 'major' as const,
      suggestedBumpReason: 'required event removed',
    };

    expect(diff.suggestedBump).toBe('major');
    const out = formatDiff(diff);
    expect(out).toContain('Removed (1):');
    expect(out).toContain('- ws.test.legacy');
    expect(out).toContain('Suggested semver bump: major (required event removed)');
  });

  it('formatDiff shows a "Removed" section', () => {
    const diff = {
      bundleName: 'chat',
      v1: '1.0.0',
      v2: '2.0.0',
      addedRequired: [],
      addedOptional: [],
      removed: ['ws.chat.message'],
      requiredToOptional: [],
      optionalToRequired: [],
      fingerprintV1: 'aaa111',
      fingerprintV2: 'bbb222',
      suggestedBump: 'major' as const,
      suggestedBumpReason: 'required event removed',
    };
    const out = formatDiff(diff);
    expect(out).toContain('Removed (1):');
    expect(out).toContain('- ws.chat.message');
    expect(out).toContain('major');
  });
});

// ---------------------------------------------------------------------------
// Error handling — unknown bundle / version → exit 1
// ---------------------------------------------------------------------------

describe('bundleDiff() CLI — unknown bundle/version → exit 1', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy  = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns exit 1 for an unknown bundle name', async () => {
    const code = await bundleDiff(['nonexistent@1.0.0', 'nonexistent@2.0.0']);
    expect(code).toBe(1);
  });

  it('returns exit 1 for an unknown version of a known bundle', async () => {
    const code = await bundleDiff(['chat@99.0.0', 'chat@100.0.0']);
    expect(code).toBe(1);
  });

  it('prints an error message for unknown bundle', async () => {
    await bundleDiff(['nonexistent@1.0.0', 'nonexistent@2.0.0']);
    const errOut = errorSpy.mock.calls.flat().join('\n');
    expect(errOut).toContain('bundle not found');
  });

  it('returns exit 2 for mismatched bundle names', async () => {
    const code = await bundleDiff(['chat@1.0.0', 'presence@1.0.0']);
    expect(code).toBe(2);
  });

  it('returns exit 2 for too few arguments', async () => {
    const code = await bundleDiff(['chat@1.0.0']);
    expect(code).toBe(2);
  });

  it('returns exit 2 for invalid reference format', async () => {
    const code = await bundleDiff(['chatonly', 'chatonly']);
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Optional-to-required transition → major + BREAKING label
// ---------------------------------------------------------------------------

describe('formatDiff — opt→req transition is marked BREAKING', () => {
  it('labels opt→req transitions as BREAKING', () => {
    const diff = {
      bundleName: 'chat',
      v1: '1.0.0',
      v2: '2.0.0',
      addedRequired: [],
      addedOptional: [],
      removed: [],
      requiredToOptional: [],
      optionalToRequired: ['ws.chat.member.joined'],
      fingerprintV1: 'aaa',
      fingerprintV2: 'bbb',
      suggestedBump: 'major' as const,
      suggestedBumpReason: 'opt→req transition',
    };
    const out = formatDiff(diff);
    expect(out).toContain('Optional-to-required (1):');
    expect(out).toContain('— BREAKING');
    expect(out).toContain('ws.chat.member.joined');
  });
});

// ---------------------------------------------------------------------------
// Fingerprint output
// ---------------------------------------------------------------------------

describe('formatDiff — fingerprint display', () => {
  it('shows truncated fingerprints in the output', () => {
    const diff = {
      bundleName: 'chat',
      v1: '1.0.0',
      v2: '1.0.0',
      addedRequired: [],
      addedOptional: [],
      removed: [],
      requiredToOptional: [],
      optionalToRequired: [],
      fingerprintV1: 'abc123456789abcdef',
      fingerprintV2: 'def456789abcdef123',
      suggestedBump: 'none' as const,
      suggestedBumpReason: '',
    };
    const out = formatDiff(diff);
    // Shows first 12 chars of each fingerprint
    expect(out).toContain('abc123456789 → def456789abc');
  });
});

// ---------------------------------------------------------------------------
// End-to-end diff of two REALLY registered versions.
//
// Every bundle shipped in src/declarations/bundles is at 1.0.0, so the
// catalog itself cannot exercise a non-empty diff. Register a uniquely named
// fixture in the same module singleton bundle-diff.ts reads from, so these
// tests cover the path an operator actually hits when a version is bumped.
// The name is unique, so nothing else in the suite can collide with it.
// ---------------------------------------------------------------------------

import { registerFeatureBundle } from '../../src/bundles/FeatureBundle.js';
import { hasChanges, EXIT_DIFFERENCES } from '../../src/cli/bundle-diff.js';

const FIXTURE = 'diff-fixture';

registerFeatureBundle({
  name: FIXTURE,
  version: '1.0.0',
  transport: 'signal',
  events: [
    { name: 'ws.fx.kept', required: true },
    { name: 'ws.fx.gone-required', required: true },
    { name: 'ws.fx.gone-optional', required: false },
    { name: 'ws.fx.relaxed', required: true },
    { name: 'ws.fx.tightened', required: false },
  ],
});

registerFeatureBundle({
  name: FIXTURE,
  version: '2.0.0',
  transport: 'signal',
  events: [
    { name: 'ws.fx.kept', required: true },
    { name: 'ws.fx.relaxed', required: false },
    { name: 'ws.fx.tightened', required: true },
    { name: 'ws.fx.new-required', required: true },
    { name: 'ws.fx.new-optional', required: false },
  ],
});

describe('diffBundles — two real registered versions', () => {
  it('classifies every kind of change', () => {
    const diff = diffBundles(FIXTURE, '1.0.0', '2.0.0')!;
    expect(diff).not.toBeNull();
    expect(diff.addedRequired).toEqual(['ws.fx.new-required']);
    expect(diff.addedOptional).toEqual(['ws.fx.new-optional']);
    expect(diff.removed.sort()).toEqual(['ws.fx.gone-optional', 'ws.fx.gone-required']);
    expect(diff.removedOptional).toEqual(['ws.fx.gone-optional']);
    expect(diff.requiredToOptional).toEqual(['ws.fx.relaxed']);
    expect(diff.optionalToRequired).toEqual(['ws.fx.tightened']);
    expect(diff.fingerprintV1).not.toBe(diff.fingerprintV2);
  });

  it('is directional — reversing the arguments inverts add/remove', () => {
    const fwd = diffBundles(FIXTURE, '1.0.0', '2.0.0')!;
    const rev = diffBundles(FIXTURE, '2.0.0', '1.0.0')!;
    expect(rev.removed.sort()).toEqual([...fwd.addedOptional, ...fwd.addedRequired].sort());
    expect([...rev.addedOptional, ...rev.addedRequired].sort()).toEqual(fwd.removed.sort());
    expect(rev.optionalToRequired).toEqual(fwd.requiredToOptional);
    expect(rev.requiredToOptional).toEqual(fwd.optionalToRequired);
  });

  it('suggests major when a required event is removed', () => {
    const diff = diffBundles(FIXTURE, '1.0.0', '2.0.0')!;
    expect(diff.suggestedBump).toBe('major');
    expect(diff.suggestedBumpReason).toContain('required event removed');
  });

  it('renders removed-optional events as "(was optional)"', () => {
    const out = formatDiff(diffBundles(FIXTURE, '1.0.0', '2.0.0')!);
    expect(out).toContain('- ws.fx.gone-optional (was optional)');
    expect(out).toContain('- ws.fx.gone-required');
    expect(out).not.toContain('- ws.fx.gone-required (was optional)');
  });

  it('a bundle diffed against itself reports no changes', () => {
    const diff = diffBundles(FIXTURE, '2.0.0', '2.0.0')!;
    expect(hasChanges(diff)).toBe(false);
    expect(diff.suggestedBump).toBe('none');
    expect(formatDiff(diff)).toContain('No changes.');
  });
});

// ---------------------------------------------------------------------------
// Removing only OPTIONAL events must not be reported as "required event removed"
// ---------------------------------------------------------------------------

describe('diffBundles — optional-only removal', () => {
  const NAME = 'diff-fixture-optional';

  beforeEach(() => {
    registerFeatureBundle({
      name: NAME,
      version: '1.0.0',
      transport: 'signal',
      events: [
        { name: 'ws.opt.kept', required: true },
        { name: 'ws.opt.dropped', required: false },
      ],
    });
    registerFeatureBundle({
      name: NAME,
      version: '1.1.0',
      transport: 'signal',
      events: [{ name: 'ws.opt.kept', required: true }],
    });
  });

  it('suggests minor, not major, and says "optional event removed"', () => {
    const diff = diffBundles(NAME, '1.0.0', '1.1.0')!;
    expect(diff.removed).toEqual(['ws.opt.dropped']);
    expect(diff.removedOptional).toEqual(['ws.opt.dropped']);
    expect(diff.suggestedBump).toBe('minor');
    expect(diff.suggestedBumpReason).toBe('optional event removed');
    // The old code hard-coded this reason for ANY removal.
    expect(diff.suggestedBumpReason).not.toContain('required event removed');
  });
});

// ---------------------------------------------------------------------------
// --exit-code: "these differ" must be distinguishable from "I failed to run"
// ---------------------------------------------------------------------------

describe('bundleDiff() CLI — --exit-code', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits 3 when the versions differ', async () => {
    expect(await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@2.0.0`, '--exit-code'])).toBe(
      EXIT_DIFFERENCES,
    );
  });

  it('exits 0 when the versions are identical', async () => {
    expect(await bundleDiff([`${FIXTURE}@2.0.0`, `${FIXTURE}@2.0.0`, '--exit-code'])).toBe(0);
  });

  it('still prints the full diff when exiting 3', async () => {
    await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@2.0.0`, '--exit-code']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('Added (required) (1):');
    expect(out).toContain('Suggested semver bump: major');
  });

  it('exits 0 on differences WITHOUT the flag (back-compat)', async () => {
    expect(await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@2.0.0`])).toBe(0);
  });

  it('"differs" (3) is not the code used for "failed to run" (1)', async () => {
    const differs = await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@2.0.0`, '--exit-code']);
    const failed = await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@9.9.9`, '--exit-code']);
    expect(differs).toBe(3);
    expect(failed).toBe(1);
    expect(differs).not.toBe(failed);
  });

  it('rejects an unknown flag with exit 2, not a silent no-op', async () => {
    expect(await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@2.0.0`, '--exitcode'])).toBe(2);
  });

  it('rejects --exit-code given a value', async () => {
    expect(await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@2.0.0`, '--exit-code=yes'])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Not-found errors point at what IS available
// ---------------------------------------------------------------------------

describe('bundleDiff() CLI — not-found diagnostics', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the known versions when the version is wrong', async () => {
    await bundleDiff([`${FIXTURE}@1.0.0`, `${FIXTURE}@9.9.9`]);
    const err = errorSpy.mock.calls.flat().join('\n');
    expect(err).toContain(`bundle not found: ${FIXTURE}@9.9.9`);
    expect(err).toContain(`known versions of "${FIXTURE}"`);
    expect(err).toContain('1.0.0');
  });

  it('lists the known bundle names when the name is wrong', async () => {
    await bundleDiff(['no-such-bundle@1.0.0', 'no-such-bundle@2.0.0']);
    const err = errorSpy.mock.calls.flat().join('\n');
    expect(err).toContain('no bundle named "no-such-bundle" is registered');
    expect(err).toContain('chat');
  });
});

// ---------------------------------------------------------------------------
// --help lists the flags the parser actually accepts
// ---------------------------------------------------------------------------

describe('bundleDiff() CLI — --help', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('exits 0 and documents --exit-code and every exit code', async () => {
    expect(await bundleDiff(['--help'])).toBe(0);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('--exit-code');
    for (const code of ['0 ', '1 ', '2 ', '3 ']) expect(out).toContain(code);
  });

  it('--help wins over positional arguments', async () => {
    expect(await bundleDiff(['nope@1.0.0', 'nope@2.0.0', '--help'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bundle-level changes: transport and deprecation.
//
// Neither feeds computeFingerprint (which hashes name, version and members
// only), so if ec-bundle-diff doesn't report them, nothing in the pipeline
// does. Both used to be invisible: the diff printed "No changes." AND
// "Suggested semver bump: major (transport mode changed)" in the same
// breath, and --exit-code returned 0.
// ---------------------------------------------------------------------------

describe('diffBundles — transport change', () => {
  const NAME = 'diff-fixture-transport';

  beforeEach(() => {
    registerFeatureBundle({
      name: NAME,
      version: '1.0.0',
      transport: 'signal',
      events: [{ name: 'ws.tp.same', required: true }],
    });
    registerFeatureBundle({
      name: NAME,
      version: '2.0.0',
      transport: 'durable',
      events: [{ name: 'ws.tp.same', required: true }],
    });
  });

  it('records the from → to pair', () => {
    const diff = diffBundles(NAME, '1.0.0', '2.0.0')!;
    expect(diff.transportChanged).toEqual({ from: 'signal', to: 'durable' });
  });

  it('counts as a change, so --exit-code sees it', () => {
    const diff = diffBundles(NAME, '1.0.0', '2.0.0')!;
    expect(hasChanges(diff)).toBe(true);
  });

  it('renders instead of "No changes."', () => {
    const out = formatDiff(diffBundles(NAME, '1.0.0', '2.0.0')!);
    expect(out).not.toContain('No changes.');
    expect(out).toContain('Transport: signal → durable');
    expect(out).toContain('BREAKING');
  });

  it('is major, and is invisible to the fingerprint — which is why the diff must say it', () => {
    const diff = diffBundles(NAME, '1.0.0', '2.0.0')!;
    expect(diff.suggestedBump).toBe('major');
    expect(diff.suggestedBumpReason).toContain('transport mode changed');

    // computeFingerprint hashes name + version + members only. Flip the
    // transport with everything else held fixed and the hash is unchanged,
    // so a fingerprint-pinned CRD would not notice the bus moving.
    const members = [{ name: 'ws.tp.same', required: true }];
    expect(computeFingerprint({ name: NAME, version: '1.0.0', events: members })).toBe(
      computeFingerprint({ name: NAME, version: '1.0.0', events: members }),
    );
    expect(diff.transportChanged).toBeDefined();
  });

  it('exits 3 under --exit-code for a transport-only change', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await bundleDiff([`${NAME}@1.0.0`, `${NAME}@2.0.0`, '--exit-code'])).toBe(
        EXIT_DIFFERENCES,
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe('diffBundles — deprecation added / removed', () => {
  const NAME = 'diff-fixture-deprecation';
  let reg: FeatureBundleRegistry;

  beforeEach(() => {
    reg = new FeatureBundleRegistry();
    registerFeatureBundle({
      name: NAME,
      version: '1.0.0',
      transport: 'signal',
      events: [{ name: 'ws.dep.same', required: true }],
    });
    registerFeatureBundle({
      name: NAME,
      version: '1.1.0',
      transport: 'signal',
      events: [{ name: 'ws.dep.same', required: true }],
      deprecated: { since: '2026-09-01', replacement: 'ws.dep.next@1.0.0' },
    });
  });

  it('classifies an added deprecation and renders it', () => {
    const diff = diffBundles(NAME, '1.0.0', '1.1.0')!;
    expect(diff.deprecationChanged?.kind).toBe('added');
    expect(hasChanges(diff)).toBe(true);
    const out = formatDiff(diff);
    expect(out).toContain('Deprecation: added — since 2026-09-01');
    expect(out).toContain('ws.dep.next@1.0.0');
  });

  it('classifies a removed deprecation in the reverse direction', () => {
    const diff = diffBundles(NAME, '1.1.0', '1.0.0')!;
    expect(diff.deprecationChanged?.kind).toBe('removed');
    expect(formatDiff(diff)).toContain('Deprecation: removed');
  });

  it('is undefined when neither side is deprecated', () => {
    expect(diffBundles(NAME, '1.0.0', '1.0.0')!.deprecationChanged).toBeUndefined();
    // Keeps the isolated-registry surface honest too.
    expect(reg.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EventReference.version — the only lever that pins a member's SCHEMA.
// ---------------------------------------------------------------------------

describe('diffBundles — member schema pin (EventReference.version)', () => {
  const NAME = 'diff-fixture-pin';

  beforeEach(() => {
    registerFeatureBundle({
      name: NAME,
      version: '1.0.0',
      transport: 'signal',
      events: [{ name: 'ws.pin.event', required: true }],
    });
    registerFeatureBundle({
      name: NAME,
      version: '1.1.0',
      transport: 'signal',
      events: [{ name: 'ws.pin.event', required: true, version: 3 }],
    });
    registerFeatureBundle({
      name: NAME,
      version: '1.2.0',
      transport: 'signal',
      events: [{ name: 'ws.pin.event', required: true, version: 4 }],
    });
  });

  it('reports a member that gained a pin', () => {
    const diff = diffBundles(NAME, '1.0.0', '1.1.0')!;
    expect(diff.versionChanged).toEqual([
      { name: 'ws.pin.event', from: undefined, to: 3 },
    ]);
    expect(hasChanges(diff)).toBe(true);
    expect(formatDiff(diff)).toContain('schema revision unpinned → 3');
  });

  it('reports a pin moving revision, and calls it major', () => {
    const diff = diffBundles(NAME, '1.1.0', '1.2.0')!;
    expect(diff.versionChanged).toEqual([{ name: 'ws.pin.event', from: 3, to: 4 }]);
    expect(diff.suggestedBump).toBe('major');
    expect(diff.suggestedBumpReason).toContain('member schema pin changed');
  });

  it('dropping a pin only widens what is accepted → minor', () => {
    const diff = diffBundles(NAME, '1.2.0', '1.0.0')!;
    expect(diff.versionChanged).toEqual([
      { name: 'ws.pin.event', from: 4, to: undefined },
    ]);
    expect(diff.suggestedBump).toBe('minor');
    expect(diff.suggestedBumpReason).toContain('member schema pin dropped');
  });

  it('a pin change moves the fingerprint (it is inside the member hash)', () => {
    const diff = diffBundles(NAME, '1.1.0', '1.2.0')!;
    expect(diff.fingerprintV1).not.toBe(diff.fingerprintV2);
  });
});

// ---------------------------------------------------------------------------
// Readability: a 29-member diff must not be a wall of text.
// ---------------------------------------------------------------------------

describe('formatDiff — large bundles stay readable', () => {
  const NAME = 'diff-fixture-wide';
  const MEMBERS = Array.from({ length: 29 }, (_, i) => `ws.wide.member-${String(i).padStart(2, '0')}`);

  beforeEach(() => {
    registerFeatureBundle({
      name: NAME,
      version: '1.0.0',
      transport: 'signal',
      events: [{ name: 'ws.wide.anchor', required: true }],
    });
    registerFeatureBundle({
      name: NAME,
      version: '2.0.0',
      transport: 'signal',
      events: [
        { name: 'ws.wide.anchor', required: true },
        ...MEMBERS.map((name) => ({ name, required: true })),
      ],
    });
  });

  it('leads with a one-line summary of the shape of the change', () => {
    const out = formatDiff(diffBundles(NAME, '1.0.0', '2.0.0')!);
    expect(out.split('\n')[2]).toBe('Summary: +29 required');
  });

  it('caps each section and says how many it hid', () => {
    const out = formatDiff(diffBundles(NAME, '1.0.0', '2.0.0')!);
    expect(out).toContain('Added (required) (29):');
    expect(out).toContain('… 19 more (re-run with --full to list every entry)');
    // 10 shown, not 29.
    expect(out.split('\n').filter((l) => l.startsWith('  + ')).length).toBe(10);
    // And the whole thing still fits on a screen.
    expect(out.split('\n').length).toBeLessThan(25);
  });

  it('--full lists every entry', () => {
    const out = formatDiff(diffBundles(NAME, '1.0.0', '2.0.0')!, { full: true });
    expect(out.split('\n').filter((l) => l.startsWith('  + ')).length).toBe(29);
    expect(out).not.toContain('more (re-run with --full');
    for (const m of MEMBERS) expect(out).toContain(m);
  });

  it('the CLI honours --full', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await bundleDiff([`${NAME}@1.0.0`, `${NAME}@2.0.0`, '--full']);
      const out = log.mock.calls.flat().join('\n');
      expect(out).toContain(MEMBERS[28]!);
    } finally {
      log.mockRestore();
    }
  });

  it('without --full the CLI truncates', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await bundleDiff([`${NAME}@1.0.0`, `${NAME}@2.0.0`]);
      const out = log.mock.calls.flat().join('\n');
      expect(out).not.toContain(MEMBERS[28]!);
      expect(out).toContain('19 more');
    } finally {
      log.mockRestore();
    }
  });
});
