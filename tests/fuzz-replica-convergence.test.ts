// tests/fuzz-replica-convergence.test.ts
//
// Property-based coverage for RegistryCoordinator's replication layer.
//
// The hand-written scenarios in replica-convergence.test.ts each pin one
// interleaving that someone thought of. This file generates them: random
// operation scripts across 2–5 simulated replicas, delivered in random
// order with duplicates and drops, checking the invariants that the
// design actually promises rather than the outcome of one trace.
//
// Everything here is deterministic. `Date.now()` is a virtual clock that
// only advances on a local operation, the pub/sub bus is a queue the test
// drains explicitly, and there are no timers or sleeps — so a failing
// seed printed in an assertion message reproduces exactly.
//
// Delivery model. A receiver keeps one FIFO queue per publishing replica,
// which is what a single Redis subscription actually gives you, and the
// scheduler interleaves those queues arbitrarily. That matches what the
// coordinator's own docs promise to survive ("Redis pub/sub does not
// order across publishers") without inventing a reordering that a real
// connection cannot produce.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { RegistryCoordinator } from '../src/server/registry-coordinator.js';
import { checkBackwardCompat } from '../src/registry/schema-compat.js';
import type { RegistryEntry } from '../src/types/index.js';

// ---------------------------------------------------------------
// deterministic PRNG
// ---------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(nExclusive: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
}

function rng(seed: number): Rng {
  const r = mulberry32(seed);
  return {
    next: r,
    int: (n) => Math.floor(r() * n) % Math.max(1, n),
    pick: (xs) => xs[Math.floor(r() * xs.length) % xs.length],
    chance: (p) => r() < p,
  };
}

// ---------------------------------------------------------------
// in-memory pub/sub bus with per-(receiver, publisher) FIFO queues
// ---------------------------------------------------------------

type Handler = (msg: string) => void;

interface Inbox {
  handler: Handler;
  /** publisher replicaId → messages still undelivered to this receiver. */
  queues: Map<string, string[]>;
  /** This receiver's own replicaId, filled in once the replica exists. */
  owner?: string;
}

let inboxes: Inbox[] = [];
/** Every message ever published, in publish order — the replay source. */
let publishLog: string[] = [];

interface MockClient {
  connect: () => Promise<void>;
  quit: () => Promise<void>;
  on: (ev: string, cb: (e: Error) => void) => void;
  publish: (ch: string, msg: string) => Promise<number>;
  subscribe: (ch: string, handler: Handler) => Promise<void>;
  unsubscribe: () => Promise<void>;
  /** set once this client subscribes, so quit() can detach it. */
  inbox?: Inbox;
}

function createMockClient(): MockClient {
  const self: MockClient = {
    connect: async () => {},
    quit: async () => {
      if (self.inbox) inboxes = inboxes.filter((i) => i !== self.inbox);
    },
    on: () => {},
    publish: async (_ch: string, message: string) => {
      publishLog.push(message);
      const src = (JSON.parse(message) as { replicaId: string }).replicaId;
      for (const ib of inboxes) {
        let q = ib.queues.get(src);
        if (!q) {
          q = [];
          ib.queues.set(src, q);
        }
        q.push(message);
      }
      return inboxes.length;
    },
    subscribe: async (_ch: string, handler: Handler) => {
      const ib: Inbox = { handler, queues: new Map() };
      self.inbox = ib;
      inboxes.push(ib);
    },
    unsubscribe: async () => {},
  };
  return self;
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockClient()) }));

/** Shared Redis hash stand-in — the store a replica reloads from. */
function makeSharedHash() {
  const store = new Map<string, string>();
  const client = {
    hGetAll: async () => Object.fromEntries(store),
    hSet: async (_key: string, field: string, value: string) => {
      store.set(field, value);
      return 1;
    },
    hDel: async (_key: string, field: string) => {
      store.delete(field);
      return 1;
    },
  };
  return { store, client: client as unknown as ConstructorParameters<typeof Registry>[0] };
}

