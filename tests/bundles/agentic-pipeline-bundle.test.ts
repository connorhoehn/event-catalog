// tests/bundles/agentic-pipeline-bundle.test.ts
//
// Validates the agentic-pipeline FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { pipelineP1Declarations } from '../../src/declarations/pipeline-p1.js';
import { pipelineP2Declarations } from '../../src/declarations/pipeline-p2.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { agenticPipelineBundle } from '../../src/declarations/bundles/agentic-pipeline.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of pipelineP1Declarations) {
    registry.declare(decl);
  }
  for (const decl of pipelineP2Declarations) {
    registry.declare(decl);
  }
});

describe('agenticPipelineBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(agenticPipelineBundle.fingerprint).toBeTruthy();
    expect(agenticPipelineBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { agenticPipelineBundle: reloaded } = await import('../../src/declarations/bundles/agentic-pipeline.js');
    expect(reloaded.fingerprint).toBe(agenticPipelineBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(agenticPipelineBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = agenticPipelineBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(agenticPipelineBundle.transport).toBe('signal');
  });

  it('has a non-empty events list', () => {
    expect(agenticPipelineBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(agenticPipelineBundle.description).toBeTruthy();
  });
});
