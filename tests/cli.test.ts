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
