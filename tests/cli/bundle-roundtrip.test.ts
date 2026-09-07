// tests/cli/bundle-roundtrip.test.ts
//
// End-to-end round trip against the REAL registry, not a fixture:
//
//   ec-bundle-create  →  the generated bundle file compiles and registers
//                     →  it validates against the real event catalog
//                     →  ec-bundle-diff reports it identical to itself
//                     →  ec-lint-crd accepts a CRD pinned to its fingerprint
//
// This is the loop templates/ tells operators to run in CI and in the git
// hook, and until now nothing exercised it whole.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Registry } from '../../src/registry/index.js';
import { allDeclarations } from '../../src/declarations/index.js';
import {
  registerFeatureBundle,
  getFeatureBundle,
  validateBundle,
  computeFingerprint,
  type FeatureBundle,
} from '../../src/bundles/FeatureBundle.js';
import {
  bundleCreate,
  generateBundleTemplate,
  updateIndexContent,
  validateInputs,
} from '../../src/cli/bundle-create.js';
import { diffBundles, formatDiff } from '../../src/cli/bundle-diff.js';
import { lintCrd } from '../../src/cli/lint-crd.js';

/** Real events, so the generated bundle is a real bundle. */
const PROBE_EVENTS = [
  'ws.notification.new',
  'ws.notification.read',
  'ws.notification.bulk-update',
];
const PROBE_NAME = 'roundtrip-probe';

let tmp: string;
let generated: FeatureBundle;
let registry: Registry;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ec-bundle-roundtrip-'));

  registry = new Registry();
  for (const decl of allDeclarations) registry.declare(decl);

  // --- step 1: scaffold, through the CLI's own code path -------------------
  const written = new Map<string, string>();
  const indexPath = resolve('src/declarations/bundles/index.ts');
  const realIndex = await import('node:fs').then((fs) =>
    fs.readFileSync(indexPath, 'utf8'),
  );

  const result = bundleCreate(PROBE_NAME, '1.0.0', 'signal', PROBE_EVENTS, {
    bundlesDir: join(tmp, 'bundles'),
    indexPath: join(tmp, 'bundles', 'index.ts'),
    // Feed the CLI the REAL index.ts so its anchor-matching is tested
    // against the file it actually has to rewrite in production.
    readFile: () => realIndex,
    writeFile: (p, c) => void written.set(p, c),
    fileExists: () => false,
  });
  expect(result.code).toBe(0);

  // --- step 2: make the generated source loadable --------------------------
  const src = written.get(join(tmp, 'bundles', `${PROBE_NAME}.ts`));
  expect(src).toBeDefined();

  const featureBundleModule = resolve('src/bundles/FeatureBundle.ts');
  const loadable = src!.replace(
    "'../../bundles/FeatureBundle.js'",
    JSON.stringify(featureBundleModule),
  );
  const modPath = join(tmp, `${PROBE_NAME}.ts`);
  writeFileSync(modPath, loadable, 'utf8');

  const mod = (await import(/* @vite-ignore */ modPath)) as Record<string, FeatureBundle>;
  generated = mod['roundtripProbeBundle']!;
  expect(generated).toBeDefined();

  // --- step 3: register it in the module singleton -------------------------
  registerFeatureBundle(generated);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('ec-bundle-create → registry', () => {
  it('produces a bundle that registers under its own name', () => {
    const found = getFeatureBundle(PROBE_NAME, '1.0.0');
    expect(found).toBeDefined();
    expect(found!.fingerprint).toBe(generated.fingerprint);
  });

  it('stamps a fingerprint that matches its own member set', () => {
    expect(generated.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.fingerprint).toBe(computeFingerprint(generated));
  });

  it('validates against the real event catalog', () => {
    expect(validateBundle(generated, registry).errors).toEqual([]);
  });

  it('rewrites the REAL index.ts without losing any existing bundle', async () => {
    const realIndex = await import('node:fs').then((fs) =>
      fs.readFileSync(resolve('src/declarations/bundles/index.ts'), 'utf8'),
    );
    const updated = updateIndexContent(realIndex, PROBE_NAME);
    expect(updated).not.toBeNull();

    // Every export that was there is still there, plus the new one.
    const exportsOf = (s: string) =>
      [...s.matchAll(/^export \{ (\w+) \} from/gm)].map((m) => m[1]!);
    const before = exportsOf(realIndex);
    const after = exportsOf(updated!);
    for (const e of before) expect(after).toContain(e);
    expect(after).toContain('roundtripProbeBundle');
    expect(updated).toContain('  roundtripProbeBundle,\n] as const;');
  });
});