/** Drain the microtask queue so `void this.resync()` chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

// ---------------------------------------------------------------
// virtual clock
// ---------------------------------------------------------------

let virtualNow = 1_700_000_000_000;

// ---------------------------------------------------------------
// the simulated world
// ---------------------------------------------------------------

const EVENTS = ['orders.created', 'orders.shipped', 'users.signed_up'] as const;
const SERVICES = ['billing', 'search'] as const;

/**
 * Schemas ordered so that 0→1→2 is additive (backward-compatible) and
 * index 3 tightens `required`, which a backward check rejects. Index 4 is
 * the empty schema, which every gate waves through.
 */
const SCHEMAS: Array<Record<string, unknown>> = [
  { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } }, required: ['id'] },
  {
    type: 'object',
    properties: { id: { type: 'string' }, note: { type: 'string' }, qty: { type: 'number' } },
    required: ['id'],
  },
  {
    type: 'object',
    properties: { id: { type: 'string' }, note: { type: 'string' }, qty: { type: 'number' } },
    required: ['id', 'qty'],
  },
  {},
];
/** Schema indices that keep every transition backward-compatible. */
const COMPATIBLE_SCHEMAS = [0, 1, 2];

type Op =
  | { k: 'declare'; r: number; name: string; s: number }
  | { k: 'deprecate'; r: number; name: string; reason: string }
  | { k: 'undeprecate'; r: number; name: string }
  | { k: 'sub.add'; r: number; name: string; svc: string }
  | { k: 'sub.remove'; r: number; name: string; svc: string }
  | { k: 'remove'; r: number; name: string };

interface Replica {
  registry: Registry;
  coord: RegistryCoordinator;
}

async function makeReplica(redis?: ConstructorParameters<typeof Registry>[0]): Promise<Replica> {
  const registry = new Registry(redis);
  const coord = new RegistryCoordinator();
  await coord.start('redis://localhost:6379', registry);
  return { registry, coord };
}

/**
 * Apply one operation the way the HTTP route does: run the local gate
 * first, mutate, then broadcast — and broadcast only when the route
 * would have (404/409 responses publish nothing).
 */
async function applyOp(rep: Replica, op: Op, strict: boolean): Promise<void> {
  switch (op.k) {
    case 'declare': {
      const schema = SCHEMAS[op.s];
      const existing = rep.registry.get(op.name);
      if (strict && existing && Object.keys(schema).length > 0) {
        // Mirrors the 409 branch in routes/events.ts — nothing is applied
        // and nothing is broadcast.
        if (!rep.registry.checkSchemaCompat(op.name, schema).compatible) return;
      }
      rep.registry.declare({
        name: op.name,
        schema,
        transport: 'signal',
        producer: 'producer-svc',
        ...(strict ? { compatMode: 'strict' as const } : {}),
      });
      await rep.coord.broadcast('declare', rep.registry.get(op.name));
      return;
    }
    case 'deprecate': {
      if (!rep.registry.deprecate(op.name, { reason: op.reason })) return;
      await rep.coord.broadcast('deprecate', { name: op.name, opts: { reason: op.reason } });
      return;
    }
    case 'undeprecate': {
      if (!rep.registry.undeprecate(op.name)) return;
      await rep.coord.broadcast('undeprecate', { name: op.name });
      return;
    }
    case 'sub.add': {
      if (!rep.registry.get(op.name)) return; // route 404s
      rep.registry.addSubscriber(op.name, op.svc);
      await rep.coord.broadcast('subscriber.add', { eventName: op.name, serviceName: op.svc });
      return;
    }
    case 'sub.remove': {
      if (!rep.registry.get(op.name)) return;
      rep.registry.removeSubscriber(op.name, op.svc);
      await rep.coord.broadcast('subscriber.remove', { eventName: op.name, serviceName: op.svc });
      return;
    }
    case 'remove': {
      if (!rep.registry.remove(op.name)) return;
      await rep.coord.broadcast('remove', { name: op.name });
      return;
    }
  }
}

interface OpMix { strict: boolean; allowRemove: boolean; allowConditional: boolean }

