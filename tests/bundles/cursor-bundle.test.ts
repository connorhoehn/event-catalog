// tests/bundles/cursor-bundle.test.ts
//
// Validates the cursor FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { cursorBundle } from '../../src/declarations/bundles/cursor.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

describe('cursorBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(cursorBundle.fingerprint).toBeTruthy();
    expect(cursorBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { cursorBundle: reloaded } = await import('../../src/declarations/bundles/cursor.js');
    expect(reloaded.fingerprint).toBe(cursorBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(cursorBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = cursorBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(cursorBundle.transport).toBe('signal');
  });

  it('has a non-empty events list', () => {
    expect(cursorBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(cursorBundle.description).toBeTruthy();
  });
});
