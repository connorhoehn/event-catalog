// tests/cli-hardening.test.ts
//
// Exercises the operator-facing failure surface of every subcommand and
// bin-level command function: `--help` works everywhere, unknown flags
// are rejected instead of silently ignored, and a bad path / bad file /
// thin HTTP response produces a one-line message with the right exit
// code instead of a stack trace or a swallowed error.
//
// Handlers are called directly; the bin entry points are covered by
// tests/cli-bin.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lint } from '../src/cli/commands/lint.js';
import { snapshot } from '../src/cli/commands/snapshot.js';
import { drift } from '../src/cli/commands/drift.js';
import { manifest } from '../src/cli/commands/manifest.js';
import { deprecate, undeprecate } from '../src/cli/commands/deprecate.js';
import { asyncapi } from '../src/cli/commands/asyncapi.js';
import { lintCrd } from '../src/cli/lint-crd.js';
import { bundleDiff } from '../src/cli/bundle-diff.js';
import { main as bundleCreateMain, parseCreateArgs } from '../src/cli/bundle-create.js';

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'evcat-harden-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

const stdout = () => logSpy.mock.calls.flat().join('\n');
const stderr = () => errorSpy.mock.calls.flat().join('\n');

function writeTmp(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content);
  return p;
}

// ---------------------------------------------------------------------------
// --help on every command
// ---------------------------------------------------------------------------

const HELP_CASES: Array<[string, (args: string[]) => Promise<number> | number, string[]]> = [
  ['lint', lint, ['--help']],
  ['snapshot', snapshot, ['--help']],
  ['drift', drift, ['--help']],
  ['manifest', manifest, ['--help']],
  ['manifest pin', manifest, ['pin', '--help']],
  ['manifest verify', manifest, ['verify', '--help']],
  ['deprecate', deprecate, ['--help']],
  ['undeprecate', undeprecate, ['--help']],
  ['asyncapi', asyncapi, ['--help']],
  ['ec-lint-crd', lintCrd, ['--help']],
  ['ec-bundle-diff', bundleDiff, ['--help']],
  ['ec-bundle-create', bundleCreateMain, ['--help']],
];

describe('--help works on every command', () => {
  for (const [name, fn, args] of HELP_CASES) {
    it(`${name} --help exits 0 and prints USAGE`, async () => {
      const code = await fn(args);
      expect(code).toBe(0);
      expect(stdout()).toContain('USAGE');
      expect(stderr()).toBe('');
    });
  }

  for (const [name, fn, args] of HELP_CASES) {
    it(`${name} -h behaves like --help`, async () => {
      const code = await fn(args.map((a) => (a === '--help' ? '-h' : a)));
      expect(code).toBe(0);
      expect(stdout()).toContain('USAGE');
    });
  }
});

describe('help text describes the actual flags', () => {
  it('snapshot help lists both modes', async () => {
    await snapshot(['--help']);
    expect(stdout()).toContain('--catalog-url');
    expect(stdout()).toContain('--from-source');
    expect(stdout()).toContain('--declarations');
    expect(stdout()).toContain('--export');
  });

  it('drift help lists both comparison sources', async () => {
    await drift(['--help']);
    expect(stdout()).toContain('--against');
    expect(stdout()).toContain('--registry-snapshot');
  });

  it('deprecate help lists --reason and --by', async () => {
    await deprecate(['--help']);
    expect(stdout()).toContain('--reason');
    expect(stdout()).toContain('--by');
  });

  it('bundle-create help lists --version/--transport/--events', async () => {
    bundleCreateMain(['--help']);
    expect(stdout()).toContain('--version');
    expect(stdout()).toContain('--transport');
    expect(stdout()).toContain('--events');
  });

  it('every command help documents its exit codes', async () => {
    for (const [, fn, args] of HELP_CASES) {
      logSpy.mockClear();
      await fn(args);
      expect(stdout()).toContain('EXIT CODES');
    }
  });
});

// ---------------------------------------------------------------------------
// Unknown flags are errors, not no-ops
// ---------------------------------------------------------------------------

