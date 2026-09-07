// tests/bundles/new-coverage-bundles.test.ts
//
// The six bundles added by the 2026-09-07 bundle-layer audit to close the
// coverage gap left by the gateway-durable / sfu.* / call-caption sweeps:
//
//   ag-ui-stream        29  signal   AG-UI agent protocol
//   sfu-webhooks        12  durable  SFU → platform-api webhook contract
//   sfu-control-plane   12  signal   `stream-events` hub + compose jobs
//   sfu-chat             5  signal   `chat-bus:<arn>`
//   call-captions        4  both     live captions + transcription queue
//   notifications        4  signal   NotificationCenter frames
//
// Each is asserted against the REAL registry, not a fixture, so a rename in
// a declaration file breaks the bundle here rather than in an operator's CI.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { allDeclarations } from '../../src/declarations/index.js';
import {
  validateBundle,
  getFeatureBundle,
  computeFingerprint,
  type FeatureBundle,
} from '../../src/bundles/FeatureBundle.js';
import {
  agUiStreamBundle,
  sfuWebhooksBundle,
  sfuControlPlaneBundle,
  sfuChatBundle,
  callCaptionsBundle,
  notificationsBundle,
} from '../../src/declarations/bundles/index.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of allDeclarations) registry.declare(decl);
});

const NEW_BUNDLES: Array<[string, FeatureBundle, number, string]> = [
  ['ag-ui-stream', agUiStreamBundle, 29, 'signal'],
  ['sfu-webhooks', sfuWebhooksBundle, 12, 'durable'],
  ['sfu-control-plane', sfuControlPlaneBundle, 12, 'signal'],
  ['sfu-chat', sfuChatBundle, 5, 'signal'],
  ['call-captions', callCaptionsBundle, 4, 'both'],
  ['notifications', notificationsBundle, 4, 'signal'],
];

describe.each(NEW_BUNDLES)('%s bundle', (name, bundle, memberCount, transport) => {
  it('is registered in the module-level singleton at v1.0.0', () => {
    const found = getFeatureBundle(name, '1.0.0');
    expect(found).toBeDefined();
    expect(found!.fingerprint).toBe(bundle.fingerprint);
  });

  it(`declares ${memberCount} members with transport "${transport}"`, () => {
    expect(bundle.events).toHaveLength(memberCount);
    expect(bundle.transport).toBe(transport);
  });

  it('has a stamped 64-char fingerprint over its own member set', () => {
    expect(bundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.fingerprint).toBe(computeFingerprint(bundle));
  });

  it('validates against the real catalog', () => {
    expect(validateBundle(bundle, registry).errors).toEqual([]);
  });

  it('has at least one required member', () => {
    expect(bundle.events.some((e) => e.required !== false)).toBe(true);
  });

  it('has a description and is not born deprecated', () => {
    expect(bundle.description).toBeTruthy();
    expect(bundle.deprecated).toBeUndefined();
  });

  it('lists each member exactly once', () => {
    const names = bundle.events.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Namespace boundaries — the reason these are separate bundles
// ---------------------------------------------------------------------------

describe('sfu bundle boundaries', () => {
  it('the three sfu bundles partition the sfu.* namespace exactly', () => {
    const declared = allDeclarations
      .map((d) => d.name)
      .filter((n) => n.startsWith('sfu.'))
      .sort();
    const bundled = [
      ...sfuWebhooksBundle.events,
      ...sfuControlPlaneBundle.events,
      ...sfuChatBundle.events,
    ]
      .map((e) => e.name)
      .sort();

    expect(bundled).toEqual(declared);
    expect(declared).toHaveLength(29);
  });

  it('sfu-webhooks holds only durable events', () => {
    for (const ref of sfuWebhooksBundle.events) {
      expect(registry.get(ref.name)!.transport).toBe('durable');
    }
  });

  it('the two signal sfu bundles hold only signal events', () => {
    for (const ref of [...sfuControlPlaneBundle.events, ...sfuChatBundle.events]) {
      expect(registry.get(ref.name)!.transport).toBe('signal');
    }
  });

  it('sfu-chat does not overlap the gateway `chat` bundle', () => {
    // Different protocols with the same word in the name — a real trap.
    const chat = getFeatureBundle('chat', '1.0.0')!;
    const overlap = sfuChatBundle.events
      .map((e) => e.name)
      .filter((n) => chat.events.some((e) => e.name === n));
    expect(overlap).toEqual([]);
  });
});

describe('call-captions spans both buses', () => {
  it('holds the signal caption stream and the durable transcription queue', () => {
    const transports = callCaptionsBundle.events.map(
      (e) => registry.get(e.name)!.transport,
    );
    expect(transports).toContain('signal');
    expect(transports).toContain('durable');
  });

  it('covers every declared transcription:* event', () => {
    const declared = allDeclarations
      .map((d) => d.name)
      .filter((n) => n.startsWith('transcription:'))
      .sort();
    const bundled = callCaptionsBundle.events
      .map((e) => e.name)
      .filter((n) => n.startsWith('transcription:'))
      .sort();
    expect(bundled).toEqual(declared);
  });
});

describe('ag-ui-stream covers the whole protocol', () => {
  it('holds every declared ag-ui.* event', () => {
    const declared = allDeclarations
      .map((d) => d.name)
      .filter((n) => n.startsWith('ag-ui.'))
      .sort();
    expect(agUiStreamBundle.events.map((e) => e.name).sort()).toEqual(declared);
  });

  it('marks the reasoning and extension families optional', () => {
    const optional = new Set(
      agUiStreamBundle.events.filter((e) => e.required === false).map((e) => e.name),
    );
    expect(optional).toContain('ag-ui.REASONING_START');
    expect(optional).toContain('ag-ui.RAW');
    expect(optional).toContain('ag-ui.CUSTOM');
    expect(optional).toContain('ag-ui.META_EVENT');
  });

  it('marks the run/step/text/tool-call core required', () => {
    const required = new Set(
      agUiStreamBundle.events.filter((e) => e.required !== false).map((e) => e.name),
    );
    for (const n of [
      'ag-ui.RUN_STARTED',
      'ag-ui.RUN_FINISHED',
      'ag-ui.RUN_ERROR',
      'ag-ui.TEXT_MESSAGE_START',
      'ag-ui.TOOL_CALL_START',
      'ag-ui.STATE_SNAPSHOT',
    ]) {
      expect(required).toContain(n);
    }
  });
});
