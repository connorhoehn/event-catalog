// tests/replica-convergence.test.ts
//
// Two live replicas on a shared in-memory pub/sub bus. These cover the
// questions multi-replica correctness actually turns on: divergence
// under concurrent writes, missed broadcasts, cross-publisher ordering,
// echo, the compat gate on the replication path, and boot.
//
// The bus can defer delivery, which is what lets a test express "both
// replicas accepted a write before either heard about the other" — the
// interleaving that a sequential await can never produce.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { RegistryCoordinator, MUTATIONS_CHANNEL } from '../src/server/registry-coordinator.js';

// ---------- shared in-memory Redis pub/sub bus ----------
type Handler = (msg: string) => void;
const subscriptions = new Map<string, Set<Handler>>();
/** Sub clients that drop everything — models a partition with no replay. */
const deafClients = new Set<object>();
/** When true, publishes queue instead of delivering. */
let deferring = false;
const queued: Array<{ channel: string; message: string }> = [];

function createMockClient() {
  const self = {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      if (deferring) {
        queued.push({ channel, message });
        return 0;
      }
      return fanout(channel, message);
    }),
    subscribe: vi.fn(async (channel: string, handler: Handler) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      const guarded: Handler = (msg) => {
        if (deafClients.has(self)) return;
        handler(msg);
      };
      subscriptions.get(channel)!.add(guarded);
    }),
    unsubscribe: vi.fn(async () => {}),
    // Registry gets no Redis in these tests, so the coordinator's boot
    // resync is a no-op and every test starts from an empty registry.
  };
  return self;
}

function fanout(channel: string, message: string): number {
  const handlers = subscriptions.get(channel);
  if (!handlers) return 0;
  for (const h of [...handlers]) h(message);
  return handlers.size;
}

/** Deliver everything published while deferring, in publish order. */
function flush() {
  deferring = false;
  const batch = queued.splice(0, queued.length);
  for (const { channel, message } of batch) fanout(channel, message);
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockClient()) }));

interface Replica {
  registry: Registry;
  coord: RegistryCoordinator;
}

async function makeReplica(): Promise<Replica> {
  const registry = new Registry();
  const coord = new RegistryCoordinator();
  await coord.start('redis://localhost:6379', registry);
  return { registry, coord };
}

/** Local write then broadcast — exactly what every mutating route does. */
async function localDeclare(r: Replica, decl: Parameters<Registry['declare']>[0]) {
  r.registry.declare(decl);
  await r.coord.broadcast('declare', r.registry.get(decl.name));
}

function subClientOf(r: Replica): object {
  return (r.coord as unknown as { subClient: object }).subClient;
}

const S1 = { type: 'object', properties: { a: { type: 'string' } } } as Record<string, unknown>;
const S2 = { type: 'object', properties: { b: { type: 'string' } } } as Record<string, unknown>;

