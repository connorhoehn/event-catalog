// tests/load-server-coordinator.test.ts
//
// What the replication coordinator accumulates over a long uptime.
//
// `RegistryCoordinator` is the one server component whose input is not
// HTTP at all: it applies whatever arrives on the `event-catalog:mutations`
// Redis channel. Every field of that message — `replicaId`, `kind`,
// `payload`, `seq` — is chosen by the publisher, and any process that can
// reach the same Redis can publish. Every structure keyed off that input
// therefore needs a ceiling, and each test below pins one of them.
//
// Fake timers throughout; the mutations channel is an in-memory map.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { RegistryCoordinator, MUTATIONS_CHANNEL } from '../src/server/registry-coordinator.js';

type Handler = (msg: string) => void;
const subscriptions = new Map<string, Set<Handler>>();

function createMockClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async (channel: string, handler: Handler) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async () => {}),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockClient()) }));

function deliver(msg: unknown): void {
  for (const h of subscriptions.get(MUTATIONS_CHANNEL) ?? []) h(JSON.stringify(msg));
}

async function makeCoordinator(registry: Registry): Promise<RegistryCoordinator> {
  const coord = new RegistryCoordinator();
  await coord.start('redis://localhost:6379', registry);
  return coord;
}

/** Reach the private buffers the public surface only summarizes. */
function internals(coord: RegistryCoordinator): {
  peerSeq: Map<string, { seq: number; seenAt: number }>;
  stamps: Map<string, unknown>;
  pending: Array<{ mutation: { payload: unknown }; parkedAt: number; bytes: number }>;
} {
  return coord as unknown as {
    peerSeq: Map<string, { seq: number; seenAt: number }>;
    stamps: Map<string, unknown>;
    pending: Array<{ mutation: { payload: unknown }; parkedAt: number; bytes: number }>;
  };
}

