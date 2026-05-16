// tests/cli.test.ts
//
// wave24-a — covers the subcommand handlers (lint, snapshot, drift,
// manifest). Each handler is invoked directly (not via spawn) so the
// tests stay fast and the exit-code contract is exercised.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lint } from '../src/cli/commands/lint.js';
import { snapshot } from '../src/cli/commands/snapshot.js';
import { drift } from '../src/cli/commands/drift.js';
import { manifest } from '../src/cli/commands/manifest.js';

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'evcat-cli-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function writeTmp(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content);
  return p;
}

describe('cli: lint', () => {
  it('exits 0 on clean declarations', async () => {
    const f = writeTmp('decl.json', JSON.stringify({
      events: [
        { name: 'a.x', schema: { type: 'object', properties: { id: { type: 'string' } } } },
        { name: 'b.y', schema: { type: 'string' } },
      ],
    }));
    const code = await lint([f]);
    expect(code).toBe(0);
  });

  it('exits 1 on shape errors with per-event report', async () => {
    const f = writeTmp('decl.json', JSON.stringify({
      events: [
        { name: 'good', schema: { type: 'object' } },
        { name: 'bad', schema: { type: 'objct' } },
      ],
    }));
    const code = await lint([f]);
    expect(code).toBe(1);
    const all = logSpy.mock.calls.flat().join('\n');
    expect(all).toContain('✓ good');
    expect(all).toContain('✗ bad');
    expect(all).toContain('invalid value "objct"');
  });

  it('accepts both `[...]` and `{events: [...]}` shapes', async () => {
    const f = writeTmp('decl.json', JSON.stringify([
      { name: 'a.x', schema: { type: 'object' } },
    ]));
    const code = await lint([f]);
    expect(code).toBe(0);
  });

  it('exits 2 on missing-file argument', async () => {
    expect(await lint([])).toBe(2);
  });

  it('exits 2 on unreadable file', async () => {
    expect(await lint(['/no/such/file.json'])).toBe(2);
  });

  it('exits 2 on invalid JSON', async () => {
    const f = writeTmp('bad.json', '{not json');
    expect(await lint([f])).toBe(2);
  });
});