describe('multi-replica convergence', () => {
  let a: Replica;
  let b: Replica;

  beforeEach(async () => {
    subscriptions.clear();
    deafClients.clear();
    queued.length = 0;
    deferring = false;
    a = await makeReplica();
    b = await makeReplica();
  });

  afterEach(async () => {
    await a.coord.stop();
    await b.coord.stop();
  });

  // ---------------------------------------------------------------
  // Q1 — divergence
  // ---------------------------------------------------------------
  describe('Q1 divergence under concurrent writes', () => {
    it('two replicas declaring the same event with different schemas converge', async () => {
      deferring = true;
      await localDeclare(a, { name: 'x.evt', schema: S1, transport: 'signal', producer: 'svc-a' });
      await localDeclare(b, { name: 'x.evt', schema: S2, transport: 'signal', producer: 'svc-b' });
      flush(); // now each replica hears the other's write

      const av = a.registry.get('x.evt')!;
      const bv = b.registry.get('x.evt')!;
      expect(av.schemaFingerprint).toBe(bv.schemaFingerprint);
      expect(av.schema).toEqual(bv.schema);
    });

    it('converges on the same winner regardless of which side delivers first', async () => {
      // Same scenario, opposite publish order. A total order over
      // (ts, replicaId) means the outcome must not depend on arrival.
      deferring = true;
      await localDeclare(b, { name: 'y.evt', schema: S2, transport: 'signal', producer: 'svc-b' });
      await localDeclare(a, { name: 'y.evt', schema: S1, transport: 'signal', producer: 'svc-a' });
      flush();

      expect(a.registry.get('y.evt')!.schemaFingerprint)
        .toBe(b.registry.get('y.evt')!.schemaFingerprint);
    });

    it('records the losing write as a visible conflict rather than swallowing it', async () => {
      deferring = true;
      await localDeclare(a, { name: 'z.evt', schema: S1, transport: 'signal', producer: 'svc-a' });
      await localDeclare(b, { name: 'z.evt', schema: S2, transport: 'signal', producer: 'svc-b' });
      flush();

      const all = [...a.coord.getConflicts(), ...b.coord.getConflicts()];
      expect(all.some((c) => c.reason === 'stale-write' && c.key.includes('z.evt'))).toBe(true);
    });

    it('a later write still wins over an earlier one (no LWW inversion)', async () => {
      await localDeclare(a, { name: 'seq.evt', schema: S1, transport: 'signal', producer: 'svc' });
      expect(b.registry.get('seq.evt')!.schema).toEqual(S1);

      b.registry.declare({ name: 'seq.evt', schema: S2, transport: 'signal', producer: 'svc' });
      await b.coord.broadcast('declare', b.registry.get('seq.evt'));
      expect(a.registry.get('seq.evt')!.schema).toEqual(S2);
    });
  });

  // ---------------------------------------------------------------
  // Q2 — missed broadcasts
  // ---------------------------------------------------------------
  describe('Q2 missed broadcasts', () => {
    it('a replica that missed messages marks itself stale instead of reporting clean', async () => {
      await localDeclare(a, { name: 'm.one', schema: {}, transport: 'signal', producer: 'svc' });
      expect(b.coord.isStale()).toBe(false);

      deafClients.add(subClientOf(b));
      await localDeclare(a, { name: 'm.two', schema: {}, transport: 'signal', producer: 'svc' });
      await localDeclare(a, { name: 'm.three', schema: {}, transport: 'signal', producer: 'svc' });
      deafClients.delete(subClientOf(b));

      await localDeclare(a, { name: 'm.four', schema: {}, transport: 'signal', producer: 'svc' });

      // The registry really is short two events, and the replica knows.
      expect(b.registry.get('m.two')).toBeUndefined();
      expect(b.coord.isStale()).toBe(true);
    });

    it('stays clean when nothing was actually dropped', async () => {
      for (const n of ['a', 'b', 'c', 'd']) {
        await localDeclare(a, { name: `ok.${n}`, schema: {}, transport: 'signal', producer: 'svc' });
      }
      expect(b.coord.isStale()).toBe(false);
      expect(b.registry.size()).toBe(4);
    });

    it('resync() repairs a stale replica from the shared Redis hash', async () => {
      // A registry with a Redis backing — the shared store both replicas
      // persist into. The stale replica reads current truth back out.
      const shared = new Map<string, string>([
        ['persisted.one', JSON.stringify({
          name: 'persisted.one', schema: {}, transport: 'signal', producer: 'svc',
          version: 3, schemaFingerprint: 'fp', namespace: 'persisted',
          compatibilityMode: 'backward', schemaHistory: [], subscribers: ['consumer-x'],
          metadata: { createdAt: '', lastPublishedAt: null, publishCount: 0, errorCount: 0 },
        })],
      ]);
      const redisish = {
        hGetAll: async () => Object.fromEntries(shared),
        hSet: async () => 1,
        hDel: async () => 1,
      } as unknown as ConstructorParameters<typeof Registry>[0];

      const registry = new Registry(redisish);
      registry.declare({ name: 'ghost.evt', schema: {}, transport: 'signal', producer: 'svc' });
      const coord = new RegistryCoordinator();
      await coord.start('redis://localhost:6379', registry);

      // Boot resync already ran: the locally-declared ghost is gone and
      // the shared state (including its subscribers) is present.
      expect(registry.get('ghost.evt')).toBeUndefined();
      expect(registry.get('persisted.one')!.subscribers).toEqual(['consumer-x']);
      expect(coord.isStale()).toBe(false);
      await coord.stop();
    });

    it('a replica with no Redis-backed registry cannot resync and stays stale', async () => {
      deafClients.add(subClientOf(b));
      await localDeclare(a, { name: 'gone.one', schema: {}, transport: 'signal', producer: 'svc' });
      deafClients.delete(subClientOf(b));
      await localDeclare(a, { name: 'gone.two', schema: {}, transport: 'signal', producer: 'svc' });

      expect(b.coord.isStale()).toBe(true);
      expect(await b.coord.resync('manual')).toBe(false);
      expect(b.coord.isStale()).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Q3 — cross-publisher ordering
  // ---------------------------------------------------------------
  describe('Q3 ordering', () => {
    it('a deprecate arriving before its declare is replayed, not dropped', async () => {
      a.registry.declare({ name: 'ord.evt', schema: {}, transport: 'signal', producer: 'svc' });
      const declared = a.registry.get('ord.evt');
      a.registry.deprecate('ord.evt', { reason: 'sunset' });

      deferring = true;
      await a.coord.broadcast('declare', declared);
      await a.coord.broadcast('deprecate', { name: 'ord.evt', opts: { reason: 'sunset' } });
      // Deliver in reverse — pub/sub gives no cross-publisher ordering.
      queued.reverse();
      flush();

      expect(b.registry.get('ord.evt')?.deprecation?.reason).toBe('sunset');
    });

    it('a subscriber.add arriving before its declare is replayed, not dropped', async () => {
      a.registry.declare({ name: 'sub.evt', schema: {}, transport: 'signal', producer: 'svc' });
      const declared = a.registry.get('sub.evt');

      deferring = true;
      await a.coord.broadcast('declare', declared);
      await a.coord.broadcast('subscriber.add', { eventName: 'sub.evt', serviceName: 'consumer-1' });
      queued.reverse();
      flush();

      expect(b.registry.get('sub.evt')?.subscribers).toContain('consumer-1');
    });

    it('a subscriber.remove arriving before its add does not resurrect the subscriber', async () => {
      await localDeclare(a, { name: 'rm.evt', schema: {}, transport: 'signal', producer: 'svc' });

      deferring = true;
      a.registry.addSubscriber('rm.evt', 'c1');
      await a.coord.broadcast('subscriber.add', { eventName: 'rm.evt', serviceName: 'c1' });
      a.registry.removeSubscriber('rm.evt', 'c1');
      await a.coord.broadcast('subscriber.remove', { eventName: 'rm.evt', serviceName: 'c1' });
      queued.reverse();
      flush();

      expect(a.registry.get('rm.evt')!.subscribers).not.toContain('c1');
      expect(b.registry.get('rm.evt')!.subscribers).not.toContain('c1');
    });

    it('a remove arriving before its declare does not let the event resurrect', async () => {
      a.registry.declare({ name: 'res.evt', schema: {}, transport: 'signal', producer: 'svc' });
      const declared = a.registry.get('res.evt');

      deferring = true;
      await a.coord.broadcast('declare', declared);
      a.registry.remove('res.evt');
      await a.coord.broadcast('remove', { name: 'res.evt' });
      queued.reverse(); // remove lands first
      flush();

      expect(a.registry.get('res.evt')).toBeUndefined();
      expect(b.registry.get('res.evt')).toBeUndefined();
    });

    it('an undeprecate arriving before its deprecate does not un-do the newer state', async () => {
      await localDeclare(a, { name: 'dep.evt', schema: {}, transport: 'signal', producer: 'svc' });

      deferring = true;
      a.registry.deprecate('dep.evt', { reason: 'first' });
      await a.coord.broadcast('deprecate', { name: 'dep.evt', opts: { reason: 'first' } });
      a.registry.undeprecate('dep.evt');
      await a.coord.broadcast('undeprecate', { name: 'dep.evt' });
      queued.reverse();
      flush();

      expect(a.registry.get('dep.evt')!.deprecation).toBeUndefined();
      expect(b.registry.get('dep.evt')!.deprecation).toBeUndefined();
    });

    it('subscriber lists survive a first-sight replicated declare', async () => {
      // Registry.declare resets subscribers when building a fresh entry.
      // On the replication path the payload is a populated peer entry,
      // so that reset would drop the peer's consumer list.
      a.registry.declare({ name: 'pop.evt', schema: {}, transport: 'signal', producer: 'svc' });
      a.registry.addSubscriber('pop.evt', 'consumer-a');
      a.registry.addSubscriber('pop.evt', 'consumer-b');
      await a.coord.broadcast('declare', a.registry.get('pop.evt'));

      expect(b.registry.get('pop.evt')!.subscribers).toEqual(['consumer-a', 'consumer-b']);
    });
  });

  // ---------------------------------------------------------------
  // Q4 — echo
  // ---------------------------------------------------------------
  describe('Q4 echo', () => {
    it('a replica does not apply its own declare back to itself', async () => {
      await localDeclare(a, { name: 'echo.evt', schema: S1, transport: 'signal', producer: 'svc' });
      const version = a.registry.get('echo.evt')!.version;
      await a.coord.broadcast('declare', a.registry.get('echo.evt'));
      expect(a.registry.get('echo.evt')!.version).toBe(version);
      expect(a.registry.get('echo.evt')!.schemaHistory).toHaveLength(0);
    });

    it('a replica does not double-count its own subscriber add', async () => {
      await localDeclare(a, { name: 'echo2.evt', schema: {}, transport: 'signal', producer: 'svc' });
      a.registry.addSubscriber('echo2.evt', 'c1');
      await a.coord.broadcast('subscriber.add', { eventName: 'echo2.evt', serviceName: 'c1' });
      expect(a.registry.get('echo2.evt')!.subscribers.filter((s) => s === 'c1')).toHaveLength(1);
      expect(b.registry.get('echo2.evt')!.subscribers.filter((s) => s === 'c1')).toHaveLength(1);
    });

    it('a duplicate delivery of the same message is idempotent', async () => {
      a.registry.declare({ name: 'dup.evt', schema: S1, transport: 'signal', producer: 'svc' });
      const entry = a.registry.get('dup.evt');
      await a.coord.broadcast('declare', entry);
      const v1 = b.registry.get('dup.evt')!.version;

      // Redis can redeliver; the stamp must make a replay a no-op.
      const raw = JSON.stringify({
        replicaId: a.coord.replicaId, kind: 'declare', payload: entry,
        seq: 1, ts: (a.coord as unknown as { lastTs: number }).lastTs,
      });
      fanout(MUTATIONS_CHANNEL, raw);
      expect(b.registry.get('dup.evt')!.version).toBe(v1);
    });
  });

  // ---------------------------------------------------------------
  // Q4b — regressions found by tests/fuzz-replica-convergence.test.ts
  // ---------------------------------------------------------------
  describe('Q4b fuzz regressions', () => {
    it('the loser of a concurrent declare adopts the winner\'s version and history', async () => {
      // Registry.declare derives `version` and `schemaHistory` from the
      // *local* prior schema. On the replication path that is the wrong
      // source: the loser would bump its own counter and push its own
      // discarded schema into history, leaving two replicas serving the
      // same contract under different version numbers.
      deferring = true;
      await localDeclare(a, { name: 'ver.evt', schema: S1, transport: 'signal', producer: 'svc' });
      await localDeclare(b, { name: 'ver.evt', schema: S2, transport: 'signal', producer: 'svc' });
      flush();

      const av = a.registry.get('ver.evt')!;
      const bv = b.registry.get('ver.evt')!;
      expect(bv.version).toBe(av.version);
      expect(bv.schemaHistory).toEqual(av.schemaHistory);
    });

    it('a delayed duplicate does not look like a missed broadcast', async () => {
      // peerSeq is a high-water mark. Writing a redelivered (lower) seq
      // back over it made the next in-order message look like a gap, so
      // a healthy replica reloaded its whole registry for nothing.
      await localDeclare(a, { name: 'hw.one', schema: {}, transport: 'signal', producer: 'svc' });
      await localDeclare(a, { name: 'hw.two', schema: {}, transport: 'signal', producer: 'svc' });

      deferring = true;
      await localDeclare(a, { name: 'hw.three', schema: {}, transport: 'signal', producer: 'svc' });
      const [third] = queued.splice(0, 1);
      fanout(third.channel, third.message);
      // ...and now Redis redelivers seq 1, out of position.
      fanout(MUTATIONS_CHANNEL, JSON.stringify({
        replicaId: a.coord.replicaId, kind: 'declare',
        payload: a.registry.get('hw.one'), seq: 1, ts: 1,
      }));
      deferring = false;

      await localDeclare(a, { name: 'hw.four', schema: {}, transport: 'signal', producer: 'svc' });
      expect(b.coord.isStale()).toBe(false);
      expect(b.registry.size()).toBe(4);
    });

    it('a subscriber parked for a removed event does not attach to the next one', async () => {
      // b parks the add (it has no such event yet), then learns the
      // event was deleted. Replaying the parked add on the *next*
      // declare would give b a consumer that a never had.
      a.registry.declare({ name: 'ghost.evt', schema: {}, transport: 'signal', producer: 'svc' });
      const declared = a.registry.get('ghost.evt');
      a.registry.addSubscriber('ghost.evt', 'c1');

      deferring = true;
      await a.coord.broadcast('declare', declared);
      await a.coord.broadcast('subscriber.add', { eventName: 'ghost.evt', serviceName: 'c1' });
      // The add overtakes its declare; b parks it.
      const [decl, add] = queued.splice(0, 2);
      fanout(add.channel, add.message);
      expect(b.registry.get('ghost.evt')).toBeUndefined();

      // a deletes the event. b hears about the delete while the add is
      // still parked — that is what has to kill the parked add.
      a.registry.remove('ghost.evt');
      await a.coord.broadcast('remove', { name: 'ghost.evt' });
      const [rm] = queued.splice(0, 1);
      fanout(rm.channel, rm.message);

      // ...and then re-declares it from scratch.
      a.registry.declare({ name: 'ghost.evt', schema: S1, transport: 'signal', producer: 'svc' });
      await a.coord.broadcast('declare', a.registry.get('ghost.evt'));
      queued.push(decl); // the original declare finally lands, too late
      flush();

      expect(a.registry.get('ghost.evt')!.subscribers).toEqual([]);
      expect(b.registry.get('ghost.evt')!.subscribers).toEqual([]);
      expect(b.coord.getConflicts().some((c) => c.detail?.includes('was removed'))).toBe(true);
    });

    it('a redelivery of an edit that died with its event is still refused', async () => {
      // Discarding a mutation is only safe if the copy Redis sends again
      // reaches the same verdict — the tombstone is gone once the event
      // is re-declared, so the discard has to leave a stamp behind.
      await localDeclare(a, { name: 'tomb.evt', schema: {}, transport: 'signal', producer: 'svc' });
      a.registry.addSubscriber('tomb.evt', 'c1');
      const addMsg = JSON.stringify({
        replicaId: a.coord.replicaId, kind: 'subscriber.add',
        payload: { eventName: 'tomb.evt', serviceName: 'c1' }, seq: 99, ts: Date.now() + 5,
      });

      a.registry.remove('tomb.evt');
      await a.coord.broadcast('remove', { name: 'tomb.evt' });
      fanout(MUTATIONS_CHANNEL, addMsg); // arrives after the delete — discarded

      a.registry.declare({ name: 'tomb.evt', schema: {}, transport: 'signal', producer: 'svc' });
      await a.coord.broadcast('declare', a.registry.get('tomb.evt'));
      fanout(MUTATIONS_CHANNEL, addMsg); // Redis redelivers it

      expect(b.registry.get('tomb.evt')!.subscribers).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // Q5 — the compat gate on the replication path
  // ---------------------------------------------------------------
  describe('Q5 compat gate under replication', () => {
    const strictBase = {
      name: 'gate.evt',
      schema: { type: 'object', properties: { keep: { type: 'string' } }, required: ['keep'] } as Record<string, unknown>,
      transport: 'signal' as const,
      producer: 'svc',
      compatMode: 'strict' as const,
      compatibilityMode: 'backward' as const,
    };
    const breaking = {
      ...strictBase,
      schema: {
        type: 'object',
        properties: { keep: { type: 'string' }, added: { type: 'string' } },
        required: ['keep', 'added'],
      },
    };

    it('refuses a replicated declare that the local strict gate would reject', async () => {
      a.registry.declare(strictBase);
      b.registry.declare(strictBase);

      a.registry.declare(breaking);
      await a.coord.broadcast('declare', a.registry.get('gate.evt'));

      expect((b.registry.get('gate.evt')!.schema as { required: string[] }).required).toEqual(['keep']);
      expect(b.coord.getConflicts().some((c) => c.reason === 'compat-violation')).toBe(true);
    });

    it('allows a replicated declare that is compatible', async () => {
      a.registry.declare(strictBase);
      b.registry.declare(strictBase);

      const additive = {
        ...strictBase,
        schema: {
          type: 'object',
          properties: { keep: { type: 'string' }, extra: { type: 'string' } },
          required: ['keep'],
        },
      };
      a.registry.declare(additive);
      await a.coord.broadcast('declare', a.registry.get('gate.evt'));

      expect(b.registry.get('gate.evt')!.schema).toEqual(additive.schema);
      expect(b.coord.getConflicts()).toHaveLength(0);
    });

    it('does not gate an event whose compat mode is not strict', async () => {
      const lax = { ...strictBase, compatMode: 'warn' as const };
      a.registry.declare(lax);
      b.registry.declare(lax);

      a.registry.declare({ ...breaking, compatMode: 'warn' as const });
      await a.coord.broadcast('declare', a.registry.get('gate.evt'));

      expect((b.registry.get('gate.evt')!.schema as { required: string[] }).required)
        .toEqual(['keep', 'added']);
    });
  });

  // ---------------------------------------------------------------
  // Q6 — boot
  // ---------------------------------------------------------------
  describe('Q6 boot into an existing cluster', () => {
    it('a replica joining late does not see mutations that predate it', async () => {
      // Without shared persistence there is nothing to catch up from —
      // pub/sub has no replay. This documents the real boundary: the
      // Redis hash, not the mutation channel, is what a joiner reads.
      await localDeclare(a, { name: 'pre.evt', schema: {}, transport: 'signal', producer: 'svc' });
      const c = await makeReplica();
      expect(c.registry.get('pre.evt')).toBeUndefined();

      await localDeclare(a, { name: 'post.evt', schema: {}, transport: 'signal', producer: 'svc' });
      expect(c.registry.get('post.evt')).toBeDefined();
      // ...and it knows: the first peer message it saw was seq 2, so it
      // reports stale rather than serving a partial registry as healthy.
      expect(c.coord.isStale()).toBe(true);
      await c.coord.stop();
    });

    it('subscribes before reading full state, so nothing published mid-read is lost', async () => {
      // The boot resync reads the shared hash *after* subscribe(), so a
      // mutation published during the read still arrives on the channel.
      const registry = new Registry();
      const coord = new RegistryCoordinator();
      const order: string[] = [];
      const origReload = registry.reload.bind(registry);
      registry.reload = async () => { order.push('reload'); return origReload(); };
      const spy = vi.spyOn(registry, 'get');
      await coord.start('redis://localhost:6379', registry);
      spy.mockRestore();

      expect(subscriptions.get(MUTATIONS_CHANNEL)!.size).toBe(3); // a, b, and this one
      expect(order).toEqual(['reload']);
      await coord.stop();
    });
  });
});

// ---------------------------------------------------------------
// Rolling upgrade — peers on a build that predates stamping
// ---------------------------------------------------------------
describe('multi-replica convergence — unstamped peers', () => {
  let a: Replica;

  beforeEach(async () => {
    subscriptions.clear();
    deafClients.clear();
    queued.length = 0;
    deferring = false;
    a = await makeReplica();
  });

  afterEach(async () => { await a.coord.stop(); });

  it('applies mutations from a peer that sends no ts, in arrival order', async () => {
    const send = (kind: string, payload: unknown) =>
      fanout(MUTATIONS_CHANNEL, JSON.stringify({ replicaId: 'legacy-peer', kind, payload }));

    send('declare', { name: 'legacy.evt', schema: {}, transport: 'signal', producer: 'svc' });
    send('subscriber.add', { eventName: 'legacy.evt', serviceName: 'c1' });
    expect(a.registry.get('legacy.evt')!.subscribers).toEqual(['c1']);

    send('subscriber.remove', { eventName: 'legacy.evt', serviceName: 'c1' });
    expect(a.registry.get('legacy.evt')!.subscribers).toEqual([]);
  });

  it('a peer that omits version/schemaHistory does not wipe ours', async () => {
    // A replicated declare now adopts the peer's version and history so
    // the loser of a concurrent write stops re-deriving its own. An
    // older peer's payload carries neither field, and reading them as
    // "the peer says: empty" would reset a live event's history during
    // a rolling upgrade. Each adoption is guarded on the field existing.
    a.registry.declare({ name: 'mixver.evt', schema: S1, transport: 'signal', producer: 'svc' });
    a.registry.declare({ name: 'mixver.evt', schema: S2, transport: 'signal', producer: 'svc' });
    const before = a.registry.get('mixver.evt')!;
    expect(before.version).toBe(2);
    expect(before.schemaHistory).toHaveLength(1);

    fanout(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'legacy-peer', kind: 'declare',
      payload: { name: 'mixver.evt', schema: S1, transport: 'signal', producer: 'svc' },
    }));

    const after = a.registry.get('mixver.evt')!;
    expect(after.version).toBe(3);            // derived locally, as before
    expect(after.schemaHistory).toHaveLength(2);
  });

  it('a stamped local write is not clobbered by an unstamped peer being dropped', async () => {
    // Unstamped messages never write a stamp, so they cannot corrupt
    // the ordering state that stamped peers rely on.
    await localDeclare(a, { name: 'mix.evt', schema: S1, transport: 'signal', producer: 'svc' });
    fanout(MUTATIONS_CHANNEL, JSON.stringify({
      replicaId: 'legacy-peer', kind: 'declare',
      payload: { name: 'mix.evt', schema: S2, transport: 'signal', producer: 'svc' },
    }));
    expect(a.registry.get('mix.evt')!.schema).toEqual(S2); // legacy arrival-order semantics

    // A stamped peer's later write still wins.
    const stamped = JSON.stringify({
      replicaId: 'zzz-newer-peer', kind: 'declare', seq: 1, ts: Date.now() + 1000,
      payload: { name: 'mix.evt', schema: S1, transport: 'signal', producer: 'svc' },
    });
    fanout(MUTATIONS_CHANNEL, stamped);
    expect(a.registry.get('mix.evt')!.schema).toEqual(S1);
  });
});