beforeEach(() => {
  subscriptions.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('coordinator buffers under sustained replication traffic', () => {
  it('stamps are capped and evict oldest-first', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    const { stamps } = internals(coord);

    // 30 000 distinct conflict keys — 1.5x the 20 000 MAX_STAMPS ceiling.
    for (let i = 0; i < 30_000; i++) {
      await coord.broadcast('declare', { name: `load.stamp.${i}` });
    }
    expect(stamps.size).toBe(20_000);

    await coord.stop();
  });

  it('peerSeq is capped, and eviction is reported rather than silent', async () => {
    // `peerSeq` is keyed by a value the publisher chooses. Benignly it
    // grows one dead entry per pod restart on every surviving peer;
    // hostilely, one entry per message, since anything that can publish
    // to the shared Redis picks its own replicaId. MAX_PEERS bounds it.
    //
    // Note the seq=1 messages: a first-contact message at seq 1 is the
    // benign path — no stale marking, no resync — so before the cap this
    // grew without even tripping the health surface.
    const registry = new Registry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);
    const { peerSeq } = internals(coord);

    for (let i = 0; i < 20_000; i++) {
      deliver({
        replicaId: `peer-${i}`,
        kind: 'declare',
        payload: { name: 'load.shared', transport: 'signal', producer: 'p', schema: {} },
        seq: 1,
        ts: 1_000 + i,
      });
    }

    expect(peerSeq.size).toBe(512);
    // Eviction happened, and the public surface says so — losing a
    // peer's high-water mark resets gap detection for it, which is
    // exactly the kind of degradation that must not be invisible.
    const stats = coord.getStats();
    expect(stats.peers).toBe(512);
    expect(stats.peersForgotten).toBe(20_000 - 512);

    warn.mockRestore();
    await coord.stop();
    // A coordinator restarted in-process must not inherit the history.
    expect(peerSeq.size).toBe(0);
  });

  it('a live peer stays in the table while one-shot ids churn past it', async () => {
    // The eviction order is what keeps gap detection working under a
    // flood: entries are dropped least-recently-seen first, and a real
    // peer is seen on every message while the flood's minted ids are
    // seen exactly once. So the real peer never leaves, and the gap it
    // eventually produces is still detected.
    const registry = new Registry();
    const reload = vi.spyOn(registry, 'reload').mockResolvedValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);
    const { peerSeq } = internals(coord);

    const real = (seq: number) => deliver({
      replicaId: 'real-peer',
      kind: 'declare',
      payload: { name: `real.${seq}`, transport: 'signal', producer: 'p', schema: {} },
      seq,
      ts: 1_000 + seq,
    });

    real(1);
    for (let i = 0; i < 5_000; i++) {
      deliver({
        replicaId: `flood-${i}`,
        kind: 'declare',
        payload: { name: 'load.shared', transport: 'signal', producer: 'p', schema: {} },
        seq: 1,
        ts: 2_000 + i,
      });
      if (i % 100 === 0) real(2 + i / 100); // in order, so no gap yet
    }

    expect(peerSeq.has('real-peer')).toBe(true);
    expect(coord.isStale()).toBe(false);

    // The flood never displaced the real peer's mark, so the hole below
    // is still visible as a hole.
    reload.mockClear();
    real(9_999);
    expect(coord.isStale() || reload.mock.calls.length > 0).toBe(true);

    warn.mockRestore();
    await coord.stop();
  });

  it('a peer evicted while still live is not later mistaken for a newcomer', async () => {
    // The residual case the LRU order cannot cover: a real peer that
    // goes quiet while the flood streams past *does* get evicted. If its
    // return were then read as ordinary first contact, the flood would
    // have silently switched off gap detection for it — the one thing
    // bounding this table must not do. Evicting a recently-seen peer
    // latches `forgotLivePeer`, so the next unexplained first contact at
    // seq > 1 is treated as a possible gap instead.
    const registry = new Registry();
    // No Redis behind the registry, so the repair cannot succeed and the
    // stale flag latches — which is what makes it observable here.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);
    const { peerSeq } = internals(coord);

    deliver({
      replicaId: 'quiet-peer',
      kind: 'declare',
      payload: { name: 'quiet.1', transport: 'signal', producer: 'p', schema: {} },
      seq: 1,
      ts: 1_000,
    });
    expect(peerSeq.has('quiet-peer')).toBe(true);

    // It then says nothing while 1 000 one-shot ids go by.
    for (let i = 0; i < 1_000; i++) {
      deliver({ replicaId: `flood-${i}`, kind: 'declare', payload: { notAName: i }, seq: 1, ts: 2_000 + i });
    }
    expect(peerSeq.has('quiet-peer')).toBe(false);
    expect(coord.getStats().peersForgotten).toBeGreaterThan(0);
    expect(coord.isStale()).toBe(false); // seq-1 arrivals explain themselves

    // It comes back, mid-stream. Its mark is gone, so this looks like
    // first contact — and must not be waved through as one.
    deliver({
      replicaId: 'quiet-peer',
      kind: 'declare',
      payload: { name: 'quiet.2', transport: 'signal', producer: 'p', schema: {} },
      seq: 40,
      ts: 9_000,
    });
    expect(coord.isStale()).toBe(true);

    warn.mockRestore();
    await coord.stop();
  });

  it('the parked-mutation TTL runs on its own, with no incoming message', async () => {
    // PENDING_TTL_MS used to be enforced only inside `drainPending`,
    // whose sole caller is the arrival of a `declare` broadcast. A
    // replica that parked mutations and then heard nothing further held
    // them forever. The sweep timer is what makes the TTL mean something
    // on a quiet cluster.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    for (let i = 0; i < 400; i++) {
      deliver({
        replicaId: 'peer-a',
        kind: 'subscriber.add',
        payload: { eventName: `never.declared.${i}`, serviceName: 'svc' },
        seq: i + 1,
        ts: 1_000 + i,
      });
    }
    expect(coord.getStats().pending).toBe(400);

    // Still inside the window: nothing is dropped early.
    vi.advanceTimersByTime(30_000);
    expect(coord.getStats().pending).toBe(400);

    // Past the TTL, with no broadcast of any kind in between.
    vi.advanceTimersByTime(60_000);
    expect(coord.getStats().pending).toBe(0);
    expect(coord.getStats().pendingBytes).toBe(0);
    expect(coord.getConflicts().some((c) => c.reason === 'pending-expired')).toBe(true);

    await coord.stop();
  });

  it('the sweep timer is cleared by stop() and dies with the buffer', async () => {
    // A surviving interval means SIGTERM no longer stops the container.
    // It must also retire on its own once nothing is parked, rather than
    // ticking over an empty array for the life of the process.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    const timers = () => vi.getTimerCount();

    expect(timers()).toBe(0);
    deliver({
      replicaId: 'peer-a',
      kind: 'subscriber.add',
      payload: { eventName: 'never.declared', serviceName: 'svc' },
      seq: 1,
      ts: 1_000,
    });
    expect(timers()).toBe(1);

    // Emptying the buffer by expiry retires the timer.
    vi.advanceTimersByTime(90_000);
    expect(coord.getStats().pending).toBe(0);
    expect(timers()).toBe(0);

    // And stop() clears it while it is still live.
    deliver({
      replicaId: 'peer-a',
      kind: 'subscriber.add',
      payload: { eventName: 'never.declared.2', serviceName: 'svc' },
      seq: 2,
      ts: 2_000,
    });
    expect(timers()).toBe(1);
    await coord.stop();
    expect(timers()).toBe(0);
  });

  it('the parked buffer bounds bytes, not just entry count', async () => {
    // Each entry retains the peer's whole `payload` verbatim, and a
    // `deprecate` carries an operator-supplied `reason` with no length
    // limit anywhere on the replication path. 500 slots x 64 KiB was
    // 32 MiB retained from a single peer; the byte budget is what makes
    // the slot count an actual memory bound.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const registry = new Registry();
    const coord = await makeCoordinator(registry);
    const { pending } = internals(coord);

    const reason = 'x'.repeat(64 * 1024); // 64 KiB per parked mutation
    for (let i = 0; i < 700; i++) {
      deliver({
        replicaId: 'flooder',
        kind: 'deprecate',
        payload: { name: `never.declared.${i}`, opts: { reason } },
        seq: i + 1,
        ts: 1_000 + i,
      });
    }

    const retained = pending.reduce(
      (sum, p) => sum + JSON.stringify(p.mutation.payload).length,
      0,
    );
    expect(retained).toBeLessThanOrEqual(2 * 1024 * 1024);
    // The count bound still holds too, and the reported total tracks the
    // real one rather than being recomputed only when asked.
    expect(pending.length).toBeLessThanOrEqual(500);
    expect(coord.getStats().pendingBytes).toBe(
      pending.reduce((sum, p) => sum + p.bytes, 0),
    );
    // Trimming is recorded, not silent.
    expect(coord.getConflicts().some((c) => c.reason === 'pending-expired')).toBe(true);

    await coord.stop();
  });

  it('an implausibly large broadcast is refused outright', async () => {
    // The HTTP path reads bodies under MAX_REQUEST_BODY_BYTES; the
    // broadcast path had no equivalent, so a peer could hand every
    // replica an arbitrarily large string to parse and retain.
    const registry = new Registry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);

    deliver({
      replicaId: 'flooder',
      kind: 'declare',
      payload: {
        name: 'huge.event',
        transport: 'signal',
        producer: 'p',
        schema: {},
        junk: 'x'.repeat(2 * 1024 * 1024),
      },
      seq: 1,
      ts: 1_000,
    });

    expect(registry.get('huge.event')).toBeUndefined();
    expect(coord.getConflicts().some((c) => c.reason === 'oversized')).toBe(true);
    // Refused without being parsed, so it never reached the peer table.
    expect(coord.getStats().peers).toBe(0);

    warn.mockRestore();
    await coord.stop();
  });

  it('repeated sequence gaps coalesce into a bounded number of reloads', async () => {
    // `trackSequence` -> `markStale` -> resync used to be an
    // unconditional HGETALL of the whole registry per gap. The reload
    // also clears every stamp and every parked mutation, so 500 of them
    // degrade convergence to last-write-wins for the duration. One
    // reload at a time, spaced by a doubling backoff.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const registry = new Registry();
    const reload = vi.spyOn(registry, 'reload').mockResolvedValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);
    reload.mockClear();

    let seq = 1;
    deliver({ replicaId: 'gappy', kind: 'declare', payload: { name: 'a', transport: 'signal', producer: 'p', schema: {} }, seq, ts: 1 });
    for (let i = 0; i < 500; i++) {
      seq += 10; // a nine-message hole every time
      deliver({
        replicaId: 'gappy',
        kind: 'declare',
        payload: { name: `a.${i}`, transport: 'signal', producer: 'p', schema: {} },
        seq,
        ts: 100 + i,
      });
      await vi.advanceTimersByTimeAsync(0);
    }

    // 500 gaps, nowhere near 500 reloads.
    expect(reload.mock.calls.length).toBeLessThan(10);
    // And what was folded away is counted, not lost.
    expect(coord.getStats().resyncsCoalesced).toBeGreaterThan(0);

    warn.mockRestore();
    await coord.stop();
  });

  it('a single gap still repairs immediately', async () => {
    // Backoff must not delay the common case: one dropped broadcast on
    // an otherwise healthy link should reload at once, or the replica
    // serves a truncated registry for the length of the backoff.
    const registry = new Registry();
    const reload = vi.spyOn(registry, 'reload').mockResolvedValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);
    reload.mockClear();

    deliver({ replicaId: 'peer-a', kind: 'declare', payload: { name: 'a', transport: 'signal', producer: 'p', schema: {} }, seq: 1, ts: 1 });
    deliver({ replicaId: 'peer-a', kind: 'declare', payload: { name: 'b', transport: 'signal', producer: 'p', schema: {} }, seq: 5, ts: 2 });
    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(coord.isStale()).toBe(false);

    warn.mockRestore();
    await coord.stop();
  });

  it('a deferred repair leaves the replica flagged stale until it runs', async () => {
    // Coalescing must never let health read "fine" while a repair is
    // still pending — that would trade a reload storm for a replica
    // quietly serving an incomplete registry.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const registry = new Registry();
    const reload = vi.spyOn(registry, 'reload').mockResolvedValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = await makeCoordinator(registry);
    reload.mockClear();

    const gap = (seq: number) => deliver({
      replicaId: 'gappy',
      kind: 'declare',
      payload: { name: `g.${seq}`, transport: 'signal', producer: 'p', schema: {} },
      seq,
      ts: seq,
    });

    gap(1);
    gap(10); // first gap: immediate reload
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(coord.isStale()).toBe(false);

    gap(20); // second gap: deferred behind the backoff
    expect(coord.isStale()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // Once the backoff elapses the deferred reload runs and clears it.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(coord.isStale()).toBe(false);

    warn.mockRestore();
    await coord.stop();
  });

  it('the conflict ring stays at its cap under a flood', async () => {
    const registry = new Registry();
    const coord = await makeCoordinator(registry);

    // Every one of these loses the tie-break against a stamp we hold, so
    // each records a conflict.
    await coord.broadcast('declare', { name: 'load.conflict' });
    for (let i = 0; i < 5_000; i++) {
      deliver({
        replicaId: 'peer-loser',
        kind: 'declare',
        payload: { name: 'load.conflict', transport: 'signal', producer: 'p', schema: {} },
        seq: i + 1,
        ts: 1, // always older than our own stamp
      });
    }

    expect(coord.getConflicts().length).toBeLessThanOrEqual(50);
    await coord.stop();
  });
});
