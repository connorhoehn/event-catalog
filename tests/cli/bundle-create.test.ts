// tests/cli/bundle-create.test.ts
//
// Tests for ec-bundle-create (src/cli/bundle-create.ts).
//
// Uses the exported helpers + bundleCreate() directly — no subprocess
// spawning and no real filesystem writes except for the temp-dir tests.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseArgs,
  validateInputs,
  toCamelCase,
  generateBundleTemplate,
  updateIndexContent,
  bundleCreate,
} from '../../src/cli/bundle-create.js';

// ---------------------------------------------------------------------------
// Minimal index.ts fixture that mirrors the real file's structure
// ---------------------------------------------------------------------------

const MINIMAL_INDEX = `// src/declarations/bundles/index.ts
export { chatBundle } from './chat.js';
export { presenceBundle } from './presence.js';

import { registerFeatureBundle } from '../../bundles/FeatureBundle.js';
import { chatBundle } from './chat.js';
import { presenceBundle } from './presence.js';

/** All v1 bundle definitions, in declaration order. */
export const allBundles = [
  chatBundle,
  presenceBundle,
] as const;

for (const bundle of allBundles) {
  registerFeatureBundle(bundle);
}
`;

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('returns null when no name is given', () => {
    // parseArgs calls process.exit on --help, but with no args it returns null
    const result = parseArgs(['--version', '1.0.0']);
    expect(result).toBeNull();
  });

  it('parses name with defaults', () => {
    const result = parseArgs(['my-bundle']);
    expect(result).toEqual({
      name: 'my-bundle',
      version: '1.0.0',
      transport: 'signal',
      events: [],
    });
  });

  it('parses --version flag', () => {
    const result = parseArgs(['chat', '--version', '2.0.0']);
    expect(result?.version).toBe('2.0.0');
  });

  it('parses --transport flag', () => {
    const result = parseArgs(['live-poll', '--transport', 'durable']);
    expect(result?.transport).toBe('durable');
  });

  it('parses --events as comma-separated list', () => {
    const result = parseArgs(['screenshare', '--events', 'ws.screen.started,ws.screen.stopped']);
    expect(result?.events).toEqual(['ws.screen.started', 'ws.screen.stopped']);
  });

  it('trims whitespace from event names', () => {
    const result = parseArgs(['screenshare', '--events', 'ws.a, ws.b ,ws.c']);
    expect(result?.events).toEqual(['ws.a', 'ws.b', 'ws.c']);
  });

  it('produces empty events array when --events not provided', () => {
    const result = parseArgs(['my-bundle']);
    expect(result?.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateInputs
// ---------------------------------------------------------------------------

describe('validateInputs', () => {
  it('accepts valid kebab-case name + defaults', () => {
    expect(validateInputs('video-reactions', '1.0.0', 'signal')).toBeNull();
  });

  it('accepts single-word name', () => {
    expect(validateInputs('chat', '1.0.0', 'signal')).toBeNull();
  });

  it('accepts transport "durable"', () => {
    expect(validateInputs('chat', '1.0.0', 'durable')).toBeNull();
  });

  it('accepts transport "both"', () => {
    expect(validateInputs('chat', '1.0.0', 'both')).toBeNull();
  });

  it('rejects name with .ts extension', () => {
    const err = validateInputs('chat.ts', '1.0.0', 'signal');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('invalid bundle name');
  });

  it('rejects name with spaces', () => {
    const err = validateInputs('my bundle', '1.0.0', 'signal');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
  });

  it('rejects name starting with a hyphen', () => {
    const err = validateInputs('-chat', '1.0.0', 'signal');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
  });

  it('rejects name with uppercase letters', () => {
    const err = validateInputs('ChatBundle', '1.0.0', 'signal');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
  });

  it('rejects invalid semver version', () => {
    const err = validateInputs('chat', 'v1.0.0', 'signal');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('invalid version');
  });

  it('rejects version with only major.minor', () => {
    const err = validateInputs('chat', '1.0', 'signal');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
  });

  it('rejects unknown transport', () => {
    const err = validateInputs('chat', '1.0.0', 'websocket');
    expect(err).not.toBeNull();
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('invalid transport');
  });
});

// ---------------------------------------------------------------------------
// toCamelCase
// ---------------------------------------------------------------------------

describe('toCamelCase', () => {
  it('converts simple single word unchanged', () => {
    expect(toCamelCase('chat')).toBe('chat');
  });

  it('converts kebab-case to camelCase', () => {
    expect(toCamelCase('video-reactions')).toBe('videoReactions');
  });

  it('handles multiple hyphens', () => {
    expect(toCamelCase('agentic-pipeline-signal')).toBe('agenticPipelineSignal');
  });

  it('handles trailing hyphen gracefully', () => {
    // 'chat-' → hyphen at end: no following char, stays as-is
    expect(toCamelCase('chat-')).toBe('chat-');
  });
});

// ---------------------------------------------------------------------------
// generateBundleTemplate
// ---------------------------------------------------------------------------

describe('generateBundleTemplate', () => {
  it('contains the bundle name', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'signal', []);
    expect(out).toContain("name: 'my-feature'");
  });

  it('contains the version', () => {
    const out = generateBundleTemplate('my-feature', '2.3.0', 'signal', []);
    expect(out).toContain("version: '2.3.0'");
  });

  it('contains the transport', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'durable', []);
    expect(out).toContain("transport: 'durable'");
  });

  it('exports the camelCase bundle name', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'signal', []);
    expect(out).toContain('export const myFeatureBundle');
  });

  it('generates event entries for each event', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'signal', ['ws.a', 'ws.b']);
    expect(out).toContain("{ name: 'ws.a', required: true }");
    expect(out).toContain("{ name: 'ws.b', required: true }");
  });

  it('generates TODO comment for empty events list', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'signal', []);
    expect(out).toContain('// TODO: add event references here');
  });

  it('imports FeatureBundle from correct relative path', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'signal', []);
    expect(out).toContain("from '../../bundles/FeatureBundle.js'");
  });

  it('calls computeFingerprint', () => {
    const out = generateBundleTemplate('my-feature', '1.0.0', 'signal', []);
    expect(out).toContain('computeFingerprint(_def)');
  });
});

