// tests/bundles/agentic-pipeline-bundles.test.ts
//
// Validates both agentic-pipeline-signal and agentic-pipeline-durable
// FeatureBundle declarations, and confirms the old agentic-pipeline@1.0.0
// bundle is properly deprecated.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { pipelineP1Declarations } from '../../src/declarations/pipeline-p1.js';
import { pipelineP2Declarations } from '../../src/declarations/pipeline-p2.js';
import { pipelineDeclarations } from '../../src/declarations/pipeline.js';
import { validateBundle, getFeatureBundle } from '../../src/bundles/FeatureBundle.js';
import { agenticPipelineSignalBundle } from '../../src/declarations/bundles/agentic-pipeline-signal.js';
import { agenticPipelineDurableBundle } from '../../src/declarations/bundles/agentic-pipeline-durable.js';
import { agenticPipelineBundle } from '../../src/declarations/bundles/agentic-pipeline.js';

// Register all bundles so the module-level singleton is populated.
import '../../src/declarations/bundles/index.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  // Register pipeline-p1, pipeline-p2, and pipeline.ts approval declarations.
  for (const decl of pipelineP1Declarations) {
    registry.declare(decl);
  }
  for (const decl of pipelineP2Declarations) {
    registry.declare(decl);
  }
  for (const decl of pipelineDeclarations) {
    registry.declare(decl);
  }
});

// ---------------------------------------------------------------------------
// agentic-pipeline-signal bundle
// ---------------------------------------------------------------------------

describe('agenticPipelineSignalBundle', () => {
  it('has a non-empty 64-char hex fingerprint', () => {
    expect(agenticPipelineSignalBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { agenticPipelineSignalBundle: reloaded } = await import(
      '../../src/declarations/bundles/agentic-pipeline-signal.js'
    );
    expect(reloaded.fingerprint).toBe(agenticPipelineSignalBundle.fingerprint);
  });

  it('has transport: signal', () => {
    expect(agenticPipelineSignalBundle.transport).toBe('signal');
  });

  it('does NOT include any approval events', () => {
    const approvalEvents = agenticPipelineSignalBundle.events.filter((e) =>
      e.name.includes('approval'),
    );
    expect(approvalEvents).toHaveLength(0);
  });

  it('includes all required WS lifecycle events', () => {
    const required = agenticPipelineSignalBundle.events.filter((e) => e.required !== false);
    expect(required.length).toBeGreaterThan(0);
    const names = required.map((e) => e.name);
    expect(names).toContain('pipeline:run:started');
    expect(names).toContain('pipeline:run:completed');
    expect(names).toContain('pipeline:run:failed');
    expect(names).toContain('pipeline:run:cancelled');
    expect(names).toContain('pipeline:step:started');
    expect(names).toContain('pipeline:step:completed');
    expect(names).toContain('pipeline:step:failed');
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(agenticPipelineSignalBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are resolvable in the catalog', () => {
    const missing = agenticPipelineSignalBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('is registered in the module-level bundle registry', () => {
    const found = getFeatureBundle('agentic-pipeline-signal', '1.0.0');
    expect(found).toBeDefined();
    expect(found!.fingerprint).toBe(agenticPipelineSignalBundle.fingerprint);
  });

  it('is not deprecated', () => {
    expect(agenticPipelineSignalBundle.deprecated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// agentic-pipeline-durable bundle
// ---------------------------------------------------------------------------

describe('agenticPipelineDurableBundle', () => {
  it('has a non-empty 64-char hex fingerprint', () => {
    expect(agenticPipelineDurableBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { agenticPipelineDurableBundle: reloaded } = await import(
      '../../src/declarations/bundles/agentic-pipeline-durable.js'
    );
    expect(reloaded.fingerprint).toBe(agenticPipelineDurableBundle.fingerprint);
  });

  it('has transport: durable', () => {
    expect(agenticPipelineDurableBundle.transport).toBe('durable');
  });

  it('includes all three approval events as required', () => {
    const names = agenticPipelineDurableBundle.events.map((e) => e.name);
    expect(names).toContain('pipeline.approval.requested');
    expect(names).toContain('pipeline.approval.recorded');
    expect(names).toContain('pipeline.approval.resolved');
    const required = agenticPipelineDurableBundle.events.filter((e) => e.required !== false);
    expect(required).toHaveLength(3);
  });

  it('does NOT include any signal-only run/step lifecycle events', () => {
    const signalEvents = agenticPipelineDurableBundle.events.filter(
      (e) => e.name.startsWith('pipeline:run:') || e.name.startsWith('pipeline:step:'),
    );
    expect(signalEvents).toHaveLength(0);
  });

  it('all required events are resolvable in the catalog', () => {
    const missing = agenticPipelineDurableBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('is registered in the module-level bundle registry', () => {
    const found = getFeatureBundle('agentic-pipeline-durable', '1.0.0');
    expect(found).toBeDefined();
    expect(found!.fingerprint).toBe(agenticPipelineDurableBundle.fingerprint);
  });

  it('is not deprecated', () => {
    expect(agenticPipelineDurableBundle.deprecated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fingerprint independence — the two new bundles hash differently
// ---------------------------------------------------------------------------

describe('bundle fingerprint uniqueness', () => {
  it('signal and durable bundles have different fingerprints', () => {
    expect(agenticPipelineSignalBundle.fingerprint).not.toBe(
      agenticPipelineDurableBundle.fingerprint,
    );
  });

  it('neither new bundle shares a fingerprint with the deprecated bundle', () => {
    expect(agenticPipelineSignalBundle.fingerprint).not.toBe(agenticPipelineBundle.fingerprint);
    expect(agenticPipelineDurableBundle.fingerprint).not.toBe(agenticPipelineBundle.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// Deprecated legacy bundle — agentic-pipeline@1.0.0
// ---------------------------------------------------------------------------

describe('agenticPipelineBundle (deprecated)', () => {
  it('is marked deprecated', () => {
    expect(agenticPipelineBundle.deprecated).toBeDefined();
    expect(agenticPipelineBundle.deprecated!.since).toBe('v0.3.45');
    expect(agenticPipelineBundle.deprecated!.replacement).toBe('agentic-pipeline-signal@1.0.0');
  });

  it('still has a stable fingerprint (fingerprint excludes deprecated field)', () => {
    expect(agenticPipelineBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is still registered in the module-level bundle registry', () => {
    const found = getFeatureBundle('agentic-pipeline', '1.0.0');
    expect(found).toBeDefined();
    expect(found!.deprecated).toBeDefined();
  });

  it('still validates successfully (backward compat preserved)', () => {
    const result = validateBundle(agenticPipelineBundle, registry);
    expect(result.valid).toBe(true);
  });
});
