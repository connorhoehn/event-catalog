// tests/cli-args.test.ts
//
// Unit tests for the shared CLI argument/error helpers in
// `src/cli/_args.ts`. Every binary and subcommand routes its argv through
// `parseFlags`, so the contract tested here — unknown flags are errors,
// value flags need values, `--help` always wins — is what makes the whole
// operator surface predictable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseFlags,
  usageError,
  formatError,
  readJsonFile,
  readFingerprintMap,
  readJsonResponse,
  runCli,
} from '../src/cli/_args.js';

let tmpDir: string;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'evcat-args-'));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmp(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content);
  return p;
}

const SPEC = { value: ['catalog-url', 'namespace'], boolean: ['from-source'] } as const;

describe('parseFlags: value flags', () => {
  it('accepts --name=value', () => {
    const r = parseFlags(['--catalog-url=http://x'], SPEC);
    expect(r.ok).toBe(true);
    expect(r.ok && r.args.values['catalog-url']).toBe('http://x');
  });

  it('accepts --name value', () => {
    const r = parseFlags(['--catalog-url', 'http://x'], SPEC);
    expect(r.ok && r.args.values['catalog-url']).toBe('http://x');
  });

  it('does not swallow the next flag as a value', () => {
    const r = parseFlags(['--catalog-url', '--from-source'], SPEC);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('--catalog-url requires a value');
  });

  it('errors when a value flag ends argv', () => {
    const r = parseFlags(['--namespace'], SPEC);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('requires a value');
  });

  it('keeps an empty --name= value as an empty string', () => {
    const r = parseFlags(['--namespace='], SPEC);
    expect(r.ok && r.args.values['namespace']).toBe('');
  });

  it('preserves values that contain = and spaces', () => {
    const r = parseFlags(['--namespace=a=b c'], SPEC);
    expect(r.ok && r.args.values['namespace']).toBe('a=b c');
  });
});

describe('parseFlags: boolean flags', () => {
  it('records a switch', () => {
    const r = parseFlags(['--from-source'], SPEC);
    expect(r.ok && r.args.flags.has('from-source')).toBe(true);
  });

  it('rejects a value on a switch', () => {
    const r = parseFlags(['--from-source=yes'], SPEC);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('does not take a value');
  });
});