// ---------------------------------------------------------------------------
// updateIndexContent
// ---------------------------------------------------------------------------

describe('updateIndexContent', () => {
  it('adds export re-export line', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'reactions');
    expect(updated).not.toBeNull();
    expect(updated).toContain("export { reactionsBundle } from './reactions.js';");
  });

  it('adds import line', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'reactions');
    expect(updated).toContain("import { reactionsBundle } from './reactions.js';");
  });

  it('adds entry to allBundles array', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'reactions');
    expect(updated).toContain('  reactionsBundle,');
  });

  it('preserves existing exports', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'reactions');
    expect(updated).toContain("export { chatBundle } from './chat.js';");
    expect(updated).toContain("export { presenceBundle } from './presence.js';");
  });

  it('preserves existing imports', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'reactions');
    expect(updated).toContain("import { chatBundle } from './chat.js';");
  });

  it('preserves existing allBundles entries', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'reactions');
    expect(updated).toContain('  chatBundle,');
    expect(updated).toContain('  presenceBundle,');
  });

  it('returns null for content without export lines', () => {
    const bad = MINIMAL_INDEX.replace(/^export \{[^}]+\} from '[^']+';/gm, '');
    const result = updateIndexContent(bad, 'reactions');
    expect(result).toBeNull();
  });

  it('returns null for content without ] as const;', () => {
    const bad = MINIMAL_INDEX.replace('] as const;', '// removed');
    const result = updateIndexContent(bad, 'reactions');
    expect(result).toBeNull();
  });

  it('handles multi-segment kebab names (camelCase conversion)', () => {
    const updated = updateIndexContent(MINIMAL_INDEX, 'video-hangout');
    expect(updated).toContain('videoHangoutBundle');
    expect(updated).toContain("'./video-hangout.js'");
  });
});