describe('cli: snapshot', () => {
  it('writes JSON manifest to stdout on 200', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ 'a.x': 'a'.repeat(64) }), { status: 200 }) as never,
    );
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await snapshot(['--catalog-url=http://catalog']);
    expect(code).toBe(0);
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/fingerprints');
    const written = String(stdoutSpy.mock.calls[0]![0]);
    expect(JSON.parse(written.trim())['a.x']).toMatch(/^a{64}$/);
    fetchMock.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('appends ?namespace= when --namespace is set', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }) as never,
    );
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await snapshot(['--catalog-url=http://catalog', '--namespace=pipeline']);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('namespace=pipeline');
    fetchMock.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('exits 2 when --catalog-url is missing', async () => {
    expect(await snapshot([])).toBe(2);
  });

  it('exits 1 on HTTP error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 503 }) as never,
    );
    expect(await snapshot(['--catalog-url=http://catalog'])).toBe(1);
    fetchMock.mockRestore();
  });

  describe('--from-source mode', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stdout: string;

    beforeEach(() => {
      stdout = '';
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        stdout += String(chunk);
        return true;
      });
    });
    afterEach(() => {
      stdoutSpy.mockRestore();
    });

    function writeDeclModule(name: string, body: string): string {
      // Write a `.mjs` so dynamic import treats it as ESM regardless of
      // package.json type field in the tmp dir.
      return writeTmp(name.endsWith('.mjs') ? name : `${name}.mjs`, body);
    }

    it('fingerprints declarations from a named `declarations` export', async () => {
      const mod = writeDeclModule('decls', `
        export const declarations = [
          { name: 'a.x', transport: 'signal', producer: 'svc',
            schema: { type: 'object', properties: { id: { type: 'string' } } } },
          { name: 'b.y', transport: 'signal', producer: 'svc',
            schema: { type: 'object', properties: { id: { type: 'number' } } } },
        ];
      `);
      const code = await snapshot(['--from-source', `--declarations=${mod}`]);
      expect(code).toBe(0);
      const manifest = JSON.parse(stdout.trim());
      expect(Object.keys(manifest).sort()).toEqual(['a.x', 'b.y']);
      expect(manifest['a.x']).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest['a.x']).not.toBe(manifest['b.y']);
    });

    it('falls back to default export', async () => {
      const mod = writeDeclModule('default', `
        export default [
          { name: 'd.x', transport: 'signal', producer: 'svc',
            schema: { type: 'object' } },
        ];
      `);
      const code = await snapshot(['--from-source', `--declarations=${mod}`]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())['d.x']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('honors --export=<name>', async () => {
      const mod = writeDeclModule('custom', `
        export const myDecls = [
          { name: 'c.x', transport: 'signal', producer: 'svc', schema: { type: 'string' } },
        ];
      `);
      const code = await snapshot(['--from-source', `--declarations=${mod}`, '--export=myDecls']);
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())['c.x']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces byte-identical fingerprints regardless of schema key order', async () => {
      const modA = writeDeclModule('orderA', `
        export const declarations = [
          { name: 'k.v', transport: 'signal', producer: 'svc',
            schema: { type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'number' } } } },
        ];
      `);
      const modB = writeDeclModule('orderB', `
        export const declarations = [
          { name: 'k.v', transport: 'signal', producer: 'svc',
            schema: { properties: { b: { type: 'number' }, a: { type: 'string' } }, required: ['a', 'b'], type: 'object' } },
        ];
      `);
      await snapshot(['--from-source', `--declarations=${modA}`]);
      const aOut = JSON.parse(stdout.trim());
      stdout = '';
      await snapshot(['--from-source', `--declarations=${modB}`]);
      const bOut = JSON.parse(stdout.trim());
      expect(aOut['k.v']).toBe(bOut['k.v']);
    });

    it('filters by --namespace when provided', async () => {
      const mod = writeDeclModule('ns', `
        export const declarations = [
          { name: 'pipe.x', namespace: 'pipeline', transport: 'signal', producer: 'svc', schema: { type: 'object' } },
          { name: 'gate.x', namespace: 'gateway',  transport: 'signal', producer: 'svc', schema: { type: 'object' } },
        ];
      `);
      const code = await snapshot(['--from-source', `--declarations=${mod}`, '--namespace=pipeline']);
      expect(code).toBe(0);
      expect(Object.keys(JSON.parse(stdout.trim()))).toEqual(['pipe.x']);
    });

    it('sorts keys for stable diffs', async () => {
      const mod = writeDeclModule('sort', `
        export const declarations = [
          { name: 'z.last', transport: 'signal', producer: 'svc', schema: { type: 'object' } },
          { name: 'a.first', transport: 'signal', producer: 'svc', schema: { type: 'object' } },
          { name: 'm.mid', transport: 'signal', producer: 'svc', schema: { type: 'object' } },
        ];
      `);
      await snapshot(['--from-source', `--declarations=${mod}`]);
      const keys = Object.keys(JSON.parse(stdout.trim()));
      expect(keys).toEqual(['a.first', 'm.mid', 'z.last']);
    });

    it('exits 2 when --declarations is missing', async () => {
      expect(await snapshot(['--from-source'])).toBe(2);
    });

    it('exits 2 when the declarations module cannot be loaded', async () => {
      expect(await snapshot(['--from-source', '--declarations=/no/such/module.mjs'])).toBe(2);
    });

    it('exits 2 when the module has no recognized export', async () => {
      const mod = writeDeclModule('empty', `export const somethingElse = 42;`);
      expect(await snapshot(['--from-source', `--declarations=${mod}`])).toBe(2);
    });

    it('exits 2 when a declaration is malformed', async () => {
      const mod = writeDeclModule('bad', `
        export const declarations = [
          { name: 'ok', transport: 'signal', producer: 'svc', schema: { type: 'object' } },
          { name: 'oops-no-schema', transport: 'signal', producer: 'svc' },
        ];
      `);
      expect(await snapshot(['--from-source', `--declarations=${mod}`])).toBe(2);
    });
  });
});

