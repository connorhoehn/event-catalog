// tests/bundles/crdt-document-bundle.test.ts
//
// Validates the crdt-document FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { crdtDocumentBundle } from '../../src/declarations/bundles/crdt-document.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

describe('crdtDocumentBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(crdtDocumentBundle.fingerprint).toBeTruthy();
    expect(crdtDocumentBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { crdtDocumentBundle: reloaded } = await import('../../src/declarations/bundles/crdt-document.js');
    expect(reloaded.fingerprint).toBe(crdtDocumentBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(crdtDocumentBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = crdtDocumentBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(crdtDocumentBundle.transport).toBe('signal');
  });

  it('has a non-empty events list', () => {
    expect(crdtDocumentBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(crdtDocumentBundle.description).toBeTruthy();
  });
});