// ---------------------------------------------------------------------------
// bundleCreate — mocked filesystem
// ---------------------------------------------------------------------------

describe('bundleCreate — mocked filesystem', () => {
  let files: Map<string, string>;
  let readFile: (p: string) => string;
  let writeFile: (p: string, content: string) => void;
  let fileExists: (p: string) => boolean;

  beforeEach(() => {
    files = new Map([
      ['src/declarations/bundles/index.ts', MINIMAL_INDEX],
    ]);
    readFile = (p) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`File not found: ${p}`);
      return content;
    };
    writeFile = (p, content) => {
      files.set(p, content);
    };
    fileExists = (p) => files.has(p);
  });

  const defaultOpts = () => ({
    bundlesDir: 'src/declarations/bundles',
    indexPath: 'src/declarations/bundles/index.ts',
    readFile,
    writeFile,
    fileExists,
  });

  it('creates bundle file with correct content', () => {
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(0);
    const fileContent = files.get('src/declarations/bundles/reactions.ts');
    expect(fileContent).toBeDefined();
    expect(fileContent).toContain("name: 'reactions'");
    expect(fileContent).toContain('export const reactionsBundle');
  });

  it('updates index.ts on success', () => {
    bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    const index = files.get('src/declarations/bundles/index.ts')!;
    expect(index).toContain('reactionsBundle');
  });

  it('returns code 0 on success', () => {
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(0);
  });

  it('returns code 1 when file already exists', () => {
    // Pre-populate the file
    files.set('src/declarations/bundles/reactions.ts', '// existing');
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(1);
    expect(result.message).toContain('already exists');
  });

  it('does NOT overwrite existing bundle file', () => {
    files.set('src/declarations/bundles/reactions.ts', '// original content');
    bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(files.get('src/declarations/bundles/reactions.ts')).toBe('// original content');
  });

  it('defaults transport to signal', () => {
    bundleCreate('live-poll', '1.0.0', 'signal', [], defaultOpts());
    const content = files.get('src/declarations/bundles/live-poll.ts')!;
    expect(content).toContain("transport: 'signal'");
  });

  it('defaults version to 1.0.0', () => {
    bundleCreate('live-poll', '1.0.0', 'signal', [], defaultOpts());
    const content = files.get('src/declarations/bundles/live-poll.ts')!;
    expect(content).toContain("version: '1.0.0'");
  });

  it('creates empty events placeholder when events list is empty', () => {
    bundleCreate('live-poll', '1.0.0', 'signal', [], defaultOpts());
    const content = files.get('src/declarations/bundles/live-poll.ts')!;
    expect(content).toContain('// TODO: add event references here');
  });

  it('populates events when provided', () => {
    bundleCreate('screenshare', '1.0.0', 'signal', ['ws.notification.new', 'ws.notification.read'], defaultOpts());
    const content = files.get('src/declarations/bundles/screenshare.ts')!;
    expect(content).toContain("{ name: 'ws.notification.new', required: true }");
    expect(content).toContain("{ name: 'ws.notification.read', required: true }");
  });

  it('returns code 2 for invalid name with spaces', () => {
    const result = bundleCreate('my bundle', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(2);
    expect(result.message).toContain('invalid bundle name');
  });

  it('returns code 2 for name with .ts extension', () => {
    const result = bundleCreate('chat.ts', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(2);
  });

  it('returns code 2 for invalid transport', () => {
    const result = bundleCreate('chat', '1.0.0', 'grpc', [], defaultOpts());
    expect(result.code).toBe(2);
    expect(result.message).toContain('invalid transport');
  });

  it('returns code 2 for invalid semver', () => {
    const result = bundleCreate('chat', 'v1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(2);
    expect(result.message).toContain('invalid version');
  });

  it('returns code 1 when index.ts is missing', () => {
    files.delete('src/declarations/bundles/index.ts');
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(1);
    expect(result.message).toContain('could not read index file');
  });

  it('returns code 1 when index.ts has unexpected structure', () => {
    files.set('src/declarations/bundles/index.ts', '// empty file with no anchors\n');
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.code).toBe(1);
    expect(result.message).toContain('could not update');
  });

  it('uses durable transport correctly', () => {
    bundleCreate('event-queue', '1.0.0', 'durable', [], defaultOpts());
    const content = files.get('src/declarations/bundles/event-queue.ts')!;
    expect(content).toContain("transport: 'durable'");
  });

  it('uses both transport correctly', () => {
    bundleCreate('mixed-feature', '1.0.0', 'both', [], defaultOpts());
    const content = files.get('src/declarations/bundles/mixed-feature.ts')!;
    expect(content).toContain("transport: 'both'");
  });

  it('result message includes file path on success', () => {
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.message).toContain('reactions.ts');
  });

  it('result message includes next steps on success', () => {
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], defaultOpts());
    expect(result.message).toContain('Next steps');
    expect(result.message).toContain('npm test');
  });
});

