// tests/cli/lint-crd-deprecation.test.ts
//
// Tests for deprecation-specific behaviour in ec-lint-crd:
//   - CRD referencing a deprecated bundle → exit 2 + warn message + replacement
//   - CRD referencing both deprecated + nonexistent → exit 1 (errors win)
//   - --list-deprecated subcommand returns table of deprecated bundles

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lintCrd } from '../../src/cli/lint-crd.js';
import { registerFeatureBundle } from '../../src/bundles/FeatureBundle.js';

// ---------------------------------------------------------------------------
// Shared setup: register test deprecated bundles once (module-singleton store).
// We rely on the fact that registerFeatureBundle is idempotent for same name+version.
// ---------------------------------------------------------------------------

const DEPRECATED_NAME = 'legacy-chat';
const DEPRECATED_VERSION = '0.9.0';
const DEPRECATED_REPLACEMENT = 'chat@1.0.0';

// Register before tests run (top-level, not inside beforeEach — the module
// singleton persists across the test file).
registerFeatureBundle({
  name: DEPRECATED_NAME,
  version: DEPRECATED_VERSION,
  transport: 'signal',
  events: [{ name: 'ws.chat.message', required: true }],
  deprecated: { since: '2026-05-22', replacement: DEPRECATED_REPLACEMENT },
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ec-lint-crd-dep-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function writeCrd(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content);
  return p;
}

function makeCrdYaml(opts: {
  kind?: string;
  name?: string;
  eventBundle?: string;
  apiVersion?: string;
}): string {
  const {
    kind = 'ChatRoom',
    name = 'test-room',
    eventBundle,
    apiVersion = 'platform.connorhoehn.dev/v1alpha1',
  } = opts;

  return [
    `apiVersion: ${apiVersion}`,
    `kind: ${kind}`,
    'metadata:',
    `  name: ${name}`,
    '  namespace: default',
    'spec:',
    '  channel: "chat:test"',
    eventBundle ? `  eventBundle: "${eventBundle}"` : '',
    'status:',
    '  phase: Ready',
  ].filter(Boolean).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Deprecated bundle → exit 2 + structured warning
// ---------------------------------------------------------------------------

describe('CRD referencing deprecated bundle', () => {
  it('exits 3 (warn, not error) when only deprecated refs found', async () => {
    const f = writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: `${DEPRECATED_NAME}@${DEPRECATED_VERSION}`,
    }));
    const code = await lintCrd([f]);
    // 3, not 2: 2 is reserved for usage errors so `|| [ $? -eq 3 ]` cannot
    // swallow a mistyped path as a clean-with-warnings run.
    expect(code).toBe(3);
  });

  it('outputs DEPRECATED warning with since date', async () => {
    const f = writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: `${DEPRECATED_NAME}@${DEPRECATED_VERSION}`,
    }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('deprecated since 2026-05-22');
  });

  it('outputs replacement suggestion in warning', async () => {
    const f = writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: `${DEPRECATED_NAME}@${DEPRECATED_VERSION}`,
    }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain(DEPRECATED_REPLACEMENT);
    expect(out).toContain('use');
  });

  it('uses ! prefix on deprecation warning line', async () => {
    const f = writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: `${DEPRECATED_NAME}@${DEPRECATED_VERSION}`,
    }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('!');
  });
});

// ---------------------------------------------------------------------------
// Mix: deprecated + nonexistent → exit 1 (errors beat warnings)
// ---------------------------------------------------------------------------

describe('CRD with both deprecated and nonexistent bundle refs', () => {
  it('exits 1 (error) when both deprecated and not-found bundles are present', async () => {
    const depFile = writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: `${DEPRECATED_NAME}@${DEPRECATED_VERSION}`,
    }));
    const badFile = writeCrd('missing.yaml', makeCrdYaml({
      kind: 'PresenceGroup',
      name: 'pres-room',
      eventBundle: 'nonexistent-bundle@1.0.0',
    }));

    // Pass directory so both files are scanned
    const code = await lintCrd([tmpDir]);
    expect(code).toBe(1);
  });

  it('output contains both DEPRECATED warning and BUNDLE NOT FOUND error', async () => {
    writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: `${DEPRECATED_NAME}@${DEPRECATED_VERSION}`,
    }));
    writeCrd('missing.yaml', makeCrdYaml({
      kind: 'PresenceGroup',
      name: 'pres-room',
      eventBundle: 'nonexistent-bundle@1.0.0',
    }));

    await lintCrd([tmpDir]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('deprecated since');
    expect(out).toContain('BUNDLE NOT FOUND');
  });
});

// ---------------------------------------------------------------------------
// --list-deprecated subcommand
// ---------------------------------------------------------------------------

describe('--list-deprecated subcommand', () => {
  it('exits 0', async () => {
    const code = await lintCrd(['--list-deprecated']);
    expect(code).toBe(0);
  });

  it('lists the deprecated bundle name and version', async () => {
    await lintCrd(['--list-deprecated']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain(`${DEPRECATED_NAME}@${DEPRECATED_VERSION}`);
  });

  it('shows the since date', async () => {
    await lintCrd(['--list-deprecated']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('deprecated since 2026-05-22');
  });

  it('shows the replacement bundle', async () => {
    await lintCrd(['--list-deprecated']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain(DEPRECATED_REPLACEMENT);
  });

  it('shows total count of deprecated bundles', async () => {
    await lintCrd(['--list-deprecated']);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toMatch(/\d+ deprecated bundle/);
  });

  it('does not require a path argument (no usage-error exit)', async () => {
    // --list-deprecated should work standalone without a <path>
    const code = await lintCrd(['--list-deprecated']);
    const err = errorSpy.mock.calls.flat().join('\n');
    expect(code).toBe(0);
    expect(err).not.toContain('no path provided');
  });
});