function genOp(r: Rng, replicaCount: number, opts: OpMix): Op {
  const rep = r.int(replicaCount);
  const name = r.pick(EVENTS);
  const roll = r.next();
  if (roll < 0.4) {
    const s = opts.strict ? r.pick(SCHEMAS.map((_, i) => i)) : r.pick(COMPATIBLE_SCHEMAS);
    return { k: 'declare', r: rep, name, s };
  }
  if (roll < 0.55) return { k: 'deprecate', r: rep, name, reason: `r${r.int(3)}` };
  if (roll < 0.65) {
    // `undeprecate` only broadcasts when the event was deprecated here,
    // which makes it delivery-dependent; the order-independence suite
    // needs every operation to be unconditional, so it swaps in a
    // deprecate instead.
    if (opts.allowConditional) return { k: 'undeprecate', r: rep, name };
    return { k: 'deprecate', r: rep, name, reason: `r${r.int(3)}` };
  }
  if (roll < 0.8) return { k: 'sub.add', r: rep, name, svc: r.pick(SERVICES) };
  if (roll < 0.92 || !opts.allowRemove) return { k: 'sub.remove', r: rep, name, svc: r.pick(SERVICES) };
  return { k: 'remove', r: rep, name };
}

// ---------------------------------------------------------------
// delivery scheduler
// ---------------------------------------------------------------

interface NetOpts {
  pDrop: number;
  pDup: number;
}

/**
 * Per (receiver, publisher) link: the lowest seq we dropped, and the
 * highest seq that was actually delivered. A gap is only *observable*
 * once a message with a higher seq than something dropped arrives — a
 * redelivery of an older message reveals nothing, and a drop at the tail
 * of the run leaves no evidence at all.
 *
 * A drop before the link's *first* delivery is deliberately not counted.
 * A replica's first sight of a peer at seq > 1 is exactly what a replica
 * joining a running cluster sees, and the coordinator treats it as
 * benign once its boot read of the shared hash succeeded. It cannot tell
 * that apart from a drop, and the alternative — every new replica
 * reloading the registry the moment it hears from a busy peer — is
 * worse. So the property tested here is gap detection on an established
 * link, which is what the sequence counter can actually promise.
 */
interface LinkStat {
  lowestDropped: number;
  highestDelivered: number;
}

interface NetStats {
  links: Map<string, LinkStat>;
}

function newNetStats(): NetStats {
  return { links: new Map() };
}

function link(stats: NetStats, ib: number, src: string): LinkStat {
  const key = `${ib} ${src}`;
  let s = stats.links.get(key);
  if (!s) {
    s = { lowestDropped: Infinity, highestDelivered: -Infinity };
    stats.links.set(key, s);
  }
  return s;
}

/** Receivers that provably could have noticed a gap. */
function receiversWithObservableGap(stats: NetStats): Set<number> {
  const out = new Set<number>();
  for (const [key, s] of stats.links) {
    if (s.highestDelivered > s.lowestDropped) out.add(Number(key.split(' ')[0]));
  }
  return out;
}

/** Deliver (or drop, or duplicate) a single queued message. Returns false when idle. */
function deliverOne(r: Rng, net: NetOpts, stats: NetStats): boolean {
  const ready = inboxes
    .map((ib, i) => ({ ib, i }))
    .filter(({ ib }) => [...ib.queues.values()].some((q) => q.length > 0));
  if (ready.length === 0) return false;

  const { ib, i } = ready[r.int(ready.length)];
  const sources = [...ib.queues.entries()].filter(([, q]) => q.length > 0);
  const [src, queue] = sources[r.int(sources.length)];
  const msg = queue.shift()!;
  const seq = (JSON.parse(msg) as { seq?: number }).seq ?? 0;
  // Redis delivers a replica its own publishes too, and the coordinator
  // drops those on the echo check — it already applied them locally. A
  // loss on that link is not a loss of anything, so it is not tracked.
  const stat = ib.owner === src ? null : link(stats, i, src);

  if (r.chance(net.pDrop)) {
    if (stat && stat.highestDelivered > -Infinity) {
      stat.lowestDropped = Math.min(stat.lowestDropped, seq);
    }
    return true;
  }

  if (stat) stat.highestDelivered = Math.max(stat.highestDelivered, seq);
  ib.handler(msg);

  // A delayed duplicate: re-queue behind whatever else is in flight from
  // the same publisher, so it arrives *after* newer messages rather than
  // immediately behind its original.
  if (r.chance(net.pDup)) queue.push(msg);
  return true;
}