// ---------------------------------------------------------------------------
// bundleCreate — real temp directory (filesystem side-effects)
// ---------------------------------------------------------------------------

describe('bundleCreate — real filesystem (temp dir)', () => {
  let tmpDir: string;
  let bundlesDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ec-bundle-create-test-'));
    bundlesDir = join(tmpDir, 'src', 'declarations', 'bundles');
    mkdirSync(bundlesDir, { recursive: true });
    indexPath = join(bundlesDir, 'index.ts');
    writeFileSync(indexPath, MINIMAL_INDEX);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a real file on disk', () => {
    const result = bundleCreate('file-drop', '1.0.0', 'signal', [], {
      bundlesDir,
      indexPath,
    });
    expect(result.code).toBe(0);
    const filepath = join(bundlesDir, 'file-drop.ts');
    expect(existsSync(filepath)).toBe(true);
    const content = readFileSync(filepath, 'utf8');
    expect(content).toContain("name: 'file-drop'");
  });

  it('real file has correct export shape', () => {
    bundleCreate('file-drop', '1.0.0', 'signal', ['ws.notification.new'], {
      bundlesDir,
      indexPath,
    });
    const content = readFileSync(join(bundlesDir, 'file-drop.ts'), 'utf8');
    expect(content).toContain('export const fileDropBundle');
    expect(content).toContain("{ name: 'ws.notification.new', required: true }");
  });

  it('real index.ts gets updated with new bundle', () => {
    bundleCreate('file-drop', '1.0.0', 'signal', [], {
      bundlesDir,
      indexPath,
    });
    const index = readFileSync(indexPath, 'utf8');
    expect(index).toContain('fileDropBundle');
    expect(index).toContain('./file-drop.js');
  });

  it('refuses to overwrite existing file on real disk', () => {
    writeFileSync(join(bundlesDir, 'file-drop.ts'), '// original');
    const result = bundleCreate('file-drop', '1.0.0', 'signal', [], {
      bundlesDir,
      indexPath,
    });
    expect(result.code).toBe(1);
    // Original file untouched
    const content = readFileSync(join(bundlesDir, 'file-drop.ts'), 'utf8');
    expect(content).toBe('// original');
  });
});

// ---------------------------------------------------------------------------
// Round-trip property
//
// A bundle scaffolded by ec-bundle-create must, once registered, (a) lint
// clean under ec-lint-crd when a CRD pins it, and (b) diff empty against
// itself. Both CLIs are driven in-process here.
// ---------------------------------------------------------------------------

import { computeFingerprint, getFeatureBundle, registerFeatureBundle }
  from '../../src/bundles/FeatureBundle.js';
