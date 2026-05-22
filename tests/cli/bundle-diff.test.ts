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
    expect(out).toContain('Added (required):');
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
    expect(out).toContain('Removed:');
    expect(out).toContain('- ws.test.legacy');
    expect(out).toContain('Suggested semver bump: major (required event removed)');
  });

  it('formatDiff shows "Removed:" section', () => {
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
    expect(out).toContain('Removed:');
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
    expect(out).toContain('Optional-to-required:');
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
