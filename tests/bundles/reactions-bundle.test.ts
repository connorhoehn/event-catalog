// tests/bundles/reactions-bundle.test.ts
//
// Validates the reactions FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { reactionsBundle } from '../../src/declarations/bundles/reactions.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

describe('reactionsBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(reactionsBundle.fingerprint).toBeTruthy();
    expect(reactionsBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { reactionsBundle: reloaded } = await import('../../src/declarations/bundles/reactions.js');
    expect(reloaded.fingerprint).toBe(reactionsBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(reactionsBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = reactionsBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(reactionsBundle.transport).toBe('signal');
  });

  it('has a non-empty events list', () => {
    expect(reactionsBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(reactionsBundle.description).toBeTruthy();
  });
});
