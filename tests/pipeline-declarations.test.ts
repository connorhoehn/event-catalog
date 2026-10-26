import { queueResponse } from './helpers/queue-http';
// tests/pipeline-declarations.test.ts
//
// Wave 1 / track EC-1 — coverage for the P0 pipeline declarations:
//   - pipeline.approval.requested (transport: 'both')
//   - pipeline.approval.recorded  (transport: 'both')
//   - pipeline.run.checkpoint     (transport: 'signal')
//
// Verifies:
//   (a) each declaration registers under its canonical name with the
//       expected transport + producer set,
//   (b) `catalog.publish()` accepts a conforming payload,
//   (c) `catalog.publish()` rejects a non-conforming payload (missing
//       required field, wrong enum value, wrong type).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Re-use the in-memory Redis pub/sub simulator pattern from
// `publish-evolution.test.ts` so we can drive `catalog.publish()`
// end-to-end without a real Redis or message-queue.
const subscriptions = new Map<string, Set<(message: string, channel: string) => void>>();

function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      const handlers = subscriptions.get(channel);
      if (handlers) {
        for (const handler of handlers) handler(message, channel);
      }
      return handlers?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: (message: string, channel: string) => void) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async (channel: string) => { subscriptions.delete(channel); }),
    xAdd: vi.fn(async () => '0-0'),
    xRange: vi.fn(async () => []),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EventCatalog } from '../src/client/index';
import { Registry } from '../src/registry/index';
import {
  pipelineApprovalRequested,
  pipelineApprovalRecorded,
  pipelineRunCheckpoint,
  pipelineDeclarations,
} from '../src/declarations/index';

function makeConfig() {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'test-service',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptions.clear();
  // Default: healthy fetch (durable-transport queue exists + send 200).
  fetchMock.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (urlStr.includes('/ready')) return queueResponse(200, { status: 'ready' });
    if (opts?.method === 'PUT') return queueResponse(201, { status: 'created' });
    if (opts?.method === 'POST') return queueResponse(200, { message_id: 'm-1' });
    if (opts?.method === 'GET') return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    return new Response('', { status: 200 });
  });
});

describe('pipeline declarations — exports (wave1-ec-1)', () => {
  it('exports the P0 pipeline declarations from the aggregate', () => {
    // 4 entries: requested, recorded, resolved, run.checkpoint
    expect(pipelineDeclarations).toHaveLength(4);
    expect(pipelineDeclarations.map((d) => d.name).sort()).toEqual([
      'pipeline.approval.recorded',
      'pipeline.approval.requested',
      'pipeline.approval.resolved',
      'pipeline.run.checkpoint',
    ]);
  });

  it('pipeline.approval.requested has transport=both + dual producers + alias', () => {
    expect(pipelineApprovalRequested.transport).toBe('both');
    expect(pipelineApprovalRequested.producer).toEqual([
      'distributed-core',
      'platform-api',
    ]);
    expect(pipelineApprovalRequested.aliases).toEqual([
      { name: 'pipeline:approval:requested', deprecated: true },
    ]);
  });

  it('pipeline.approval.recorded has transport=both + dual producers + alias', () => {
    expect(pipelineApprovalRecorded.transport).toBe('both');
    expect(pipelineApprovalRecorded.producer).toEqual([
      'distributed-core',
      'platform-api',
    ]);
    expect(pipelineApprovalRecorded.aliases).toEqual([
      { name: 'pipeline:approval:recorded', deprecated: true },
    ]);
  });

  it('pipeline.run.checkpoint is signal-only with sole distributed-core producer', () => {
    expect(pipelineRunCheckpoint.transport).toBe('signal');
    expect(pipelineRunCheckpoint.producer).toBe('distributed-core');
    expect(pipelineRunCheckpoint.aliases).toEqual([
      { name: 'pipeline:run:checkpoint', deprecated: true },
    ]);
  });
});

describe('pipeline declarations — registry.declare() (wave1-ec-1)', () => {
  it('all declarations register cleanly via the Registry', () => {
    const registry = new Registry();
    for (const decl of pipelineDeclarations) {
      const result = registry.declare(decl);
      expect(result.compatible).toBe(true);
    }
    expect(registry.size()).toBe(4);

    const approvalReq = registry.get('pipeline.approval.requested')!;
    expect(approvalReq.transport).toBe('both');
    expect(approvalReq.tags).toContain('p0');

    const approvalRec = registry.get('pipeline.approval.recorded')!;
    expect(approvalRec.transport).toBe('both');

    const checkpoint = registry.get('pipeline.run.checkpoint')!;
    expect(checkpoint.transport).toBe('signal');
  });

  it('topology surfaces the union of producers across the three events', () => {
    const registry = new Registry();
    for (const decl of pipelineDeclarations) registry.declare(decl);
    const topo = registry.getTopology();
    const services = topo.nodes
      .filter((n) => n.type === 'service')
      .map((n) => n.id)
      .sort();
    expect(services).toEqual(['distributed-core', 'platform-api']);
  });
});

