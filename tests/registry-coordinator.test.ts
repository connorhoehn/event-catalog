import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { RegistryCoordinator, MUTATIONS_CHANNEL } from '../src/server/registry-coordinator.js';

// ---------- In-memory Redis pub/sub simulator ----------
type Handler = (msg: string) => void;
const subscriptions = new Map<string, Set<Handler>>();
const publishLog: Array<{ channel: string; message: string }> = [];

function createMockClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      publishLog.push({ channel, message });
      const handlers = subscriptions.get(channel);
      if (handlers) {
        const snapshot = [...handlers]; // avoid mutating-while-iterating
        for (const h of snapshot) h(message);
      }
      return handlers?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: Handler) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async () => {}),
  };
}

vi.mock('redis', () => ({
  createClient: vi.fn(() => createMockClient()),
}));

/** Deliver a message directly to all channel subscribers. */
function deliver(channel: string, message: string) {
  const handlers = subscriptions.get(channel);
  if (!handlers) return;
  const snapshot = [...handlers];
  for (const h of snapshot) h(message);
}

async function makeCoordinator(registry: Registry) {
  const coord = new RegistryCoordinator();
  await coord.start('redis://localhost:6379', registry);
  return coord;
}

describe('RegistryCoordinator', () => {
  beforeEach(() => {
    subscriptions.clear();
    publishLog.length = 0;
    vi.clearAllMocks();
  });

  it('starts and subscribes to the mutations channel', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    expect(subscriptions.has(MUTATIONS_CHANNEL)).toBe(true);
    expect(coord.started).toBe(true);

    await coord.stop();
    expect(coord.started).toBe(false);
  });

  it('broadcast publishes a correctly-shaped message to the channel', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    await coord.broadcast('declare', { name: 'test.event' });

    expect(publishLog).toHaveLength(1);
    const msg = JSON.parse(publishLog[0].message) as { replicaId: string; kind: string; payload: { name: string } };
    expect(publishLog[0].channel).toBe(MUTATIONS_CHANNEL);
    expect(msg.kind).toBe('declare');
    expect(msg.payload.name).toBe('test.event');
    expect(msg.replicaId).toBe(coord.replicaId);

    await coord.stop();
  });

  it('ignores its own broadcasts (replicaId filter prevents self-application)', async () => {
    const registry = new Registry();
    registry.declare({ name: 'existing.event', schema: {}, transport: 'signal', producer: 's' });

    const coord = await makeCoordinator(registry);
    const declareSpy = vi.spyOn(registry, 'declare');

    // Broadcast — own message must be filtered out, so declare is NOT re-called.
    await coord.broadcast('declare', { name: 'existing.event', schema: {}, transport: 'signal', producer: 's' });

    expect(declareSpy).not.toHaveBeenCalled();

    await coord.stop();
  });

  it('applies a remote declare mutation to the local registry', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'declare',
      payload: { name: 'remote.event', schema: { type: 'object' }, transport: 'signal', producer: 'svc' },
    }));

    expect(registry.get('remote.event')).toBeDefined();
    expect(registry.get('remote.event')!.transport).toBe('signal');

    await coord.stop();
  });

  it('applies a remote deprecate mutation', async () => {
    const registry = new Registry();
    registry.declare({ name: 'dep.event', schema: {}, transport: 'signal', producer: 's' });

    const coord = await makeCoordinator(registry);

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'deprecate',
      payload: { name: 'dep.event', opts: { reason: 'sunset', by: 'ops' } },
    }));

    const entry = registry.get('dep.event')!;
    expect(entry.deprecation?.reason).toBe('sunset');
    expect(entry.deprecation?.by).toBe('ops');

    await coord.stop();
  });

  it('applies a remote undeprecate mutation', async () => {
    const registry = new Registry();
    registry.declare({ name: 'dep.event', schema: {}, transport: 'signal', producer: 's' });
    registry.deprecate('dep.event', { reason: 'old' });
    expect(registry.get('dep.event')?.deprecation).toBeDefined();

    const coord = await makeCoordinator(registry);

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'undeprecate',
      payload: { name: 'dep.event' },
    }));

    expect(registry.get('dep.event')?.deprecation).toBeUndefined();

    await coord.stop();
  });

  it('applies remote subscriber.add and subscriber.remove mutations', async () => {
    const registry = new Registry();
    registry.declare({ name: 'sub.event', schema: {}, transport: 'signal', producer: 's' });

    const coord = await makeCoordinator(registry);

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'subscriber.add',
      payload: { eventName: 'sub.event', serviceName: 'consumer-a' },
    }));
    expect(registry.get('sub.event')!.subscribers).toContain('consumer-a');

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'subscriber.remove',
      payload: { eventName: 'sub.event', serviceName: 'consumer-a' },
    }));
    expect(registry.get('sub.event')!.subscribers).not.toContain('consumer-a');

    await coord.stop();
  });

  it('applies a remote remove mutation', async () => {
    const registry = new Registry();
    registry.declare({ name: 'gone.event', schema: {}, transport: 'signal', producer: 's' });

    const coord = await makeCoordinator(registry);

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'remove',
      payload: { name: 'gone.event' },
    }));

    expect(registry.get('gone.event')).toBeUndefined();

    await coord.stop();
  });

  it('registers on("error") handlers on both Redis clients — suppresses unhandled rejections', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    const pub = (coord as any).pubClient as ReturnType<typeof createMockClient>;
    const sub = (coord as any).subClient as ReturnType<typeof createMockClient>;

    const pubErrorArgs = pub.on.mock.calls.find(([event]: [string]) => event === 'error');
    const subErrorArgs = sub.on.mock.calls.find(([event]: [string]) => event === 'error');

    expect(pubErrorArgs).toBeDefined();
    expect(subErrorArgs).toBeDefined();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeErr = new Error('ECONNREFUSED');

    expect(() => (pubErrorArgs![1] as (e: Error) => void)(fakeErr)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pub client error'),
      'ECONNREFUSED',
    );

    expect(() => (subErrorArgs![1] as (e: Error) => void)(fakeErr)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sub client error'),
      'ECONNREFUSED',
    );

    warnSpy.mockRestore();
    await coord.stop();
  });

  it('broadcast is a no-op when not started', async () => {
    const coord = new RegistryCoordinator();
    await expect(coord.broadcast('declare', {})).resolves.toBeUndefined();
    expect(publishLog).toHaveLength(0);
  });

  it('stop() calls quit() on both pub and sub Redis clients', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    // Capture references before stop nulls them out.
    const pub = (coord as any).pubClient as ReturnType<typeof createMockClient>;
    const sub = (coord as any).subClient as ReturnType<typeof createMockClient>;

    await coord.stop();

    expect(pub.quit).toHaveBeenCalledOnce();
    expect(sub.quit).toHaveBeenCalledOnce();
    expect(coord.started).toBe(false);
  });

  it('broadcast() is a no-op after stop() (pubClient is null)', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    await coord.stop();

    await expect(coord.broadcast('declare', { name: 'x' })).resolves.toBeUndefined();
    expect(publishLog).toHaveLength(0);
  });

  it('stop() on a never-started coordinator resolves safely', async () => {
    const coord = new RegistryCoordinator();
    await expect(coord.stop()).resolves.toBeUndefined();
    expect(coord.started).toBe(false);
  });

  it('broadcast swallows publish errors and logs a warning', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Inject a failing publish on the internal pub client
    const pubClient = (coord as any).pubClient as ReturnType<typeof createMockClient>;
    pubClient.publish.mockRejectedValueOnce(new Error('connection lost'));

    await expect(coord.broadcast('declare', { name: 'x' })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('broadcast failed'),
      'connection lost',
    );

    warnSpy.mockRestore();
    await coord.stop();
  });

  it('start() is idempotent — second call is a no-op', async () => {
    const registry = new Registry();
    const coord = new RegistryCoordinator();
    await coord.start('redis://localhost:6379', registry);
    await coord.start('redis://localhost:6379', registry); // second call: _started is true → early return

    // Only one subscription handler should be registered for the channel
    const handlers = subscriptions.get(MUTATIONS_CHANNEL);
    expect(handlers?.size).toBe(1);

    await coord.stop();
  });

  it('handles malformed JSON in incoming mutation without crashing', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    expect(() => deliver(MUTATIONS_CHANNEL, 'not-valid-json{')).not.toThrow();

    await coord.stop();
  });

  it('does not apply unknown mutation kinds (logs warning, no crash)', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'unknown-future-kind',
      payload: {},
    }));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown mutation kind'),
      'unknown-future-kind',
    );

    warnSpy.mockRestore();
    await coord.stop();
  });

  it('swallows and logs when applyMutation throws (e.g. invalid schema in remote declare)', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deliver(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'peer-replica',
      kind: 'declare',
      payload: { name: 'bad.event', schema: { type: 'objct' }, transport: 'signal', producer: 'svc' },
    }));

    expect(registry.get('bad.event')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to apply remote mutation'),
      expect.stringContaining('invalid JSON Schema shape'),
      'declare',
    );

    warnSpy.mockRestore();
    await coord.stop();
  });
});

// ---------------------------------------------------------------------------
// stop() must not be able to hang.
//
// start() is fire-and-forget, so when Redis was never reachable the clients
// are still mid-connect. node-redis `quit()` waits for a usable connection
// before sending QUIT, so it never resolved — hanging stop(), and through it
// the server's whole shutdown(), at roughly one boot in two.
// ---------------------------------------------------------------------------

describe('RegistryCoordinator.stop() is bounded', () => {
  it('falls back to disconnect() when quit() never resolves', async () => {
    const coordinator = new RegistryCoordinator();

    let disconnected = 0;
    const hung = () => ({
      // Never settles — a client that never finished connecting.
      quit: () => new Promise(() => {}),
      disconnect: async () => { disconnected++; },
    });

    // Inject clients directly: start() would need a live Redis.
    Object.assign(coordinator as unknown as Record<string, unknown>, {
      pubClient: hung(),
      subClient: hung(),
      _started: true,
    });

    await coordinator.stop();

    // Both were forced closed rather than left dangling.
    expect(disconnected).toBe(2);
  }, 10_000);

  it('stop() is safe when no clients were ever created', async () => {
    const coordinator = new RegistryCoordinator();
    await expect(coordinator.stop()).resolves.toBeUndefined();
  });
});