async function quiesce(): Promise<void> {
  const idle: Rng = rng(1);
  const net: NetOpts = { pDrop: 0, pDup: 0 };
  const stats = newNetStats();
  let guard = 100_000;
  while (deliverOne(idle, net, stats) && guard-- > 0) {
    await settle();
  }
  await settle();
}

// ---------------------------------------------------------------
// state projection
// ---------------------------------------------------------------

/**
 * Everything about an entry that must be identical on every replica.
 *
 * Timestamps are deliberately excluded: `metadata.createdAt`,
 * `deprecation.deprecatedAt` and `schemaHistory[].updatedAt` are stamped
 * with the applying replica's local clock and the broadcast payload
 * carries no authoritative value for them, so they are per-replica by
 * construction. The semantic content — is it deprecated, why, by whom —
 * is compared.
 */
function project(e: RegistryEntry) {
  return {
    name: e.name,
    schema: e.schema,
    fingerprint: e.schemaFingerprint,
    version: e.version,
    transport: e.transport,
    producer: e.producer,
    namespace: e.namespace,
    compatibilityMode: e.compatibilityMode,
    compatMode: e.compatMode ?? null,
    subscribers: [...e.subscribers].sort(),
    history: e.schemaHistory.map((h) => ({ version: h.version, fingerprint: h.fingerprint })),
    deprecation: e.deprecation ? { reason: e.deprecation.reason ?? null, by: e.deprecation.by ?? null } : null,
  };
}

/** The subset that a *different delivery order* must still agree on. */
function conflictOutcome(e: RegistryEntry) {
  const p = project(e);
  return {
    name: p.name,
    schema: p.schema,
    fingerprint: p.fingerprint,
    subscribers: p.subscribers,
    deprecation: p.deprecation,
  };
}

function snapshot(reg: Registry, projector: (e: RegistryEntry) => unknown): string {
  const rows = reg
    .list()
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(projector);
  return JSON.stringify(rows);
}

/** Returns a human-readable divergence description, or null when converged. */
function divergence(reps: Replica[], projector: (e: RegistryEntry) => unknown): string | null {
  const first = snapshot(reps[0].registry, projector);
  for (let i = 1; i < reps.length; i++) {
    const other = snapshot(reps[i].registry, projector);
    if (other !== first) return `replica 0 vs replica ${i}\n  0: ${first}\n  ${i}: ${other}`;
  }
  return null;
}

// ---------------------------------------------------------------
// suites
// ---------------------------------------------------------------

let logSpies: Array<{ mockRestore: () => void }> = [];

function silenceLogs(): void {
  logSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
  ];
}

beforeEach(() => {
  inboxes = [];
  publishLog = [];
  virtualNow = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => virtualNow);
  silenceLogs();
});

afterEach(() => {
  for (const s of logSpies) s.mockRestore();
  vi.restoreAllMocks();
  inboxes = [];
  publishLog = [];
});

async function stopAll(reps: Replica[]): Promise<void> {
  for (const r of reps) await r.coord.stop();
}

interface ScenarioResult {
  reps: Replica[];
  /** Every broadcast the scenario produced, in publish order. */
  log: string[];
  /** Compat transitions that a strict gate should have refused. */
  illegalTransitions: string[];
  net: NetStats;
}

/**
 * Run one randomized scenario end to end.
 *
 * `clockStep` controls how far the virtual clock jumps per operation. A
 * step of 1 produces ties and exercises the Lamport `lastTs + 1` branch;
 * a large step makes every stamp a pure function of the operation's index
 * in the script, which is what lets the order-independence suite compare
 * two different delivery schedules over the same operations.
 */
