// tests/declaration-evolution.test.ts
//
// Phase E3.1 — additive EventDeclaration field changes:
//   - transport: 'both'
//   - producer: string | string[]
//   - channel, discriminator (signal-only fields)
//   - queue, retention, fifo, partitionKey, dlqAfterAttempts (durable-only)
//   - aliases
//
// All changes are additive. Existing single-string-producer declarations
// must keep working.

import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from '../src/registry/index';
import type { EventDeclaration } from '../src/types/index';

describe('EventDeclaration evolution (Phase E3.1)', () => {
  let registry: Registry;
  beforeEach(() => {
    registry = new Registry();
  });

  it('accepts transport: "both"', () => {
    const decl: EventDeclaration = {
      name: 'pipeline.run.completed',
      schema: {},
      transport: 'both',
      producer: 'pipeline-worker',
    };
    const result = registry.declare(decl);
    expect(result.compatible).toBe(true);
    expect(registry.get('pipeline.run.completed')!.transport).toBe('both');
  });

  it('accepts producer as an array of service names', () => {
    const decl: EventDeclaration = {
      name: 'pipeline.run.completed',
      schema: {},
      transport: 'durable',
      producer: ['distributed-core', 'platform-api'],
    };
    registry.declare(decl);
    const entry = registry.get('pipeline.run.completed')!;
    expect(Array.isArray(entry.producer)).toBe(true);
    expect(entry.producer).toEqual(['distributed-core', 'platform-api']);
  });

  it('filter by producer matches any element of producer-array', () => {
    registry.declare({
      name: 'pipeline.run.completed',
      schema: {},
      transport: 'durable',
      producer: ['distributed-core', 'platform-api'],
    });
    registry.declare({
      name: 'social.post.created',
      schema: {},
      transport: 'durable',
      producer: 'platform-api',
    });
    expect(registry.list({ producer: 'platform-api' }).map((e) => e.name).sort())
      .toEqual(['pipeline.run.completed', 'social.post.created']);
    expect(registry.list({ producer: 'distributed-core' }).map((e) => e.name))
      .toEqual(['pipeline.run.completed']);
  });

  it('topology emits a service node + edge per producer in an array', () => {
    registry.declare({
      name: 'pipeline.run.completed',
      schema: {},
      transport: 'durable',
      producer: ['distributed-core', 'platform-api'],
    });
    const topo = registry.getTopology();
    const services = topo.nodes.filter((n) => n.type === 'service').map((n) => n.id).sort();
    expect(services).toEqual(['distributed-core', 'platform-api']);
    const edges = topo.edges.filter((e) => e.relation === 'publishes').map((e) => e.from).sort();
    expect(edges).toEqual(['distributed-core', 'platform-api']);
  });

  it('accepts signal-only fields (channel, discriminator)', () => {
    registry.declare({
      name: 'ingest:progress',
      schema: {},
      transport: 'signal',
      producer: 'platform-api',
      channel: 'ingest:events',
      discriminator: { field: 'type', values: ['sync.started', 'sync.completed', 'item.failed'] },
    });
    const entry = registry.get('ingest:progress')!;
    expect(entry.channel).toBe('ingest:events');
    expect(entry.discriminator).toEqual({
      field: 'type',
      values: ['sync.started', 'sync.completed', 'item.failed'],
    });
  });

  it('accepts durable-only fields (queue, retention, fifo, partitionKey, dlqAfterAttempts)', () => {
    const partitionFn = (p: unknown) => (p as { roomId: string }).roomId;
    registry.declare({
      name: 'social.post.created',
      schema: {},
      transport: 'durable',
      producer: 'platform-api',
      queue: 'social-posts',
      retention: 7 * 24 * 60 * 60,
      fifo: true,
      partitionKey: partitionFn,
      dlqAfterAttempts: 3,
    });
    const entry = registry.get('social.post.created')!;
    expect(entry.queue).toBe('social-posts');
    expect(entry.retention).toBe(7 * 24 * 60 * 60);
    expect(entry.fifo).toBe(true);
    expect(entry.partitionKey).toBe(partitionFn);
    expect(entry.dlqAfterAttempts).toBe(3);
  });

  it('accepts aliases declaration', () => {
    registry.declare({
      name: 'pipeline.run.completed',
      schema: {},
      transport: 'both',
      producer: 'pipeline-worker',
      aliases: [{ name: 'pipeline:run:completed', deprecated: true, until: '2027-01-01' }],
    });
    const entry = registry.get('pipeline.run.completed')!;
    expect(entry.aliases).toEqual([
      { name: 'pipeline:run:completed', deprecated: true, until: '2027-01-01' },
    ]);
  });

  it('preserves backwards compatibility with v0.1.0 single-producer string', () => {
    registry.declare({
      name: 'social:post',
      schema: {},
      transport: 'signal',
      producer: 'platform-api',
    });
    const entry = registry.get('social:post')!;
    expect(entry.producer).toBe('platform-api');
    expect(typeof entry.producer).toBe('string');
  });
});