describe('cli: drift', () => {
  const fp = (c: string) => c.repeat(64);

  it('exits 0 when live matches snapshot', async () => {
    const f = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ 'a.x': fp('a') }), { status: 200 }) as never,
    );
    expect(await drift(['--catalog-url=http://x', `--against=${f}`])).toBe(0);
    fetchMock.mockRestore();
  });

  it('detects added/removed/changed events; exits 1', async () => {
    const f = writeTmp('snap.json', JSON.stringify({
      'kept.same': fp('a'),
      'removed.x': fp('r'),
      'changed.y': fp('o'),
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        'kept.same': fp('a'),
        'changed.y': fp('n'),
        'added.z': fp('z'),
      }), { status: 200 }) as never,
    );
    const code = await drift(['--catalog-url=http://x', `--against=${f}`]);
    expect(code).toBe(1);
    const all = logSpy.mock.calls.flat().join('\n');
    expect(all).toContain('+ added.z');
    expect(all).toContain('- removed.x');
    expect(all).toContain('~ changed.y');
    expect(all).toContain('1 added, 1 removed, 1 changed');
    fetchMock.mockRestore();
  });

  it('exits 2 when --against is missing', async () => {
    expect(await drift(['--catalog-url=http://x'])).toBe(2);
  });

  it('exits 2 when the --against snapshot file does not exist', async () => {
    expect(await drift(['--catalog-url=http://x', '--against=/no/such/snapshot.json'])).toBe(2);
    const all = errorSpy.mock.calls.flat().join('\n');
    expect(all).toContain('cannot read snapshot');
  });

  it('exits 1 when catalog-url fetch throws a network error', async () => {
    const f = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const code = await drift([`--against=${f}`, '--catalog-url=http://x']);
    expect(code).toBe(1);
    const all = errorSpy.mock.calls.flat().join('\n');
    expect(all).toContain('fetch failed');
    fetchMock.mockRestore();
  });

  it('exits 2 when neither --catalog-url nor --registry-snapshot is provided', async () => {
    const f = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
    expect(await drift([`--against=${f}`])).toBe(2);
  });

  it('exits 2 when both --catalog-url and --registry-snapshot are provided', async () => {
    const f = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
    const r = writeTmp('reg.json', JSON.stringify({ 'a.x': fp('a') }));
    expect(await drift([
      '--catalog-url=http://x', `--registry-snapshot=${r}`, `--against=${f}`,
    ])).toBe(2);
  });

  describe('offline mode (--registry-snapshot)', () => {
    it('exits 0 when committed snapshots match', async () => {
      const a = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
      const r = writeTmp('reg.json', JSON.stringify({ 'a.x': fp('a') }));
      expect(await drift([`--against=${a}`, `--registry-snapshot=${r}`])).toBe(0);
    });

    it('detects drift between two committed snapshot files; exits 1', async () => {
      const a = writeTmp('snap.json', JSON.stringify({
        'kept.same': fp('a'),
        'removed.x': fp('r'),
        'changed.y': fp('o'),
      }));
      const r = writeTmp('reg.json', JSON.stringify({
        'kept.same': fp('a'),
        'changed.y': fp('n'),
        'added.z': fp('z'),
      }));
      const code = await drift([`--against=${a}`, `--registry-snapshot=${r}`]);
      expect(code).toBe(1);
      const all = logSpy.mock.calls.flat().join('\n');
      expect(all).toContain('+ added.z');
      expect(all).toContain('- removed.x');
      expect(all).toContain('~ changed.y');
    });

    it('exits 2 when registry snapshot file is unreadable', async () => {
      const a = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
      expect(await drift([`--against=${a}`, '--registry-snapshot=/no/such/registry.json'])).toBe(2);
    });

    it('does not invoke fetch in offline mode', async () => {
      const a = writeTmp('snap.json', JSON.stringify({ 'a.x': fp('a') }));
      const r = writeTmp('reg.json', JSON.stringify({ 'a.x': fp('a') }));
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      await drift([`--against=${a}`, `--registry-snapshot=${r}`]);
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    });
  });
});