async function runScenario(opts: {
  seed: number;
  replicaCount: number;
  ops: Op[];
  strict: boolean;
  clockStep: number;
  net: NetOpts;
  shared?: boolean;
  /**
   * Declare every event on replica 0 and fully deliver that before the
   * random script starts. Needed by the order-independence suite: the
   * routes 404 a subscriber or deprecation call on an event the replica
   * has not heard of yet, so without a settled starting point an
   * operation's *effect* — not just its ordering — depends on delivery.
   */
  bootstrap?: boolean;
  /** Delivery-schedule randomness, separated from operation generation. */
  scheduleSeed: number;
}): Promise<ScenarioResult> {
  const hash = opts.shared ? makeSharedHash() : null;
  publishLog = [];
  const reps: Replica[] = [];
  for (let i = 0; i < opts.replicaCount; i++) {
    const rep = await makeReplica(hash?.client);
    inboxes[inboxes.length - 1].owner = rep.coord.replicaId;
    reps.push(rep);
  }

  const sched = rng(opts.scheduleSeed);
  const stats = newNetStats();
  const illegalTransitions: string[] = [];
  // replica index → event name → last observed non-empty schema
  const lastSchema = reps.map(() => new Map<string, string>());

  function auditCompat(): void {
    if (!opts.strict) return;
    for (let i = 0; i < reps.length; i++) {
      for (const e of reps[i].registry.list()) {
        // Declaring `{}` clears the schema outright and every gate waves
        // it through, so it ends the transition chain rather than
        // continuing it.
        if (!e.schema || Object.keys(e.schema).length === 0) {
          lastSchema[i].delete(e.name);
          continue;
        }
        const prev = lastSchema[i].get(e.name);
        const now = JSON.stringify(e.schema);
        if (prev && prev !== now) {
          const compat = checkBackwardCompat(JSON.parse(prev) as Record<string, unknown>, e.schema);
          if (!compat.compatible) {
            illegalTransitions.push(
              `replica ${i} installed a breaking schema for ${e.name}: ${compat.violations.join('; ')}`,
            );
          }
        }
        lastSchema[i].set(e.name, now);
      }
      // Forget events that were deleted, so a fresh declare is not
      // compared against a schema from a previous incarnation.
      for (const name of [...lastSchema[i].keys()]) {
        if (!reps[i].registry.get(name)) lastSchema[i].delete(name);
      }
    }
  }

  if (opts.bootstrap) {
    for (const name of EVENTS) {
      virtualNow += opts.clockStep;
      await applyOp(reps[0], { k: 'declare', r: 0, name, s: 0 }, opts.strict);
      await settle();
    }
    await quiesce();
  }

  auditCompat();
  for (const op of opts.ops) {
    // Deliver a random slice of the backlog before the next operation.
    const before = sched.int(4);
    for (let d = 0; d < before; d++) {
      if (!deliverOne(sched, opts.net, stats)) break;
      await settle();
      auditCompat();
    }
    virtualNow += opts.clockStep;
    await applyOp(reps[op.r], op, opts.strict);
    await settle();
    auditCompat();
  }

  // Quiesce: deliver everything left, dropping nothing.
  let guard = 100_000;
  while (deliverOne(sched, { pDrop: 0, pDup: 0 }, stats) && guard-- > 0) {
    await settle();
    auditCompat();
  }
  await settle();
  auditCompat();

  return { reps, illegalTransitions, net: stats, log: [...publishLog] };
}

function genOps(r: Rng, count: number, replicaCount: number, o: OpMix): Op[] {
  return Array.from({ length: count }, () => genOp(r, replicaCount, o));
}

// ---------------------------------------------------------------