describe('unknown flags exit 2 instead of being ignored', () => {
  const CASES: Array<[string, (args: string[]) => Promise<number> | number, string[]]> = [
    ['lint', lint, ['some.json', '--bogus']],
    ['snapshot', snapshot, ['--catalog-url=http://x', '--bogus']],
    ['drift', drift, ['--against=x', '--catalog-url=http://x', '--bogus']],
    ['manifest pin', manifest, ['pin', '--catalog-url=http://x', '--consumer=c', '--bogus']],
    ['manifest verify', manifest, ['verify', '--against=a', '--registry-snapshot=b', '--bogus']],
    ['deprecate', deprecate, ['a.x', '--catalog-url=http://x', '--bogus']],
    ['undeprecate', undeprecate, ['a.x', '--catalog-url=http://x', '--bogus']],
    ['asyncapi', asyncapi, ['--catalog-url=http://x', '--bogus']],
    ['ec-lint-crd', lintCrd, ['.', '--bogus']],
    ['ec-bundle-diff', bundleDiff, ['chat@1.0.0', 'chat@2.0.0', '--bogus']],
    ['ec-bundle-create', bundleCreateMain, ['thing', '--bogus']],
  ];

  for (const [name, fn, args] of CASES) {
    it(`${name} rejects --bogus`, async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const code = await fn(args);
      expect(code).toBe(2);
      expect(stderr()).toContain('unknown flag "--bogus"');
      // A rejected argv must never reach the network or the filesystem.
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('a typo\'d flag name is not silently treated as absent', async () => {
    // Before hardening this ran with catalog-url undefined and exited 2 with
    // a misleading "is required" message; now the typo itself is named.
    const code = await snapshot(['--catalog-ur=http://x']);
    expect(code).toBe(2);
    expect(stderr()).toContain('--catalog-ur');
    expect(stderr()).toContain('--catalog-url');
  });
});

describe('value flags require values', () => {
  it('snapshot --catalog-url with no value exits 2', async () => {
    expect(await snapshot(['--catalog-url'])).toBe(2);
    expect(stderr()).toContain('requires a value');
  });

  it('bundle-create --transport swallowing the next flag is rejected', async () => {
    const code = bundleCreateMain(['thing', '--transport', '--version', '2.0.0']);
    expect(code).toBe(2);
    expect(stderr()).toContain('--transport requires a value');
  });

  it('bundle-create accepts the --flag=value form too', () => {
    const r = parseCreateArgs(['thing', '--version=2.1.0', '--transport=durable']);
    expect(r.ok && 'value' in r && r.value.version).toBe('2.1.0');
    expect(r.ok && 'value' in r && r.value.transport).toBe('durable');
  });
});

// ---------------------------------------------------------------------------
// Missing / extra positional arguments print usage, not a stack trace
// ---------------------------------------------------------------------------

describe('missing required arguments print usage', () => {
  it('lint with no file names the usage line', async () => {
    expect(await lint([])).toBe(2);
    expect(stderr()).toContain('usage: event-catalog lint <file>');
  });

  it('manifest with no subcommand exits 2', async () => {
    expect(await manifest([])).toBe(2);
    expect(stderr()).toContain('subcommand is required');
  });

  it('ec-lint-crd with no path exits 2', async () => {
    expect(await lintCrd([])).toBe(2);
    expect(stderr()).toContain('no path provided');
  });

  it('ec-bundle-create with no name exits 2', () => {
    expect(bundleCreateMain([])).toBe(2);
    expect(stderr()).toContain('bundle name is required');
  });

  it('every usage error points at --help', async () => {
    await lint([]);
    expect(stderr()).toContain('--help');
  });
});

describe('extra positional arguments are rejected', () => {
  it('lint takes exactly one file', async () => {
    expect(await lint(['a.json', 'b.json'])).toBe(2);
    expect(stderr()).toContain('extra argument');
  });

  it('deprecate takes exactly one event name', async () => {
    expect(await deprecate(['a.x', 'b.y', '--catalog-url=http://x'])).toBe(2);
  });

  it('bundle-diff compares exactly two references', async () => {
    expect(await bundleDiff(['chat@1.0.0', 'chat@2.0.0', 'chat@3.0.0'])).toBe(2);
  });

  it('drift takes flags only', async () => {
    expect(await drift(['stray', '--against=a', '--catalog-url=http://x'])).toBe(2);
    expect(stderr()).toContain('unexpected argument');
  });

  it('ec-lint-crd --list-deprecated rejects a stray path', async () => {
    expect(await lintCrd(['--list-deprecated', 'crds/'])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Bad paths and bad files: one actionable line, no stack trace
// ---------------------------------------------------------------------------

describe('mistyped paths produce one actionable line', () => {
  it('lint on a missing file', async () => {
    expect(await lint(['/no/such/decls.json'])).toBe(2);
    expect(stderr()).toContain('no such file or directory');
    expect(stderr()).not.toContain('at Object.');
  });

  it('lint on a directory', async () => {
    expect(await lint([tmpDir])).toBe(2);
    expect(stderr()).toContain('is a directory');
  });

  it('drift on a snapshot that is an array, not a map', async () => {
    const f = writeTmp('arr.json', '["a","b"]');
    const r = writeTmp('reg.json', '{}');
    expect(await drift([`--against=${f}`, `--registry-snapshot=${r}`])).toBe(2);
    expect(stderr()).toContain('must be a JSON object');
  });

  it('manifest verify on a registry snapshot with numeric fingerprints', async () => {
    const a = writeTmp('consumed.json', JSON.stringify({ 'a.x': 'f' }));
    const r = writeTmp('registry.json', JSON.stringify({ 'a.x': 42 }));
    expect(await manifest(['verify', `--against=${a}`, `--registry-snapshot=${r}`])).toBe(2);
    expect(stderr()).toContain('is not a string');
  });

  it('manifest pin rejects a snapshot that is not an object', async () => {
    const f = writeTmp('arr.json', '[1,2]');
    expect(await manifest(['pin', '--catalog-url=http://x', '--consumer=c', `--snapshot=${f}`])).toBe(2);
    expect(stderr()).toContain('must be a JSON object');
  });

  it('manifest pin rejects passing both --snapshot and --events', async () => {
    const f = writeTmp('snap.json', JSON.stringify({ 'a.x': 'f' }));
    expect(await manifest([
      'pin', '--catalog-url=http://x', '--consumer=c', `--snapshot=${f}`, '--events=a.x=f',
    ])).toBe(2);
    expect(stderr()).toContain('only one of');
  });

  it('lint reports a null entry rather than crashing on evt.name', async () => {
    // Regression: `[null]` used to throw "Cannot read properties of null".
    const f = writeTmp('nulls.json', JSON.stringify([null, { name: 'ok', schema: { type: 'object' } }]));
    const code = await lint([f]);
    expect(code).toBe(1);
    expect(stdout()).toContain('declaration is not an object');
  });

  it('lint rejects a JSON scalar at the top level', async () => {
    const f = writeTmp('scalar.json', '"just a string"');
    expect(await lint([f])).toBe(2);
    expect(stderr()).toContain('no events to lint');
  });

  it('ec-lint-crd names a path that does not exist', async () => {
    expect(await lintCrd(['/no/such/crds'])).toBe(2);
    expect(stderr()).toContain('path not found');
  });

  it('ec-lint-crd explains when the path is not YAML', async () => {
    const f = writeTmp('notes.txt', 'hello');
    expect(await lintCrd([f])).toBe(2);
    expect(stderr()).toContain('not a YAML file');
  });

  it('ec-lint-crd names the paths it searched when a dir has no YAML', async () => {
    const empty = join(tmpDir, 'empty');
    mkdirSync(empty);
    expect(await lintCrd([empty])).toBe(2);
    expect(stderr()).toContain('no YAML files found');
    expect(stderr()).toContain(empty);
  });

  it('snapshot --from-source on a missing module exits 2 with a readable line', async () => {
    expect(await snapshot(['--from-source', '--declarations=/no/such/mod.mjs'])).toBe(2);
    expect(stderr()).toContain('cannot load');
    expect(stderr()).not.toContain('at async');
  });
});

// ---------------------------------------------------------------------------
// HTTP responses that don't match the happy path
// ---------------------------------------------------------------------------

describe('unexpected HTTP bodies do not crash the process', () => {
  it('snapshot exits 1 when the catalog returns HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>login</html>', { status: 200 }) as never,
    );
    const code = await snapshot(['--catalog-url=http://x']);
    expect(code).toBe(1);
    expect(stderr()).toContain('did not return JSON');
  });

  it('drift exits 1 when the catalog returns a JSON array', async () => {
    const f = writeTmp('snap.json', JSON.stringify({ 'a.x': 'f' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200 }) as never,
    );
    expect(await drift([`--against=${f}`, '--catalog-url=http://x'])).toBe(1);
    expect(stderr()).toContain('expected a fingerprint object');
  });

  it('deprecate still exits 0 when the 200 body omits `deprecation`', async () => {
    // Regression: `stored.deprecation.deprecatedAt` threw a TypeError that
    // escaped as an unhandled rejection on an otherwise successful call.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }) as never,
    );
    const code = await deprecate(['a.x', '--catalog-url=http://x']);
    expect(code).toBe(0);
    expect(stdout()).toContain('deprecated "a.x"');
  });

  it('deprecate survives a non-JSON 200 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('OK', { status: 200 }) as never,
    );
    expect(await deprecate(['a.x', '--catalog-url=http://x'])).toBe(0);
  });

  it('manifest pin survives a 201 body without updatedAt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 201 }) as never,
    );
    const code = await manifest([
      'pin', '--catalog-url=http://x', '--consumer=c', '--events=a.x=f',
    ]);
    expect(code).toBe(0);
    expect(stdout()).toContain('pinned 1 event(s)');
    expect(stdout()).not.toContain('undefined');
  });

  it('snapshot names the endpoint on a non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('nope', { status: 503 }) as never,
    );
    expect(await snapshot(['--catalog-url=http://x'])).toBe(1);
    expect(stderr()).toContain('HTTP 503');
    expect(stderr()).toContain('/api/fingerprints');
  });
});

