// tests/bundles/activity-bundle.test.ts
//
// Validates the activity FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { activityBundle } from '../../src/declarations/bundles/activity.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

describe('activityBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(activityBundle.fingerprint).toBeTruthy();
    expect(activityBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { activityBundle: reloaded } = await import('../../src/declarations/bundles/activity.js');
    expect(reloaded.fingerprint).toBe(activityBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(activityBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = activityBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(activityBundle.transport).toBe('signal');
  });

  it('has a non-empty events list', () => {
    expect(activityBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(activityBundle.description).toBeTruthy();
  });
});
