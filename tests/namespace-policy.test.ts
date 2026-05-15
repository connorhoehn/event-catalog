// tests/namespace-policy.test.ts
//
// Phase 20-h — per-namespace defaults inheritance. Verifies that
// declarations inherit retention / compatibilityMode / dlqRetention /
// dlqAfterAttempts / tags from a namespace policy, and that per-event
// values always win.

import { describe, it, expect, vi } from 'vitest';

const subscriptions = new Map<string, Set<(message: string, channel: string) => void>>();
function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    xAdd: vi.fn(async () => '0-0'),
    xRange: vi.fn(async () => []),
    sMembers: vi.fn(async () => []),
    sAdd: vi.fn(async () => 1),
  };
}
vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

import { EventCatalog } from '../src/client/index.js';

function makeConfig(overrides?: Partial<ConstructorParameters<typeof EventCatalog>[0]>) {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'test-service',
    ...overrides,
  } as ConstructorParameters<typeof EventCatalog>[0];
}

describe('namespace policies (wave20-h)', () => {
  it('applies defaults to fields the declaration omits', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        pipeline: { compatibilityMode: 'full', retention: 2592000, dlqRetention: 7776000 },
      },
    }));
    catalog.declare({
      name: 'pipeline.run.started',
      schema: {},
      transport: 'durable',
      producer: 'distributed-core',
    });
    const entry = catalog.getRegistry().get('pipeline.run.started')!;
    expect(entry.compatibilityMode).toBe('full');
    expect(entry.retention).toBe(2592000);
    expect(entry.dlqRetention).toBe(7776000);
  });

  it('per-event values always win over namespace defaults', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        pipeline: { compatibilityMode: 'full', retention: 2592000 },
      },
    }));
    catalog.declare({
      name: 'pipeline.run.started',
      schema: {},
      transport: 'durable',
      producer: 'distributed-core',
      compatibilityMode: 'backward',
      retention: 86400,
    });
    const entry = catalog.getRegistry().get('pipeline.run.started')!;
    expect(entry.compatibilityMode).toBe('backward');
    expect(entry.retention).toBe(86400);
  });

  it('namespace tags merge with per-event tags (deduplicated)', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        pipeline: { tags: ['domain:pipeline', 'audited'] },
      },
    }));
    catalog.declare({
      name: 'pipeline.run.started',
      schema: {},
      transport: 'durable',
      producer: 'distributed-core',
      tags: ['p1', 'audited'], // overlap on 'audited'
    });
    const entry = catalog.getRegistry().get('pipeline.run.started')!;
    expect(entry.tags?.sort()).toEqual(['audited', 'domain:pipeline', 'p1']);
  });

  it('honors explicit `namespace` field for policy lookup (not just derived)', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        workflow: { retention: 99999 },
      },
    }));
    catalog.declare({
      name: 'pipeline.run.started', // would derive to 'pipeline'
      namespace: 'workflow',         // but explicit overrides
      schema: {},
      transport: 'durable',
      producer: 'distributed-core',
    });
    const entry = catalog.getRegistry().get('pipeline.run.started')!;
    expect(entry.retention).toBe(99999);
  });

  it('declarations in a namespace with no registered policy are unchanged', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        pipeline: { retention: 99999 },
      },
    }));
    catalog.declare({
      name: 'sfu.stream.started',
      schema: {},
      transport: 'durable',
      producer: 'sfu-cluster',
    });
    const entry = catalog.getRegistry().get('sfu.stream.started')!;
    expect(entry.retention).toBeUndefined();
  });

  it('absent policies config is a no-op (no policies, no merge)', () => {
    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'pipeline.run.started',
      schema: {},
      transport: 'durable',
      producer: 'distributed-core',
    });
    const entry = catalog.getRegistry().get('pipeline.run.started')!;
    expect(entry.retention).toBeUndefined();
    expect(entry.dlqRetention).toBeUndefined();
  });

  it('declareAll() applies policy to every event in the bulk', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        pipeline: { compatibilityMode: 'full' },
      },
    }));
    catalog.declareAll([
      { name: 'pipeline.a', schema: {}, transport: 'signal', producer: 'p' },
      { name: 'pipeline.b', schema: {}, transport: 'signal', producer: 'p' },
      { name: 'sfu.x', schema: {}, transport: 'signal', producer: 's' },
    ]);
    expect(catalog.getRegistry().get('pipeline.a')!.compatibilityMode).toBe('full');
    expect(catalog.getRegistry().get('pipeline.b')!.compatibilityMode).toBe('full');
    // sfu has no policy → registry default ('backward')
    expect(catalog.getRegistry().get('sfu.x')!.compatibilityMode).toBe('backward');
  });

  it('getNamespacePolicy() returns the registered policy for inspection', () => {
    const catalog = new EventCatalog(makeConfig({
      namespacePolicies: {
        pipeline: { compatibilityMode: 'full', retention: 12345 },
      },
    }));
    expect(catalog.getNamespacePolicy('pipeline')).toEqual({
      compatibilityMode: 'full',
      retention: 12345,
    });
    expect(catalog.getNamespacePolicy('unknown')).toBeUndefined();
  });
});
