// tests/cli-deprecate-asyncapi.test.ts
//
// wave25-c — covers the new CLI subcommands. Same pattern as cli.test.ts:
// invoke handlers directly with a mocked fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deprecate, undeprecate } from '../src/cli/commands/deprecate.js';
import { asyncapi } from '../src/cli/commands/asyncapi.js';

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'evcat-cli25c-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  stdoutSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('cli: deprecate', () => {
  it('exits 0 and POSTs to /api/events/:name/deprecate with reason+by', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ deprecated: 'a.x', deprecation: { deprecatedAt: '2026-01-01T00:00:00Z' } }), { status: 200 }),
    );
    const code = await deprecate(['a.x', '--catalog-url=https://catalog', '--reason=replaced', '--by=connor']);
    expect(code).toBe(0);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toBe('https://catalog/api/events/a.x/deprecate');
    const opts = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe('POST');
    const body = JSON.parse(String(opts.body));
    expect(body).toEqual({ reason: 'replaced', by: 'connor' });
    fetchMock.mockRestore();
  });

  it('exits 2 without --catalog-url', async () => {
    expect(await deprecate(['a.x'])).toBe(2);
  });

  it('exits 2 without an event name', async () => {
    expect(await deprecate(['--catalog-url=x'])).toBe(2);
  });

  it('exits 1 on non-2xx HTTP', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    );
    expect(await deprecate(['a.x', '--catalog-url=https://catalog'])).toBe(1);
    fetchMock.mockRestore();
  });

  it('exits 1 when fetch throws a network error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await deprecate(['a.x', '--catalog-url=https://catalog'])).toBe(1);
    const all = errorSpy.mock.calls.flat().join('\n');
    expect(all).toContain('fetch failed');
    fetchMock.mockRestore();
  });
});

describe('cli: undeprecate', () => {
  it('DELETEs the deprecate endpoint and exits 0', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ undeprecated: 'a.x' }), { status: 200 }),
    );
    const code = await undeprecate(['a.x', '--catalog-url=https://catalog']);
    expect(code).toBe(0);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://catalog/api/events/a.x/deprecate');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    fetchMock.mockRestore();
  });

  it('exits 2 without --catalog-url', async () => {
    expect(await undeprecate(['a.x'])).toBe(2);
  });

  it('exits 1 when fetch throws a network error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await undeprecate(['a.x', '--catalog-url=https://catalog'])).toBe(1);
    const all = errorSpy.mock.calls.flat().join('\n');
    expect(all).toContain('fetch failed');
    fetchMock.mockRestore();
  });

  it('exits 1 on non-2xx HTTP response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('forbidden', { status: 403 }),
    );
    expect(await undeprecate(['a.x', '--catalog-url=https://catalog'])).toBe(1);
    fetchMock.mockRestore();
  });
});

describe('cli: asyncapi', () => {
  it('writes spec to stdout when --output is omitted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"asyncapi":"3.0.0"}', { status: 200 }),
    );
    const code = await asyncapi(['--catalog-url=https://catalog']);
    expect(code).toBe(0);
    const written = stdoutSpy.mock.calls.map(c => String(c[0])).join('');
    expect(written).toContain('"asyncapi":"3.0.0"');
    fetchMock.mockRestore();
  });

  it('writes spec to file with --output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"asyncapi":"3.0.0"}', { status: 200 }),
    );
    const out = join(tmpDir, 'spec.json');
    const code = await asyncapi(['--catalog-url=https://catalog', `--output=${out}`]);
    expect(code).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('{"asyncapi":"3.0.0"}');
    fetchMock.mockRestore();
  });

  it('passes title/version/namespace as query params', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    await asyncapi(['--catalog-url=https://catalog', '--title=My Catalog', '--version=1.2.3', '--namespace=auth']);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('title=My+Catalog');
    expect(url).toContain('version=1.2.3');
    expect(url).toContain('namespace=auth');
    fetchMock.mockRestore();
  });

  it('exits 2 without --catalog-url', async () => {
    expect(await asyncapi([])).toBe(2);
  });

  it('exits 1 when fetch throws a network error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await asyncapi(['--catalog-url=https://catalog'])).toBe(1);
    const all = errorSpy.mock.calls.flat().join('\n');
    expect(all).toContain('fetch failed');
    fetchMock.mockRestore();
  });

  it('exits 1 when writing the output file fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"asyncapi":"3.0.0"}', { status: 200 }),
    );
    // Pass a directory path as the output file — writeFileSync will throw.
    expect(await asyncapi(['--catalog-url=https://catalog', `--output=${tmpDir}`])).toBe(1);
    const all = errorSpy.mock.calls.flat().join('\n');
    expect(all).toContain('write failed');
    fetchMock.mockRestore();
  });

  it('exits 1 on non-2xx HTTP', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    );
    expect(await asyncapi(['--catalog-url=https://catalog'])).toBe(1);
    fetchMock.mockRestore();
  });
});