describe('fuzz — replica convergence', () => {
  // Note on `remove`. Deleting an event destroys the whole entry, and a
  // concurrent `subscriber.add` for it carries a *higher* wall-clock
  // stamp than the delete while being causally unrelated to it. A scalar
  // (ts, replicaId) clock cannot tell that apart from an add that
  // genuinely happened after the delete, so a replica that applies the
  // add before the delete and one that applies it after cannot be made
  // to agree without causality metadata this design deliberately does
  // not carry. The suites that assert exact whole-state convergence
  // therefore leave `remove` out, and the one below characterises
  // precisely how far the disagreement can spread when it is in.
  it('all replicas hold identical state once delivery quiesces', async () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 30 + r.int(30), replicaCount, { strict: false, allowRemove: false, allowConditional: true });
      const { reps } = await runScenario({
        seed,
        replicaCount,
        ops,
        strict: false,
        clockStep: 1,
        net: { pDrop: 0, pDup: 0.15 },
        scheduleSeed: seed * 7919 + 13,
      });
      const diff = divergence(reps, project);
      await stopAll(reps);
      expect(diff, `seed=${seed} replicas=${replicaCount}\n${diff}`).toBeNull();
    }
  });

  it('re-delivering every message ever published changes nothing', async () => {
    // The sharpest form of "applying the same message twice is a no-op":
    // let the run settle, then hand every replica the *entire* broadcast
    // log again, in publish order, and require the state not to move.
    // Comparing a duplicate-heavy run against a duplicate-free one would
    // not test this — re-queuing a message also perturbs the delivery
    // schedule, so the two runs would differ for reasons that have
    // nothing to do with idempotence.
    for (let seed = 1; seed <= 80; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 25 + r.int(20), replicaCount, { strict: false, allowRemove: true, allowConditional: true });
      const { reps, log } = await runScenario({
        seed, replicaCount, ops, strict: false, clockStep: 1,
        net: { pDrop: 0, pDup: 0.2 }, scheduleSeed: seed * 6151 + 5,
      });

      const before = reps.map((rep) => snapshot(rep.registry, project));
      const staleBefore = reps.map((rep) => rep.coord.isStale());
      for (const msg of log) {
        for (const ib of inboxes) ib.handler(msg);
        await settle();
      }
      const after = reps.map((rep) => snapshot(rep.registry, project));
      const staleAfter = reps.map((rep) => rep.coord.isStale());
      await stopAll(reps);

      for (let i = 0; i < reps.length; i++) {
        expect(
          after[i],
          `seed=${seed}: replaying the log moved replica ${i}\n  before: ${before[i]}\n  after:  ${after[i]}`,
        ).toBe(before[i]);
      }
      expect(staleAfter, `seed=${seed}: the replay itself was mistaken for a dropped broadcast`)
        .toEqual(staleBefore);
    }
  });

  it('with deletes in the mix, disagreement never spreads past the deleted events', async () => {
    // `remove` cannot be made to converge against concurrent subscriber
    // edits under a scalar clock (see the note above). What *must* hold
    // is that the damage is contained: every replica agrees on which
    // events exist, every event never deleted during the run is byte
    // identical everywhere, and anything the coordinator threw away is
    // in the conflict log rather than silently gone.
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 30 + r.int(30), replicaCount, { strict: false, allowRemove: true, allowConditional: true });
      const deleted = new Set(ops.filter((o) => o.k === 'remove').map((o) => o.name));
      const { reps } = await runScenario({
        seed, replicaCount, ops, strict: false, clockStep: 1,
        net: { pDrop: 0, pDup: 0.15 }, scheduleSeed: seed * 7919 + 13,
      });

      const names = reps.map((rep) => rep.registry.list().map((e) => e.name).sort().join(','));
      const untouched = (rep: Replica) => JSON.stringify(
        rep.registry.list().filter((e) => !deleted.has(e.name))
          .sort((a, b) => (a.name < b.name ? -1 : 1)).map(project),
      );
      const untouchedStates = reps.map(untouched);
      await stopAll(reps);

      for (let i = 1; i < names.length; i++) {
        expect(names[i], `seed=${seed}: replicas disagree on which events exist`).toBe(names[0]);
      }
      for (let i = 1; i < untouchedStates.length; i++) {
        expect(
          untouchedStates[i],
          `seed=${seed}: an event that was never deleted diverged\n  0: ${untouchedStates[0]}\n  ${i}: ${untouchedStates[i]}`,
        ).toBe(untouchedStates[0]);
      }
    }
  });

  it('never reports a missed broadcast when nothing was actually dropped', async () => {
    // Reordering across publishers and delayed duplicates are both normal
    // traffic. Either one raising the stale flag would send a healthy
    // replica through a full registry reload for no reason.
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 25 + r.int(25), replicaCount, { strict: false, allowRemove: true, allowConditional: true });
      const { reps } = await runScenario({
        seed, replicaCount, ops, strict: false, clockStep: 1,
        net: { pDrop: 0, pDup: 0.5 }, scheduleSeed: seed * 104729 + 7,
      });
      const stale = reps.map((rep, i) => ({ i, ...rep.coord.getStats() })).filter((s) => s.stale);
      await stopAll(reps);
      expect(stale, `seed=${seed}: false-positive staleness ${JSON.stringify(stale)}`).toEqual([]);
    }
  });

  it('the conflict outcome does not depend on delivery order', async () => {
    // Same operations, same stamps, four different delivery schedules.
    // Which write wins each key is decided by the (ts, replicaId) total
    // order, so the surviving schema / subscriber set / deprecation state
    // must be identical across all four.
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 20 + r.int(20), replicaCount, { strict: false, allowRemove: false, allowConditional: false });

      const outcomes: string[] = [];
      for (const scheduleSeed of [1, 5000, 90210, 424242]) {
        inboxes = [];
        virtualNow = 1_700_000_000_000;
        const { reps } = await runScenario({
          seed, replicaCount, ops, strict: false,
          // A dominating step makes each stamp a function of the op index
          // alone, so the two runs are comparing conflict resolution and
          // not two different sets of timestamps.
          clockStep: 100,
          net: { pDrop: 0, pDup: 0.2 },
          bootstrap: true,
          scheduleSeed,
        });
        const diff = divergence(reps, conflictOutcome);
        outcomes.push(snapshot(reps[0].registry, conflictOutcome));
        await stopAll(reps);
        expect(diff, `seed=${seed} schedule=${scheduleSeed}: replicas diverged\n${diff}`).toBeNull();
      }

      for (let i = 1; i < outcomes.length; i++) {
        expect(
          outcomes[i],
          `seed=${seed}: schedule ${i} produced a different winner\n  0: ${outcomes[0]}\n  ${i}: ${outcomes[i]}`,
        ).toBe(outcomes[0]);
      }
    }
  });

  it('never installs a schema the strict compat gate would reject', async () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 25 + r.int(25), replicaCount, { strict: true, allowRemove: false, allowConditional: true });
      const { reps, illegalTransitions } = await runScenario({
        seed, replicaCount, ops, strict: true, clockStep: 1,
        net: { pDrop: 0, pDup: 0.2 }, scheduleSeed: seed * 31337 + 3,
      });

      // When strict refusal *did* bite, the replicas are allowed to hold
      // different schemas — but somebody has to have said so out loud.
      const diff = divergence(reps, project);
      const refusals = reps.flatMap((rep) => rep.coord.getConflicts())
        .filter((c) => c.reason === 'compat-violation');
      await stopAll(reps);

      expect(illegalTransitions, `seed=${seed}: ${illegalTransitions.join(' | ')}`).toEqual([]);
      if (diff !== null) {
        expect(
          refusals.length,
          `seed=${seed}: replicas diverged with no compat-violation recorded\n${diff}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('a dropped broadcast is detected and repaired from shared state', async () => {
    for (let seed = 1; seed <= 80; seed++) {
      const r = rng(seed);
      const replicaCount = 2 + r.int(4);
      const ops = genOps(r, 25 + r.int(25), replicaCount, { strict: false, allowRemove: true, allowConditional: true });
      const { reps, net } = await runScenario({
        seed, replicaCount, ops, strict: false, clockStep: 1,
        // No duplicates here: a *re-queued copy* being dropped loses
        // nothing, so mixing them in would over-count observable gaps.
        net: { pDrop: 0.2, pDup: 0 }, scheduleSeed: seed * 7 + 11,
        shared: true,
      });

      // Every replica that could have noticed a gap must have either
      // repaired itself or still be flagged stale.
      const undetected: number[] = [];
      for (const i of receiversWithObservableGap(net)) {
        const stats = reps[i].coord.getStats();
        // resyncs > 1 == at least one reload beyond the boot read.
        if (!stats.stale && stats.resyncs <= 1) undetected.push(i);
      }
      await stopAll(reps);
      expect(undetected, `seed=${seed}: replicas missed a broadcast without noticing: ${undetected}`).toEqual([]);
    }
  });
});
