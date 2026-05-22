// tests/bundles/file-upload-bundle.test.ts
//
// Validates the file-upload FeatureBundle declaration against the event catalog.
// All ws.upload.* events are pending declaration; only ws.error is optional here.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { fileUploadBundle } from '../../src/declarations/bundles/file-upload.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

describe('fileUploadBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(fileUploadBundle.fingerprint).toBeTruthy();
    expect(fileUploadBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { fileUploadBundle: reloaded } = await import('../../src/declarations/bundles/file-upload.js');
    expect(reloaded.fingerprint).toBe(fileUploadBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    // All ws.upload.* events are optional pending declaration;
    // bundle still validates cleanly with only ws.error (optional).
    const result = validateBundle(fileUploadBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('has no required events that are missing from the catalog', () => {
    const missing = fileUploadBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has a non-empty events list', () => {
    expect(fileUploadBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(fileUploadBundle.description).toBeTruthy();
  });
});