// ---------------------------------------------------------------------------
// ec-bundle-create: no orphan files, no process.exit from a pure function
// ---------------------------------------------------------------------------

describe('ec-bundle-create write safety', () => {
  it('parseCreateArgs reports --help instead of calling process.exit', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const r = parseCreateArgs(['--help']);
    expect(r.ok && 'help' in r).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not leave an orphan bundle file when index.ts is missing', async () => {
    const { bundleCreate } = await import('../src/cli/bundle-create.js');
    const files = new Map<string, string>();
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], {
      bundlesDir: 'b',
      indexPath: 'b/index.ts',
      readFile: (p) => { const c = files.get(p); if (c === undefined) throw new Error(`missing ${p}`); return c; },
      writeFile: (p, c) => { files.set(p, c); },
      fileExists: (p) => files.has(p),
    });
    expect(result.code).toBe(1);
    expect(files.has('b/reactions.ts')).toBe(false);
  });

  it('does not leave an orphan bundle file when index.ts has no anchors', async () => {
    const { bundleCreate } = await import('../src/cli/bundle-create.js');
    const files = new Map<string, string>([['b/index.ts', '// nothing to anchor on\n']]);
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], {
      bundlesDir: 'b',
      indexPath: 'b/index.ts',
      readFile: (p) => { const c = files.get(p); if (c === undefined) throw new Error(`missing ${p}`); return c; },
      writeFile: (p, c) => { files.set(p, c); },
      fileExists: (p) => files.has(p),
    });
    expect(result.code).toBe(1);
    expect(files.has('b/reactions.ts')).toBe(false);
  });

  it('reports an unwritable target instead of throwing', async () => {
    const { bundleCreate } = await import('../src/cli/bundle-create.js');
    const files = new Map<string, string>([['b/index.ts', [
      "export { chatBundle } from './chat.js';",
      "import { chatBundle } from './chat.js';",
      'export const allBundles = [',
      '  chatBundle,',
      '] as const;',
    ].join('\n')]]);
    const result = bundleCreate('reactions', '1.0.0', 'signal', [], {
      bundlesDir: 'b',
      indexPath: 'b/index.ts',
      readFile: (p) => files.get(p)!,
      writeFile: (p) => {
        if (p === 'b/reactions.ts') {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES', path: p });
        }
      },
      fileExists: () => false,
    });
    expect(result.code).toBe(1);
    expect(result.message).toContain('permission denied');
  });

  it('validation failures surface a help pointer through main()', () => {
    const code = bundleCreateMain(['Not-Kebab']);
    expect(code).toBe(2);
    expect(stderr()).toContain('invalid bundle name');
    expect(stderr()).toContain('--help');
  });
});

// ---------------------------------------------------------------------------
// ec-lint-crd exit-code separation
//
// `2` used to mean BOTH "completed, with warnings" and "you invoked me wrong",
// so the recipe the README documented for ignoring warnings
// (`ec-lint-crd crds/ || [ $? -eq 2 ]`) silently swallowed a typo'd path —
// reporting a run that never happened as a clean-with-warnings pass.
// ---------------------------------------------------------------------------

describe('ec-lint-crd exit codes are unambiguous', () => {
  it('returns 3 (not 2) for a CRD pinned to a deprecated bundle', async () => {
    const crd = writeTmp(
      'deprecated-bundle.yaml',
      [
        'apiVersion: platform.connorhoehn.dev/v1',
        'kind: FeatureService',
        'metadata:',
        '  name: legacy-pipeline',
        'spec:',
        '  eventBundle: agentic-pipeline@1.0.0',
        '',
      ].join('\n'),
    );

    const code = await lintCrd([crd]);
    expect(stdout()).toContain('deprecated');
    expect(code).toBe(3);
  });

  it('keeps 2 for a usage error, so the two outcomes stay distinguishable', async () => {
    expect(await lintCrd(['/no/such/crds'])).toBe(2);
  });
});
