// tests/load-server-coordinator.test.ts
//
// What the replication coordinator accumulates over a long uptime.
//
// `RegistryCoordinator` is the one server component whose input is not
// HTTP at all: it applies whatever arrives on the `event-catalog:mutations`
// Redis channel. Every field of that message — `replicaId`, `kind`,
// `payload`, `seq` — is chosen by the publisher, and any process that can
// reach the same Redis can publish. Three of its structures are keyed off
// that input, and only one of them is actually bounded the way the header
// comment claims.
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
  peerSeq: Map<string, number>;
  stamps: Map<string, unknown>;
  pending: Array<{ mutation: { payload: unknown }; parkedAt: number }>;
} {
  return coord as unknown as {
    peerSeq: Map<string, number>;
    stamps: Map<string, unknown>;
    pending: Array<{ mutation: { payload: unknown }; parkedAt: number }>;
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

  it('DEFECT: peerSeq grows one entry per distinct replicaId, forever', async () => {
    // src/server/registry-coordinator.ts:262 — `peerSeq` is a plain Map
    // keyed by `mutation.replicaId`, written at :521 and :540. Nothing
    // caps it, evicts from it or ages entries out, and `stop()` does not
    // clear it either. Two ways this bites in production:
    //
    //   * benignly, over months: every replica restart mints a fresh
    //     `crypto.randomUUID()`, so a pod that redeploys daily leaves one
    //     dead entry per deploy on every surviving peer;
    //   * hostilely, in seconds: anything that can publish to the shared
    //     Redis channel picks its own replicaId per message.
    //
    // Note the seq=1 messages below: a first-contact message at seq 1 is
    // the *benign* path — no stale marking, no resync — so this grows
    // without even tripping the health surface.
    const registry = new Registry();
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

    expect(peerSeq.size).toBe(20_000);
    expect(coord.isStale()).toBe(false);
    // Nothing in the public surface reports it, either.
    expect(coord.getStats()).not.toHaveProperty('peers');

    await coord.stop();
    // stop() nulls the clients but leaves the map fully populated, so a
    // coordinator restarted in-process inherits the whole history.
    expect(peerSeq.size).toBe(20_000);
  });

  it('DEFECT: the parked-mutation TTL only runs when some declare arrives', async () => {
    // src/server/registry-coordinator.ts:94 declares PENDING_TTL_MS =
    // 60_000, but the only place it is enforced is `drainPending` (:721),
    // which is called from exactly one site (:659) — the arrival of a
    // `declare` broadcast. There is no timer and no sweep on the park
    // path (:698). A replica that parks mutations and then hears no
    // further declares holds them past the TTL indefinitely.
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

    // Two hours — 120x the TTL — of a quiet cluster.
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(coord.getStats().pending).toBe(400);

    // One unrelated declare is what finally runs the sweep.
    deliver({
      replicaId: 'peer-a',
      kind: 'declare',
      payload: { name: 'anything.else', transport: 'signal', producer: 'p', schema: {} },
      seq: 401,
      ts: 9_000,
    });
    expect(coord.getStats().pending).toBe(0);

    await coord.stop();
  });

  it('DEFECT: the parked buffer bounds entry COUNT, not bytes', async () => {
    // MAX_PENDING is 500 entries (:92). Each entry retains the peer's
    // whole `payload` object verbatim, and nothing inspects its size — a
    // `deprecate` carries an operator-supplied `reason` string with no
    // length limit anywhere on the replication path (the HTTP route's
    // guards never run on it). 500 slots x an arbitrary payload is a
    // memory bound only if the payload is bounded, and it is not.
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

    // Count is capped …
    expect(pending).toHaveLength(500);
    expect(coord.getStats().pending).toBe(500);
    // … bytes are not: 500 x 64 KiB = 32 MiB retained, from one peer, with
    // no declare ever arriving to expire any of it.
    const retained = pending.reduce(
      (sum, p) => sum + JSON.stringify(p.mutation.payload).length,
      0,
    );
    expect(retained).toBeGreaterThan(30 * 1024 * 1024);

    await coord.stop();
  });

  it('DEFECT: each sequence gap triggers a full registry reload', async () => {
    // `trackSequence` (:542) calls `markStale`, and `markStale` (:547)
    // fires `void this.resync(...)` — an unconditional `HGETALL` of the
    // entire registry hash plus a wholesale rebuild of the event map,
    // with no rate limit, no coalescing and no backoff. One 200-byte
    // pub/sub message per reload, and the reload also clears every stamp
    // and every parked mutation, so a peer that keeps skipping sequence
    // numbers degrades convergence to last-write-wins while it does it.
    const registry = new Registry();
    const reload = vi.spyOn(registry, 'reload').mockResolvedValue(true);
    // Every gap also logs two lines; 500 gaps is 1000 lines of noise that
    // says nothing the assertion below does not.
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
    }

    expect(reload).toHaveBeenCalledTimes(500);

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