describe('ec-bundle-diff — a bundle against itself', () => {
  it('reports no changes and bump: none', () => {
    const diff = diffBundles(PROBE_NAME, '1.0.0', '1.0.0');
    expect(diff).not.toBeNull();
    expect(diff!.addedRequired).toEqual([]);
    expect(diff!.addedOptional).toEqual([]);
    expect(diff!.removed).toEqual([]);
    expect(diff!.requiredToOptional).toEqual([]);
    expect(diff!.optionalToRequired).toEqual([]);
    expect(diff!.suggestedBump).toBe('none');
    expect(diff!.fingerprintV1).toBe(diff!.fingerprintV2);
  });

  it('renders as "No changes."', () => {
    const out = formatDiff(diffBundles(PROBE_NAME, '1.0.0', '1.0.0')!);
    expect(out).toContain('No changes.');
  });

  it('every shipped bundle also diffs empty against itself', () => {
    // The identity property must hold for the whole registry, not just the
    // probe — this is what a CI diff run does on an unchanged branch.
    for (const b of [
      'chat',
      'presence',
      'ag-ui-stream',
      'sfu-webhooks',
      'sfu-control-plane',
      'sfu-chat',
      'call-captions',
      'notifications',
    ]) {
      const diff = diffBundles(b, '1.0.0', '1.0.0');
      expect(diff, `${b} not registered`).not.toBeNull();
      expect(diff!.suggestedBump).toBe('none');
    }
  });
});

describe('ec-lint-crd — a CRD pinned to the generated fingerprint', () => {
  function crdYaml(ref: string): string {
    return [
      'apiVersion: platform.connorhoehn.dev/v1alpha1',
      'kind: AgenticPipeline',
      'metadata:',
      '  name: roundtrip',
      '  namespace: default',
      'spec:',
      `  eventBundle: ${ref}`,
      '',
    ].join('\n');
  }

  it('exits 0 for a correctly pinned fingerprint', async () => {
    const file = join(tmp, 'ok.yaml');
    writeFileSync(
      file,
      crdYaml(`${PROBE_NAME}@1.0.0#${generated.fingerprint.slice(0, 12)}`),
      'utf8',
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await lintCrd([file])).toBe(0);
      expect(log.mock.calls.flat().join('\n')).toContain('fingerprint matches');
    } finally {
      log.mockRestore();
    }
  });

  it('exits 0 for the full 64-char fingerprint too', async () => {
    const file = join(tmp, 'ok-full.yaml');
    writeFileSync(file, crdYaml(`${PROBE_NAME}@1.0.0#${generated.fingerprint}`), 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await lintCrd([file])).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  it('exits 1 for a stale pin', async () => {
    const file = join(tmp, 'stale.yaml');
    writeFileSync(file, crdYaml(`${PROBE_NAME}@1.0.0#deadbeefdead`), 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await lintCrd([file])).toBe(1);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Known gap in ec-bundle-create, asserted so it is not mistaken for a bug
// later. Fixing it means touching src/cli/bundle-create.ts.
// ---------------------------------------------------------------------------

describe('ec-bundle-create does not check that --events exist (known gap)', () => {
  it('scaffolds a bundle over undeclared events, marked required', () => {
    expect(validateInputs('ghost-feature', '1.0.0', 'signal')).toBeNull();
    const src = generateBundleTemplate('ghost-feature', '1.0.0', 'signal', [
      'ws.nonexistent.frame',
    ]);
    expect(src).toContain("{ name: 'ws.nonexistent.frame', required: true },");
  });

  it('...and such a bundle fails validateBundle — so the guard is validate, not create', () => {
    const ghost: FeatureBundle = {
      name: 'ghost-feature',
      version: '1.0.0',
      fingerprint: '',
      transport: 'signal',
      events: [{ name: 'ws.nonexistent.frame', required: true }],
    };
    const result = validateBundle(ghost, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('ws.nonexistent.frame');
  });
});