describe('pipeline declarations — catalog.publish() validation (wave1-ec-1)', () => {
  it('accepts a conforming pipeline.approval.requested payload', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineApprovalRequested);
    await expect(
      catalog.publish('pipeline.approval.requested', {
        runId: 'r-1',
        stepId: 's-approval-1',
        approverIds: ['user-a', 'user-b'],
        requestedAt: 1_700_000_000_000,
      }),
    ).resolves.toBeUndefined();
    await catalog.disconnect();
  });

  it('rejects pipeline.approval.requested when runId is missing', async () => {
    // Was: "rejects when approverIds is missing". Nothing emits `approverIds`
    // — PipelineExecutor sends `approvers` — so requiring it meant this
    // event could never be published on either transport.
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineApprovalRequested);
    await expect(
      catalog.publish('pipeline.approval.requested', {
        stepId: 's-approval-1',
        approvers: [{ type: 'role', value: 'reviewer' }],
        at: '2026-09-07T10:00:00.000Z',
      } as unknown as Record<string, unknown>),
    ).rejects.toThrow(/payload validation failed/);
    await catalog.disconnect();
  });

  it('rejects pipeline.approval.requested when approverIds is empty', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineApprovalRequested);
    await expect(
      catalog.publish('pipeline.approval.requested', {
        runId: 'r-1',
        stepId: 's-approval-1',
        approverIds: [],
        requestedAt: 1_700_000_000_000,
      }),
    ).rejects.toThrow(/payload validation failed/);
    await catalog.disconnect();
  });

  it('accepts a conforming pipeline.approval.recorded payload (with optional comment)', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineApprovalRecorded);
    await expect(
      catalog.publish('pipeline.approval.recorded', {
        runId: 'r-1',
        stepId: 's-approval-1',
        approver: 'user-a',
        decision: 'approve',
        comment: 'looks good',
        decidedAt: 1_700_000_000_500,
      }),
    ).resolves.toBeUndefined();
    await catalog.disconnect();
  });

  it('accepts pipeline.approval.recorded without the optional comment', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineApprovalRecorded);
    await expect(
      catalog.publish('pipeline.approval.recorded', {
        runId: 'r-1',
        stepId: 's-approval-1',
        approver: 'user-b',
        decision: 'reject',
        decidedAt: 1_700_000_000_750,
      }),
    ).resolves.toBeUndefined();
    await catalog.disconnect();
  });

  it('rejects pipeline.approval.recorded when decision is not in the enum', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineApprovalRecorded);
    await expect(
      catalog.publish('pipeline.approval.recorded', {
        runId: 'r-1',
        stepId: 's-approval-1',
        approver: 'user-a',
        decision: 'maybe', // invalid — not in ['approve','reject']
        decidedAt: 1_700_000_000_500,
      } as unknown as Record<string, unknown>),
    ).rejects.toThrow(/payload validation failed/);
    await catalog.disconnect();
  });

  it('accepts a conforming pipeline.run.checkpoint payload (signal-only)', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineRunCheckpoint);
    await expect(
      catalog.publish('pipeline.run.checkpoint', {
        runId: 'r-1',
        context: { foo: 'bar', counter: 42 },
        currentStepIds: ['s-3', 's-4'],
        sequenceNumber: 2,
        at: '2026-05-14T12:00:00.000Z',
      }),
    ).resolves.toBeUndefined();

    // Sanity: no durable POST happened (signal-only).
    const durableSends = fetchMock.mock.calls.filter(([url, opts]) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      return u.includes('/queues/') && u.includes('/messages') && (opts as RequestInit | undefined)?.method === 'POST';
    });
    expect(durableSends).toHaveLength(0);

    await catalog.disconnect();
  });

  it('rejects pipeline.run.checkpoint when sequenceNumber is the wrong type', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare(pipelineRunCheckpoint);
    await expect(
      catalog.publish('pipeline.run.checkpoint', {
        runId: 'r-1',
        context: {},
        currentStepIds: [],
        sequenceNumber: 'two', // invalid — should be number
        at: '2026-05-14T12:00:00.000Z',
      } as unknown as Record<string, unknown>),
    ).rejects.toThrow(/payload validation failed/);
    await catalog.disconnect();
  });
});