describe('cli: manifest pin', () => {
  it('PUTs a manifest from --snapshot file', async () => {
    const f = writeTmp('snap.json', JSON.stringify({
      'a.x': 'a'.repeat(64),
      'b.y': 'b'.repeat(64),
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ updatedAt: '2026-05-15T00:00:00.000Z' }), { status: 201 }) as never,
    );
    const code = await manifest([
      'pin', '--catalog-url=http://x', '--consumer=audit', `--snapshot=${f}`,
    ]);
    expect(code).toBe(0);
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/manifests/audit');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PUT');
    const body = JSON.parse(String(init.body));
    expect(body.events).toHaveLength(2);
    expect(body.events.map((e: { name: string }) => e.name).sort()).toEqual(['a.x', 'b.y']);
    fetchMock.mockRestore();
  });

  it('PUTs a manifest from --events=... inline pairs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ updatedAt: '2026-05-15T00:00:00.000Z' }), { status: 201 }) as never,
    );
    const code = await manifest([
      'pin', '--catalog-url=http://x', '--consumer=audit',
      `--events=a.x=${'a'.repeat(64)},b.y=${'b'.repeat(64)}`,
    ]);
    expect(code).toBe(0);
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.events).toHaveLength(2);
    fetchMock.mockRestore();
  });

  it('exits 2 when neither --snapshot nor --events provided', async () => {
    expect(await manifest(['pin', '--catalog-url=http://x', '--consumer=audit'])).toBe(2);
  });

  it('exits 2 when the --snapshot file does not exist', async () => {
    expect(await manifest([
      'pin', '--catalog-url=http://x', '--consumer=audit', '--snapshot=/no/such/snap.json',
    ])).toBe(2);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('cannot read');
  });

  it('exits 2 when the --snapshot file contains invalid JSON', async () => {
    const f = writeTmp('bad.json', 'not json {{');
    expect(await manifest([
      'pin', '--catalog-url=http://x', '--consumer=audit', `--snapshot=${f}`,
    ])).toBe(2);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('invalid JSON');
  });

  it('exits 1 when the catalog-url fetch throws a network error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await manifest([
      'pin', '--catalog-url=http://x', '--consumer=audit', `--events=a.x=${'a'.repeat(64)}`,
    ])).toBe(1);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('fetch failed');
    fetchMock.mockRestore();
  });

  it('exits 1 on non-2xx HTTP response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('bad', { status: 400 }) as never,
    );
    expect(await manifest([
      'pin', '--catalog-url=http://x', '--consumer=audit',
      `--events=a.x=${'a'.repeat(64)}`,
    ])).toBe(1);
    fetchMock.mockRestore();
  });

  it('exits 2 on unknown subcommand', async () => {
    expect(await manifest(['unknown'])).toBe(2);
  });
});

describe('cli: manifest verify', () => {
  const fp = (c: string) => c.repeat(64);

  it('exits 0 when every pinned event is fresh', async () => {
    const consumed = writeTmp('consumed.json', JSON.stringify({
      'a.x': fp('a'),
      'b.y': fp('b'),
    }));
    const registry = writeTmp('registry.json', JSON.stringify({
      'a.x': fp('a'),
      'b.y': fp('b'),
      'c.z': fp('c'),
    }));
    const code = await manifest([
      'verify', `--against=${consumed}`, `--registry-snapshot=${registry}`,
    ]);
    expect(code).toBe(0);
    const all = logSpy.mock.calls.flat().join('\n');
    expect(all).toContain('2 fresh, 0 stale, 0 unknown');
  });

  it('flags stale fingerprints; exits 1', async () => {
    const consumed = writeTmp('consumed.json', JSON.stringify({
      'a.x': fp('a'),
      'b.y': fp('b'),
    }));
    const registry = writeTmp('registry.json', JSON.stringify({
      'a.x': fp('a'),
      'b.y': fp('Z'),
    }));
    const code = await manifest([
      'verify', `--against=${consumed}`, `--registry-snapshot=${registry}`,
    ]);
    expect(code).toBe(1);
    const all = logSpy.mock.calls.flat().join('\n');
    expect(all).toContain('! b.y');
    expect(all).toContain('1 fresh, 1 stale, 0 unknown');
  });

  it('flags unknown events (removed from registry); exits 1', async () => {
    const consumed = writeTmp('consumed.json', JSON.stringify({
      'gone.x': fp('g'),
    }));
    const registry = writeTmp('registry.json', JSON.stringify({
      'still.here': fp('s'),
    }));
    const code = await manifest([
      'verify', `--against=${consumed}`, `--registry-snapshot=${registry}`,
    ]);
    expect(code).toBe(1);
    const all = logSpy.mock.calls.flat().join('\n');
    expect(all).toContain('? gone.x');
    expect(all).toContain('0 fresh, 0 stale, 1 unknown');
  });

  it('exits 2 when --against is missing', async () => {
    const registry = writeTmp('registry.json', '{}');
    expect(await manifest(['verify', `--registry-snapshot=${registry}`])).toBe(2);
  });

  it('exits 2 when --registry-snapshot is missing', async () => {
    const consumed = writeTmp('consumed.json', '{}');
    expect(await manifest(['verify', `--against=${consumed}`])).toBe(2);
  });

  it('exits 2 when files are unreadable', async () => {
    expect(await manifest([
      'verify', '--against=/no/such/consumed.json', '--registry-snapshot=/no/such/registry.json',
    ])).toBe(2);
  });
});