describe('parseFlags: unknown flags', () => {
  it('rejects an unknown long flag and lists the known ones', () => {
    const r = parseFlags(['--catalog-ur=http://x'], SPEC);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('unknown flag "--catalog-ur"');
    expect(!r.ok && r.error).toContain('--catalog-url');
  });

  it('rejects an unknown short flag', () => {
    const r = parseFlags(['-x'], SPEC);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('unknown flag "-x"');
  });

  it('rejects a bare --=', () => {
    const r = parseFlags(['--=x'], SPEC);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('malformed flag');
  });

  it('rejects unknown flags even when a command takes no flags at all', () => {
    const r = parseFlags(['--anything'], {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('unknown flag');
  });
});

describe('parseFlags: positionals and help', () => {
  it('collects positionals in order', () => {
    const r = parseFlags(['a', '--from-source', 'b'], SPEC);
    expect(r.ok && r.args.positional).toEqual(['a', 'b']);
  });

  it('treats a lone - as a positional (stdin convention)', () => {
    const r = parseFlags(['-'], SPEC);
    expect(r.ok && r.args.positional).toEqual(['-']);
  });

  it('stops flag parsing after a bare --', () => {
    const r = parseFlags(['--', '--not-a-flag'], SPEC);
    expect(r.ok && r.args.positional).toEqual(['--not-a-flag']);
  });

  it('sets help for --help anywhere in argv', () => {
    const r = parseFlags(['--catalog-url=x', '--help'], SPEC);
    expect(r.ok && r.args.help).toBe(true);
  });

  it('sets help for -h', () => {
    const r = parseFlags(['-h'], SPEC);
    expect(r.ok && r.args.help).toBe(true);
  });
});

describe('usageError', () => {
  it('returns 2 and prints the message, usage, and help pointer', () => {
    const code = usageError('ec-test', 'something is wrong', 'ec-test <path>');
    expect(code).toBe(2);
    const printed = errorSpy.mock.calls.flat().join('\n');
    expect(printed).toContain('ec-test: something is wrong');
    expect(printed).toContain('usage: ec-test <path>');
    expect(printed).toContain('--help');
  });
});

describe('formatError', () => {
  it('renders ENOENT as a human phrase, not a stack trace', () => {
    const err = Object.assign(new Error('ENOENT: no such file or directory, open \'/x\''), {
      code: 'ENOENT',
      path: '/x',
    });
    const msg = formatError(err);
    expect(msg).toBe('no such file or directory: /x');
    expect(msg).not.toContain('Error:');
  });

  it('omits the path when asked', () => {
    const err = Object.assign(new Error('boom'), { code: 'EACCES', path: '/x' });
    expect(formatError(err, false)).toBe('permission denied');
  });

  it('falls back to the message for non-errno errors', () => {
    expect(formatError(new Error('plain failure'))).toBe('plain failure');
  });

  it('stringifies non-Error throws', () => {
    expect(formatError('a string throw')).toBe('a string throw');
  });
});

describe('readJsonFile', () => {
  it('parses a readable JSON file', () => {
    const f = writeTmp('ok.json', '{"a":1}');
    const r = readJsonFile(f);
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  it('reports a missing file in one line, naming the path once', () => {
    const r = readJsonFile('/no/such/file.json', 'snapshot');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('cannot read snapshot "/no/such/file.json": no such file or directory');
  });

  it('reports a directory passed where a file was expected', () => {
    const dir = join(tmpDir, 'sub');
    mkdirSync(dir);
    const r = readJsonFile(dir);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('is a directory');
  });

  it('reports malformed JSON', () => {
    const f = writeTmp('bad.json', '{nope');
    const r = readJsonFile(f, 'declarations file');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('is not valid JSON');
  });
});

describe('readFingerprintMap', () => {
  it('accepts a flat string map', () => {
    const f = writeTmp('m.json', JSON.stringify({ 'a.x': 'f1' }));
    const r = readFingerprintMap(f);
    expect(r.ok && r.value).toEqual({ 'a.x': 'f1' });
  });

  it('rejects a top-level array', () => {
    const f = writeTmp('arr.json', '[1,2,3]');
    const r = readFingerprintMap(f);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('must be a JSON object');
  });

  it('rejects a top-level string (would otherwise be walked by index)', () => {
    const f = writeTmp('str.json', '"abc"');
    const r = readFingerprintMap(f);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('must be a JSON object');
  });

  it('rejects a non-string fingerprint and names the offending event', () => {
    const f = writeTmp('mixed.json', JSON.stringify({ 'a.x': 1 }));
    const r = readFingerprintMap(f);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('"a.x"');
  });
});

describe('readJsonResponse', () => {
  it('parses a JSON body', async () => {
    const r = await readJsonResponse(new Response('{"a":1}', { status: 200 }), 'http://x');
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  it('reports an HTML/non-JSON body instead of throwing', async () => {
    const r = await readJsonResponse(new Response('<html>oops</html>', { status: 200 }), 'http://x');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('did not return JSON');
  });

  it('reports an empty body', async () => {
    const r = await readJsonResponse(new Response('', { status: 200 }), 'http://x');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('an empty body');
  });
});

describe('runCli', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => { process.exitCode = originalExitCode; });

  it('maps a resolved code to process.exitCode', async () => {
    runCli('ec-test', async () => 3);
    await new Promise((r) => setImmediate(r));
    expect(process.exitCode).toBe(3);
  });

  it('turns a rejection into one error line and exit 1, never an unhandled rejection', async () => {
    runCli('ec-test', async () => { throw new Error('kaboom'); });
    await new Promise((r) => setImmediate(r));
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join('\n')).toBe('ec-test: kaboom');
  });
});