import { lintCrd } from '../../src/cli/lint-crd.js';
import { bundleDiff, diffBundles, hasChanges } from '../../src/cli/bundle-diff.js';

/**
 * Recover the bundle definition from the text ec-bundle-create emitted.
 * Reading it back out of the generated source (rather than re-deriving it
 * from the inputs) is what makes this a round trip: if the template ever
 * stops matching the FeatureBundle shape, these assertions fail.
 */
function parseGeneratedTemplate(src: string): {
  name: string;
  version: string;
  transport: 'signal' | 'durable' | 'both';
  events: Array<{ name: string; required: boolean }>;
} {
  const grab = (key: string): string => {
    const m = new RegExp(`^  ${key}: '([^']*)',$`, 'm').exec(src);
    if (!m) throw new Error(`generated template has no ${key} field:\n${src}`);
    return m[1]!;
  };
  const events = [...src.matchAll(/^ {4}\{ name: '([^']+)', required: (true|false) \},$/gm)].map(
    (m) => ({ name: m[1]!, required: m[2] === 'true' }),
  );
  return {
    name: grab('name'),
    version: grab('version'),
    transport: grab('transport') as 'signal' | 'durable' | 'both',
    events,
  };
}

describe('round trip — create → lint → diff', () => {
  let dir: string;
  const BUNDLE = 'roundtrip-fixture';
  const REF = `${BUNDLE}@1.4.0`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ec-roundtrip-'));
    mkdirSync(join(dir, 'bundles'), { recursive: true });
    writeFileSync(join(dir, 'bundles', 'index.ts'), MINIMAL_INDEX);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Scaffold the fixture bundle and register what the template describes. */
  function scaffoldAndRegister() {
    const bundlesDir = join(dir, 'bundles');
    const result = bundleCreate(
      BUNDLE,
      '1.4.0',
      'signal',
      ['ws.notification.new', 'ws.notification.read'],
      { bundlesDir, indexPath: join(bundlesDir, 'index.ts') },
    );
    expect(result.code).toBe(0);

    const src = readFileSync(join(bundlesDir, `${BUNDLE}.ts`), 'utf8');
    const def = parseGeneratedTemplate(src);
    registerFeatureBundle(def);
    return def;
  }

  it('the generated template round-trips through the FeatureBundle shape', () => {
    const def = scaffoldAndRegister();
    expect(def.name).toBe(BUNDLE);
    expect(def.version).toBe('1.4.0');
    expect(def.transport).toBe('signal');
    expect(def.events.map((e) => e.name)).toEqual(['ws.notification.new', 'ws.notification.read']);
    // Every scaffolded event defaults to required — the diff tool's
    // opt→req/req→opt classification depends on this being explicit.
    expect(def.events.every((e) => e.required)).toBe(true);
  });

  it('the registered fingerprint matches computeFingerprint over the template', () => {
    const def = scaffoldAndRegister();
    const registered = getFeatureBundle(BUNDLE, '1.4.0');
    expect(registered).toBeDefined();
    expect(registered!.fingerprint).toBe(computeFingerprint(def));
    expect(registered!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a CRD pinning the scaffolded bundle lints clean (exit 0)', async () => {
    scaffoldAndRegister();
    const fp = getFeatureBundle(BUNDLE, '1.4.0')!.fingerprint;
    const crd = join(dir, 'crd.yaml');
    writeFileSync(
      crd,
      [
        'apiVersion: platform.connorhoehn.dev/v1',
        'kind: FeatureDeployment',
        'metadata:',
        '  name: roundtrip-app',
        'spec:',
        `  eventBundle: ${BUNDLE}@1.4.0#${fp.slice(0, 12)}`,
        '',
      ].join('\n'),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await lintCrd([crd])).toBe(0);
  });

  it('an unpinned CRD referencing the scaffolded bundle also lints clean', async () => {
    scaffoldAndRegister();
    const crd = join(dir, 'crd-unpinned.yaml');
    writeFileSync(
      crd,
      [
        'apiVersion: platform.connorhoehn.dev/v1',
        'kind: FeatureDeployment',
        'metadata:',
        '  name: roundtrip-app',
        'spec:',
        `  eventBundle: ${REF}`,
        '',
      ].join('\n'),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await lintCrd([crd])).toBe(0);
  });

  it('negative control: a stale pin on the same bundle is an error (exit 1)', async () => {
    scaffoldAndRegister();
    const crd = join(dir, 'crd-stale.yaml');
    writeFileSync(
      crd,
      [
        'apiVersion: platform.connorhoehn.dev/v1',
        'kind: FeatureDeployment',
        'metadata:',
        '  name: roundtrip-app',
        'spec:',
        `  eventBundle: ${BUNDLE}@1.4.0#deadbeefdead`,
        '',
      ].join('\n'),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await lintCrd([crd])).toBe(1);
  });

  it('the scaffolded bundle diffs empty against itself', async () => {
    scaffoldAndRegister();
    const diff = diffBundles(BUNDLE, '1.4.0', '1.4.0')!;
    expect(hasChanges(diff)).toBe(false);
    expect(diff.suggestedBump).toBe('none');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 0 even under --exit-code: an unchanged bundle is not a difference.
    expect(await bundleDiff([REF, REF, '--exit-code'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// --events validation
//
// The scaffolder used to accept any string. A typo became a bundle that
// marked a fictional event required, and the failure surfaced two steps
// later as an ec-lint-crd error pointing at the operator's CRD.
// ---------------------------------------------------------------------------

import {
  parseEventMembers,
  validateEventMembers,
  knownEventNames,
} from '../../src/cli/bundle-create.js';

describe('parseEventMembers', () => {
  it('defaults every member to required', () => {
    expect(parseEventMembers(['a', 'b'])).toEqual([
      { name: 'a', required: true },
      { name: 'b', required: true },
    ]);
  });

  it('treats a trailing "?" as the opt-out', () => {
    expect(parseEventMembers(['a?'])).toEqual([{ name: 'a', required: false }]);
  });

  it('mixes required and optional in one list', () => {
    expect(parseEventMembers(['a', 'b?', 'c'])).toEqual([
      { name: 'a', required: true },
      { name: 'b', required: false },
      { name: 'c', required: true },
    ]);
  });

  it('tolerates whitespace around the name and the marker', () => {
    expect(parseEventMembers([' a ', ' b ? '])).toEqual([
      { name: 'a', required: true },
      { name: 'b', required: false },
    ]);
  });
});

describe('validateEventMembers', () => {
  const KNOWN = ['pipeline:run:started', 'ws.chat.message', 'ws.chat.typing'];

  it('passes a list of declared events', () => {
    expect(validateEventMembers(parseEventMembers(['ws.chat.message']), KNOWN)).toBeNull();
  });

  it('passes an empty list — "--events omitted" is not an error', () => {
    expect(validateEventMembers([], KNOWN)).toBeNull();
  });

  it('rejects an undeclared event with exit code 2', () => {
    const err = validateEventMembers(parseEventMembers(['ws.chat.mesage']), KNOWN);
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('ws.chat.mesage');
    expect(err?.message).toContain('not declared in the catalog');
  });

  it('suggests the near-miss it can see', () => {
    const err = validateEventMembers(parseEventMembers(['ws.chat.mesage']), KNOWN);
    expect(err?.message).toContain('Did you mean "ws.chat.message"');
  });

  it('is separator-insensitive: pipeline.run.started → pipeline:run:started', () => {
    const err = validateEventMembers(parseEventMembers(['pipeline.run.started']), KNOWN);
    expect(err?.message).toContain('Did you mean "pipeline:run:started"');
  });

  it('checks optional members too — "?" excuses absence at deploy, not a typo', () => {
    const err = validateEventMembers(parseEventMembers(['ws.chat.nope?']), KNOWN);
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('ws.chat.nope');
  });

  it('lists every offender and counts them', () => {
    const err = validateEventMembers(
      parseEventMembers(['nope.one', 'nope.two', 'ws.chat.message']),
      KNOWN,
    );
    expect(err?.message).toContain('2 of 3');
    expect(err?.message).toContain('nope.one');
    expect(err?.message).toContain('nope.two');
  });

  it('rejects a duplicate member', () => {
    const err = validateEventMembers(
      parseEventMembers(['ws.chat.message', 'ws.chat.message']),
      KNOWN,
    );
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('duplicate');
  });

  it('rejects an empty entry from a trailing comma', () => {
    const err = validateEventMembers([{ name: '', required: true }], KNOWN);
    expect(err?.code).toBe(2);
    expect(err?.message).toContain('empty entry');
  });

  it('reports how many events the catalog actually has, for orientation', () => {
    const err = validateEventMembers(parseEventMembers(['nope.one']), KNOWN);
    expect(err?.message).toContain('(3 events are declared.)');
  });
});

describe('knownEventNames', () => {
  it('returns the shipped declaration set, with no duplicates', () => {
    const names = knownEventNames();
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('bundleCreate — event validation is wired in', () => {
  let files: Map<string, string>;
  const opts = () => ({
    bundlesDir: 'b',
    indexPath: 'b/index.ts',
    readFile: (p: string) => {
      const c = files.get(p);
      if (c === undefined) throw new Error(`File not found: ${p}`);
      return c;
    },
    writeFile: (p: string, c: string) => void files.set(p, c),
    fileExists: (p: string) => files.has(p),
    knownEvents: ['ws.real.one', 'ws.real.two'],
  });

  beforeEach(() => {
    files = new Map([['b/index.ts', MINIMAL_INDEX]]);
  });

  it('exits 2 and writes nothing for an undeclared event', () => {
    const result = bundleCreate('ghost', '1.0.0', 'signal', ['ws.real.onee'], opts());
    expect(result.code).toBe(2);
    expect(files.has('b/ghost.ts')).toBe(false);
    expect(files.get('b/index.ts')).toBe(MINIMAL_INDEX);
  });

  it('checks events before touching the filesystem at all', () => {
    // A bad name must not even read index.ts, let alone half-write a bundle.
    const result = bundleCreate('ghost', '1.0.0', 'signal', ['nope'], {
      ...opts(),
      readFile: () => {
        throw new Error('index.ts must not be read when --events is invalid');
      },
    });
    expect(result.code).toBe(2);
  });

  it('validates the bundle name before the events (one error at a time)', () => {
    const result = bundleCreate('Bad Name', '1.0.0', 'signal', ['nope'], opts());
    expect(result.code).toBe(2);
    expect(result.message).toContain('invalid bundle name');
  });

  it('scaffolds normally when every event is real', () => {
    const result = bundleCreate('good', '1.0.0', 'signal', ['ws.real.one'], opts());
    expect(result.code).toBe(0);
    expect(files.get('b/good.ts')).toContain("{ name: 'ws.real.one', required: true },");
  });

  it('writes required: false for a "?"-suffixed member', () => {
    const result = bundleCreate('good', '1.0.0', 'signal', ['ws.real.one', 'ws.real.two?'], opts());
    expect(result.code).toBe(0);
    const src = files.get('b/good.ts')!;
    expect(src).toContain("{ name: 'ws.real.one', required: true },");
    expect(src).toContain("{ name: 'ws.real.two', required: false },");
  });

  it('defaults to the real catalog when knownEvents is not injected', () => {
    const bare = { ...opts() };
    delete (bare as { knownEvents?: unknown }).knownEvents;
    const result = bundleCreate('ghost', '1.0.0', 'signal', ['pipeline.run.started'], bare);
    expect(result.code).toBe(2);
    expect(result.message).toContain('pipeline:run:started');
  });
});
