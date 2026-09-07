// tests/cli-bin.test.ts
//
// End-to-end checks of the four shipped bin entry points. These spawn a
// real process because the entry-point wiring itself — the dispatcher,
// the `process.exitCode` mapping, and the "no unhandled rejection ever
// escapes" guarantee — cannot be observed from an in-process call.
//
// Everything else about the commands is covered in-process by
// tests/cli-hardening.test.ts, so keep the spawned set small.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run one of the bin sources through tsx and capture its exit code + output. */
function run(script: string, args: string[]): Run {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(REPO_ROOT, 'src', 'cli', script), ...args],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Node prints `    at fn (file:line)` frames — an operator should never see one. */
function hasStackTrace(text: string): boolean {
  return /^\s+at .+:\d+:\d+\)?$/m.test(text) || text.includes('UnhandledPromiseRejection');
}

let tmpDir: string;
beforeAll(() => { tmpDir = mkdtempSync(join(tmpdir(), 'evcat-bin-')); });
afterAll(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('event-catalog bin', () => {
  it('--help exits 0 and lists the subcommands', () => {
    const r = run('index.ts', ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('event-catalog drift');
    expect(r.stderr).toBe('');
  });

  it('delegates --help to the subcommand', () => {
    const r = run('index.ts', ['drift', '--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--registry-snapshot');
  });

  it('exits 2 on an unknown subcommand', () => {
    const r = run('index.ts', ['bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown subcommand "bogus"');
    expect(hasStackTrace(r.stderr)).toBe(false);
  });

  it('exits 2 on an unknown server-mode flag instead of booting the server', () => {
    const r = run('index.ts', ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown flag "--bogus"');
    expect(r.stdout).not.toContain('event-catalog server');
  });

  it('exits 2 on a non-numeric --port instead of listening on NaN', () => {
    const r = run('index.ts', ['--port=notaport']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('invalid --port');
  });

  it('exits 2 with one line when lint is pointed at a missing file', () => {
    const r = run('index.ts', ['lint', '/no/such/decls.json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no such file or directory');
    expect(hasStackTrace(r.stderr)).toBe(false);
  });

  it('exits 1 when lint finds a malformed schema', () => {
    const f = join(tmpDir, 'bad-schema.json');
    writeFileSync(f, JSON.stringify({ events: [{ name: 'bad', schema: { type: 'objct' } }] }));
    const r = run('index.ts', ['lint', f]);
    expect(r.code).toBe(1);
  });

  it('exits 0 when lint is clean', () => {
    const f = join(tmpDir, 'good.json');
    writeFileSync(f, JSON.stringify({ events: [{ name: 'ok', schema: { type: 'object' } }] }));
    const r = run('index.ts', ['lint', f]);
    expect(r.code).toBe(0);
  });

  it('writes a complete manifest to a pipe (stdout is not truncated by exit)', () => {
    // Regression: the dispatcher used `process.exit(code)` right after
    // process.stdout.write(), which can drop buffered output on a pipe.
    const decls = Array.from({ length: 2000 }, (_, i) =>
      `{ name: 'evt.number.${i}', transport: 'signal', producer: 'svc', `
      + `schema: { type: 'object', properties: { id: { type: 'string' }, seq: { type: 'number' } } } }`,
    ).join(',\n');
    const mod = join(tmpDir, 'many.mjs');
    writeFileSync(mod, `export const declarations = [\n${decls}\n];\n`);

    const r = run('index.ts', ['snapshot', '--from-source', `--declarations=${mod}`]);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(64 * 1024);
    const parsed = JSON.parse(r.stdout) as Record<string, string>;
    expect(Object.keys(parsed)).toHaveLength(2000);
    expect(parsed['evt.number.1999']).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});

describe('ec-lint-crd bin', () => {
  it('--help exits 0', () => {
    const r = run('lint-crd.ts', ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--fix-fingerprints');
  });

  it('exits 2 on an unknown flag', () => {
    const r = run('lint-crd.ts', ['--nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown flag "--nope"');
  });

  it('exits 2 with one line on a missing path', () => {
    const r = run('lint-crd.ts', ['/no/such/crds']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('path not found');
    expect(hasStackTrace(r.stderr)).toBe(false);
  });

  it('exits 0 for --list-deprecated', () => {
    const r = run('lint-crd.ts', ['--list-deprecated']);
    expect(r.code).toBe(0);
  });
});

describe('ec-bundle-diff bin', () => {
  it('--help exits 0', () => {
    const r = run('bundle-diff.ts', ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('EXIT CODES');
  });

  it('exits 0 on a real diff', () => {
    const r = run('bundle-diff.ts', ['chat@1.0.0', 'chat@1.0.0']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Bundle: chat');
  });

  it('exits 1 when a bundle version is unknown', () => {
    const r = run('bundle-diff.ts', ['chat@98.0.0', 'chat@99.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('bundle not found');
  });

  it('exits 2 when only one reference is given', () => {
    const r = run('bundle-diff.ts', ['chat@1.0.0']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('two bundle references required');
  });

  it('exits 2 on an unknown flag', () => {
    const r = run('bundle-diff.ts', ['chat@1.0.0', 'chat@2.0.0', '--verbose']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown flag "--verbose"');
  });
});

describe('ec-bundle-create bin', () => {
  it('--help exits 0 without scaffolding anything', () => {
    const r = run('bundle-create.ts', ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ec-bundle-create');
  });

  it('exits 2 with usage when the name is missing', () => {
    const r = run('bundle-create.ts', []);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('bundle name is required');
    expect(r.stderr).toContain('usage:');
    expect(hasStackTrace(r.stderr)).toBe(false);
  });

  it('exits 2 on an invalid transport', () => {
    const r = run('bundle-create.ts', ['thing', '--transport', 'grpc']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('invalid transport');
  });

  it('exits 2 on an unknown flag before touching the filesystem', () => {
    const r = run('bundle-create.ts', ['thing', '--dry-run']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown flag "--dry-run"');
  });
});
