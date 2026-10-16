// tests/bundles/meeting-bundle.test.ts
//
// Validates the meeting FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { clientFrameOutboundDeclarations } from '../../src/declarations/client-frames.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { meetingBundle, meetingHistoryBundle } from '../../src/declarations/bundles/meeting.js';
import { allBundles } from '../../src/declarations/bundles/index.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of [...gatewaySignalDeclarations, ...clientFrameOutboundDeclarations]) registry.declare(decl);
});

describe('meetingBundle declaration', () => {
  it('is named meeting@1.0.0 with a sha256 fingerprint', () => {
    expect(meetingBundle.name).toBe('meeting');
    expect(meetingBundle.version).toBe('1.0.0');
    expect(meetingBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is registered in the bundle index', () => {
    expect(allBundles).toContain(meetingBundle);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(meetingBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('names every declared meeting frame, in both directions', () => {
    const declared = [...gatewaySignalDeclarations, ...clientFrameOutboundDeclarations]
      .map((d) => d.name)
      .filter((n) => n.startsWith('ws.meeting.') || n.startsWith('client.meeting.'))
      .sort();
    expect(meetingBundle.events.map((e) => e.name).sort()).toEqual(declared);
  });

  it('has transport set to "signal"', () => {
    expect(meetingBundle.transport).toBe('signal');
  });
});

describe('meetingHistoryBundle declaration (meeting@1.1.0)', () => {
  it('keeps meeting@1.0.0 at its released fingerprint for pinned consumers', () => {
    // Released in 0.8.6 (66f8c92b). Never change this value.
    expect(meetingBundle.fingerprint).toBe('4db73a1750867fdca00bcac070e2f40a8f9a1c4803f31578dd0fe3d10ebf0593');
  });

  it('is meeting@1.1.0 with its own fingerprint and the same frames', () => {
    expect(meetingHistoryBundle.name).toBe('meeting');
    expect(meetingHistoryBundle.version).toBe('1.1.0');
    expect(meetingHistoryBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(meetingHistoryBundle.fingerprint).not.toBe(meetingBundle.fingerprint);
    expect(meetingHistoryBundle.events).toEqual(meetingBundle.events);
    expect(meetingHistoryBundle.transport).toBe('signal');
  });

  it('is registered and validates against the real event catalog', () => {
    expect(allBundles).toContain(meetingHistoryBundle);
    const result = validateBundle(meetingHistoryBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
