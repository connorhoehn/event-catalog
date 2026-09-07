// tests/cli/lint-crd.test.ts
//
// Tests for the ec-lint-crd command (src/cli/lint-crd.ts).
//
// Uses the lintCrd() function directly (unit style) — no spawning needed
// because the function already abstracts the file-system walk and exit code.
// Fixtures are written to tmp dirs so tests are hermetic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lintCrd } from '../../src/cli/lint-crd.js';

// Actual fingerprints from the catalog (keep in sync with bundle declarations).
const CHAT_FP = 'cae711784c55a33194c2274bb34c4d25463c60736f7c9eb64c20e142e429d6e0';
const PRESENCE_FP = '41027a4c1a7507d435239b592feffeb8bc649429448c365d9f07b5d9f1ccca6a';

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ec-lint-crd-'));
  logSpy  = vi.spyOn(console, 'log').mockImplementation(() => {});
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCrdYaml(opts: {
  kind?: string;
  name?: string;
  namespace?: string;
  eventBundle?: string;
  apiVersion?: string;
}): string {
  const {
    kind = 'ChatRoom',
    name = 'test-room',
    namespace = 'default',
    eventBundle,
    apiVersion = 'platform.connorhoehn.dev/v1alpha1',
  } = opts;

  return [
    `apiVersion: ${apiVersion}`,
    `kind: ${kind}`,
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    'spec:',
    '  channel: "chat:test"',
    eventBundle ? `  eventBundle: "${eventBundle}"` : '',
    'status:',
    '  phase: Ready',
  ].filter(Boolean).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Fixture: valid CRD with existing bundle → exit 0
// ---------------------------------------------------------------------------

describe('valid CRD with existing bundle', () => {
  it('exits 0 for a single valid CRD file', async () => {
    const f = writeCrd('valid.yaml', makeCrdYaml({ eventBundle: 'chat@1.0.0' }));
    const code = await lintCrd([f]);
    expect(code).toBe(0);
  });

  it('outputs ✓ for found bundle', async () => {
    const f = writeCrd('valid.yaml', makeCrdYaml({ eventBundle: 'chat@1.0.0' }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('✓ eventBundle: chat@1.0.0 exists');
  });

  it('exits 0 for a bundle ref without version (latest)', async () => {
    const f = writeCrd('no-version.yaml', makeCrdYaml({ eventBundle: 'presence' }));
    // "presence" without @version → latest lookup → should exist
    const code = await lintCrd([f]);
    expect(code).toBe(0);
  });

  it('exits 0 for all 11 non-deprecated bundles', async () => {
    // agentic-pipeline@1.0.0 is excluded — it is deprecated (exit 2); use
    // agentic-pipeline-signal@1.0.0 or agentic-pipeline-durable@1.0.0 instead.
    const bundles = [
      'chat@1.0.0', 'presence@1.0.0', 'cursor@1.0.0',
      'reactions@1.0.0', 'activity@1.0.0',
      'agentic-pipeline-signal@1.0.0', 'agentic-pipeline-durable@1.0.0',
      'crdt-document@1.0.0', 'video-hangout@1.0.0', 'file-upload@1.0.0',
      'orgiq-newsroom@1.0.0',
    ];
    for (const b of bundles) {
      const f = writeCrd(`${b.replace('@', '-').replace('.', '_')}.yaml`, makeCrdYaml({ eventBundle: b }));
      const code = await lintCrd([f]);
      expect(code, `Expected exit 0 for bundle ${b}`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: CRD with nonexistent bundle → exit 1 with structured error
// ---------------------------------------------------------------------------

describe('CRD with nonexistent bundle', () => {
  it('exits 1 for an unknown bundle name', async () => {
    const f = writeCrd('bad-bundle.yaml', makeCrdYaml({ eventBundle: 'nonexistent@1.0.0' }));
    const code = await lintCrd([f]);
    expect(code).toBe(1);
  });

  it('outputs ✗ BUNDLE NOT FOUND for unknown bundle', async () => {
    const f = writeCrd('bad-bundle.yaml', makeCrdYaml({ eventBundle: 'nonexistent@1.0.0' }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('✗');
    expect(out).toContain('BUNDLE NOT FOUND');
  });

  it('exits 1 for unknown version of a known bundle', async () => {
    const f = writeCrd('bad-version.yaml', makeCrdYaml({ eventBundle: 'chat@9.9.9' }));
    const code = await lintCrd([f]);
    expect(code).toBe(1);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('BUNDLE NOT FOUND');
  });

  it('reports CRD kind/name in structured header', async () => {
    const f = writeCrd('bad.yaml', makeCrdYaml({
      kind: 'AgenticPipeline',
      name: 'my-pipeline',
      eventBundle: 'nonexistent@1.0.0',
    }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('CRD: AgenticPipeline/my-pipeline');
  });
});

// ---------------------------------------------------------------------------
// Fixture: CRD with stale fingerprint → exit 1
// ---------------------------------------------------------------------------

describe('CRD with stale fingerprint', () => {
  it('exits 1 when fingerprint does not match', async () => {
    const staleFingerprint = 'deadbeef' + '0'.repeat(56);
    const f = writeCrd('stale.yaml', makeCrdYaml({
      eventBundle: `chat@1.0.0#${staleFingerprint}`,
    }));
    const code = await lintCrd([f]);
    expect(code).toBe(1);
  });

  it('outputs fingerprint MISMATCH when stale', async () => {
    const staleFingerprint = 'deadbeef' + '0'.repeat(56);
    const f = writeCrd('stale.yaml', makeCrdYaml({
      eventBundle: `chat@1.0.0#${staleFingerprint}`,
    }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('MISMATCH');
    expect(out).toContain('deadbeef');
  });

  it('exits 0 when full fingerprint matches exactly', async () => {
    const f = writeCrd('good-fp.yaml', makeCrdYaml({
      eventBundle: `chat@1.0.0#${CHAT_FP}`,
    }));
    const code = await lintCrd([f]);
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('fingerprint matches');
  });

  it('exits 0 when 12-char truncated fingerprint matches', async () => {
    const shortFp = CHAT_FP.slice(0, 12);
    const f = writeCrd('short-fp.yaml', makeCrdYaml({
      eventBundle: `chat@1.0.0#${shortFp}`,
    }));
    const code = await lintCrd([f]);
    expect(code).toBe(0);
  });

  it('exits 0 for presence bundle with correct fingerprint', async () => {
    const f = writeCrd('presence-fp.yaml', makeCrdYaml({
      kind: 'PresenceGroup',
      name: 'ws-presence',
      eventBundle: `presence@1.0.0#${PRESENCE_FP}`,
    }));
    const code = await lintCrd([f]);
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture: deprecated bundle → exit 2 (warn) with structured warning
// ---------------------------------------------------------------------------

describe('deprecated bundle', () => {
  // We don't have a built-in deprecated bundle in v1. We test this by
  // importing the registry and temporarily registering a deprecated bundle.
  it('exits 3 (warn) and shows deprecation message for deprecated bundle', async () => {
    // Dynamically register a deprecated bundle for this test
    const { registerFeatureBundle } = await import('../../src/bundles/FeatureBundle.js');
    registerFeatureBundle({
      name: 'legacy-chat',
      version: '0.9.0',
      transport: 'signal',
      events: [{ name: 'ws.chat.message', required: true }],
      deprecated: { since: '1.0.0', replacement: 'chat@1.0.0' },
    });

    const f = writeCrd('deprecated.yaml', makeCrdYaml({
      eventBundle: 'legacy-chat@0.9.0',
    }));
    const code = await lintCrd([f]);
    // 3 = warnings only; 2 stays reserved for usage errors.
    expect(code).toBe(3);

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('deprecated since 1.0.0');
    expect(out).toContain('chat@1.0.0');
    expect(out).toContain('!');
  });
});

// ---------------------------------------------------------------------------
// Fixture: non-platform CRD → skipped, doesn't affect exit code
// ---------------------------------------------------------------------------

describe('non-platform CRD', () => {
  it('skips non-platform CRDs and exits 0', async () => {
    const f = writeCrd('foreign.yaml', [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: my-app',
      'spec:',
      '  replicas: 1',
      '  eventBundle: "fake@1.0.0"',
    ].join('\n') + '\n');
    const code = await lintCrd([f]);
    expect(code).toBe(0);
  });

  it('does not output CRD lines for non-platform CRDs', async () => {
    const f = writeCrd('foreign.yaml', [
      'apiVersion: networking.k8s.io/v1',
      'kind: Ingress',
      'metadata:',
      '  name: my-ingress',
      'spec:',
      '  rules: []',
    ].join('\n') + '\n');
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).not.toContain('CRD: Ingress');
  });

  it('exits 1 when platform CRD + non-platform CRD are mixed and platform one errors', async () => {
    const d = mkdirSync(join(tmpDir, 'mixed'), { recursive: true }) as string | undefined;
    const mixedDir = d ?? join(tmpDir, 'mixed');

    writeFileSync(join(mixedDir, 'deploy.yaml'), [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: my-app',
      'spec:',
      '  replicas: 1',
    ].join('\n') + '\n');

    writeFileSync(join(mixedDir, 'chatroom.yaml'), makeCrdYaml({
      eventBundle: 'nonexistent@1.0.0',
    }));

    const code = await lintCrd([mixedDir]);
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-document YAML files
// ---------------------------------------------------------------------------

describe('multi-document YAML', () => {
  it('processes all documents in a multi-doc YAML file', async () => {
    const content = [
      'apiVersion: platform.connorhoehn.dev/v1alpha1',
      'kind: ChatRoom',
      'metadata:',
      '  name: room-1',
      'spec:',
      '  channel: "chat:room-1"',
      '  eventBundle: "chat@1.0.0"',
      '---',
      'apiVersion: platform.connorhoehn.dev/v1alpha1',
      'kind: PresenceGroup',
      'metadata:',
      '  name: pres-1',
      'spec:',
      '  channel: "presence:ws"',
      '  eventBundle: "presence@1.0.0"',
    ].join('\n');

    const f = writeCrd('multi.yaml', content);
    const code = await lintCrd([f]);
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('ChatRoom/room-1');
    expect(out).toContain('PresenceGroup/pres-1');
  });

  it('detects error in one doc of multi-doc file; exits 1', async () => {
    const content = [
      'apiVersion: platform.connorhoehn.dev/v1alpha1',
      'kind: ChatRoom',
      'metadata:',
      '  name: good-room',
      'spec:',
      '  channel: "chat:good"',
      '  eventBundle: "chat@1.0.0"',
      '---',
      'apiVersion: platform.connorhoehn.dev/v1alpha1',
      'kind: RealtimeChannel',
      'metadata:',
      '  name: bad-channel',
      'spec:',
      '  channelName: "stream:bad"',
      '  eventBundle: "missing-bundle@1.0.0"',
    ].join('\n');

    const f = writeCrd('multi-err.yaml', content);
    const code = await lintCrd([f]);
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

describe('directory scanning', () => {
  it('scans a directory recursively and checks all platform CRDs', async () => {
    const subDir = join(tmpDir, 'sub');
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(tmpDir, 'room.yaml'), makeCrdYaml({ eventBundle: 'chat@1.0.0' }));
    writeFileSync(join(subDir, 'presence.yaml'), makeCrdYaml({
      kind: 'PresenceGroup',
      name: 'ws-presence',
      eventBundle: 'presence@1.0.0',
    }));

    const code = await lintCrd([tmpDir]);
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('ChatRoom/test-room');
    expect(out).toContain('PresenceGroup/ws-presence');
  });

  it('returns 0 when directory has no platform CRD YAML files', async () => {
    writeFileSync(join(tmpDir, 'app.yaml'), [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: app',
    ].join('\n'));
    const code = await lintCrd([tmpDir]);
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Usage errors
// ---------------------------------------------------------------------------

describe('usage errors', () => {
  it('exits 2 with no arguments', async () => {
    const code = await lintCrd([]);
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('no path provided');
  });

  it('exits 2 for a non-existent path', async () => {
    const code = await lintCrd(['/no/such/path/at/all']);
    expect(code).toBe(2);
  });

  it('exits 0 for --help flag', async () => {
    const code = await lintCrd(['--help']);
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('ec-lint-crd');
    expect(out).toContain('EXIT CODES');
  });
});

// ---------------------------------------------------------------------------
// CRD without eventBundle field → skipped
// ---------------------------------------------------------------------------

describe('CRD without eventBundle', () => {
  it('skips CRDs with no eventBundle and does not count as error', async () => {
    const f = writeCrd('no-bundle.yaml', [
      'apiVersion: platform.connorhoehn.dev/v1alpha1',
      'kind: ScalingPolicy',
      'metadata:',
      '  name: my-policy',
      'spec:',
      '  maxReplicas: 10',
    ].join('\n') + '\n');
    const code = await lintCrd([f]);
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Summary line
// ---------------------------------------------------------------------------

describe('summary line', () => {
  it('prints a summary after processing', async () => {
    const f = writeCrd('summ.yaml', makeCrdYaml({ eventBundle: 'chat@1.0.0' }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toMatch(/Summary:/);
    expect(out).toContain('1 checked');
  });

  it('shows error count in summary', async () => {
    const f = writeCrd('errs.yaml', makeCrdYaml({ eventBundle: 'bad@1.0.0' }));
    await lintCrd([f]);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toMatch(/1 error/);
  });
});
