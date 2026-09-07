/**
 * RegistryCoordinator — multi-replica convergence via Redis pub/sub.
 *
 * Every catalog server instance broadcasts mutations (declare, deprecate,
 * subscriber-add, etc.) to the `event-catalog:mutations` channel. All
 * other replicas receive the message and apply it to their in-process
 * registry, converging within the Redis pub/sub latency (~1ms LAN).
 *
 * Reads are always served from the local in-process map — no Redis hop.
 * A replica ignores its own broadcasts via the per-process replicaId.
 *
 * Correctness properties (see tests/replica-convergence.test.ts):
 *
 *  1. **Convergence.** Every mutation carries a Lamport-ish stamp
 *     `(ts, replicaId)` scoped to the thing it mutates (the event, its
 *     deprecation flag, or one subscriber edge). A replica applies an
 *     incoming mutation only when its stamp is strictly greater than the
 *     stamp it last applied to that key, comparing `ts` first and
 *     breaking ties on `replicaId`. Because the comparison is total and
 *     identical on every replica, concurrent writes to the same key
 *     settle on the same winner everywhere instead of each replica
 *     ending up holding the *other's* value.
 *
 *  2. **Ordering.** The same stamp rule makes re-ordered pairs
 *     (subscriber remove-before-add, undeprecate-before-deprecate)
 *     commutative. A mutation for an event this replica has never seen
 *     is parked in a small bounded buffer and replayed when that
 *     event's declare arrives, rather than being silently dropped.
 *
 *  3. **The compat gate.** A replicated declare runs the same
 *     schema-evolution check the HTTP route runs. Under strict
 *     enforcement a breaking replicated declare is refused and recorded
 *     as a conflict — replication can no longer install a schema the
 *     HTTP path would have rejected.
 *
 *  4. **Missed broadcasts.** Each replica numbers its own broadcasts.
 *     A gap in a peer's sequence means pub/sub dropped something (no
 *     replay, no delivery guarantee), so the replica marks itself stale
 *     and reloads the full registry from the shared Redis hash. `stale`
 *     stays set if that reload is impossible, so health can surface it
 *     instead of the replica serving a truncated registry as healthy.
 *     What is tracked is a *high-water mark*, not the last seq seen: a
 *     redelivery carries a lower number and must not look like a gap.
 *
 * Fire-and-forget: broadcast failures are logged but never propagate.
 *
 * Known limits (see tests/fuzz-replica-convergence.test.ts, which
 * generates the interleavings rather than enumerating them):
 *
 *  - **Deletes do not fully converge.** `remove` destroys the whole
 *    entry, and a `subscriber.add` made concurrently with it carries a
 *    *higher* wall-clock stamp while being causally unrelated. A scalar
 *    (ts, replicaId) clock cannot tell that apart from an add that
 *    genuinely followed the delete, so a replica that applied the add
 *    first and one that applied the delete first can end up disagreeing
 *    about that event's subscriber list. The tombstone below contains
 *    it: the disagreement stays inside the deleted event and never
 *    spreads to events that were never removed. Closing it properly
 *    needs causality metadata (a version vector) this design does not
 *    carry.
 *
 *  - **A gap on first contact with a peer is invisible.** A replica's
 *    first sight of a peer at seq > 1 looks identical whether messages
 *    were dropped or the peer was simply already running when we
 *    joined. Once the boot read of the shared hash has succeeded the
 *    benign reading is assumed, because the alternative is every new
 *    replica reloading the registry the instant it hears a busy peer.
 *
 *  - **Timestamps are per-replica.** `metadata.createdAt`,
 *    `deprecation.deprecatedAt` and `schemaHistory[].updatedAt` are
 *    stamped by whichever replica applied the mutation. The broadcast
 *    payload carries no authoritative value for the first two, so they
 *    differ between replicas by construction. The semantic content does
 *    not.
 */

import { createClient } from 'redis';
import {
  createBootBoundedReconnectStrategy,
  formatRedisError,
} from '../utils/redis-boot-strategy.js';
import type { Registry } from '../registry/index.js';
import type { EventDeclaration, RegistryEntry } from '../types/index.js';
import { LogThrottle } from '../utils/bounded.js';
import { LogWriter, type CatalogLogger, errorMessage } from '../utils/logger.js';

export const MUTATIONS_CHANNEL = 'event-catalog:mutations';

/** Cap on stamps retained. Bounded so a churning registry can't leak. */
const MAX_STAMPS = 20_000;
/** Cap on mutations parked waiting for their declare. */
const MAX_PENDING = 500;
/** How long a parked mutation waits for its declare before being dropped. */
const PENDING_TTL_MS = 60_000;
/** Ring size for the operator-visible conflict log. */
const MAX_CONFLICTS = 50;

export type MutationKind =
  | 'declare'
  | 'deprecate'
  | 'undeprecate'
  | 'subscriber.add'
  | 'subscriber.remove'
  | 'remove';

export interface MutationMessage {
  replicaId: string;
  kind: MutationKind;
  payload: unknown;
  /** Per-replica monotonic broadcast counter — used for gap detection. */
  seq?: number;
  /** Strictly-increasing local clock; the primary ordering key. */
  ts?: number;
}

export type ConflictReason =
  | 'stale-write'
  | 'compat-violation'
  | 'pending-expired';

export interface ReplicationConflict {
  at: string;
  reason: ConflictReason;
  kind: MutationKind;
  key: string;
  fromReplica: string;
  detail?: string;
}

interface Stamp {
  ts: number;
  replicaId: string;
  /**
   * Set on the `evt\0<name>` key when the write that produced this stamp
   * was a `remove`. It is a tombstone: it says the event is not merely
   * unknown here, it was deliberately destroyed, which is a different
   * answer to "should I park this subscriber edit and wait?". A later
   * declare overwrites the stamp and clears it.
   */
  removed?: boolean;
}

interface PendingMutation {
  mutation: MutationMessage;
  parkedAt: number;
}

type RedisClient = ReturnType<typeof createClient>;

/**
 * Total order over stamps: later `ts` wins, ties break on `replicaId`.
 * Identical on every replica, which is what makes concurrent writes
 * converge rather than mirror.
 */
function compareStamps(a: Stamp, b: Stamp): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
  if (a.replicaId === b.replicaId) return 0;
  return a.replicaId < b.replicaId ? -1 : 1;
}

/**
 * The conflict domain a mutation belongs to. Mutations sharing a key
 * are ordered against each other; mutations on different keys are
 * independent and never block one another.
 *
 * `declare` and `remove` share the event key (a remove must be able to
 * beat a stale declare). Deprecation and each subscriber edge get their
 * own key so an unrelated schema update never masks them.
 */
function conflictKey(kind: MutationKind, payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object') return null;
  switch (kind) {
    case 'declare':
    case 'remove':
      return typeof p.name === 'string' ? `evt\x00${p.name}` : null;
    case 'deprecate':
    case 'undeprecate':
      return typeof p.name === 'string' ? `dep\x00${p.name}` : null;
    case 'subscriber.add':
    case 'subscriber.remove':
      return typeof p.eventName === 'string' && typeof p.serviceName === 'string'
        ? `sub\x00${p.eventName}\x00${p.serviceName}`
        : null;
    default:
      return null;
  }
}

/** The event name a mutation targets, for the parked-mutation buffer. */
function targetEvent(kind: MutationKind, payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object') return null;
  if (kind === 'subscriber.add' || kind === 'subscriber.remove') {
    return typeof p.eventName === 'string' ? p.eventName : null;
  }
  return typeof p.name === 'string' ? p.name : null;
}

/**
 * Rate ceiling on the coordinator's diagnostics.
 *
 * Everything below the `start()` banner is on a message path: a Redis
 * client error re-fires on every reconnect attempt, and `receive` /
 * `applyMutation` run once per broadcast from every peer — which for a
 * peer running a build that emits malformed payloads is one line per
 * mutation, cluster-wide, forever. Keyed by failure shape so a broken
 * `declare` and a broken `subscriber.add` are both visible.
 */
const COORDINATOR_LOG_WINDOW_MS = 60_000;
const COORDINATOR_LOGS_PER_WINDOW = 8;

export class RegistryCoordinator {
  readonly replicaId: string = crypto.randomUUID();
  private readonly log: LogWriter;
  private readonly warnings = new LogThrottle({
    keyIntervalMs: COORDINATOR_LOG_WINDOW_MS,
    maxPerWindow: COORDINATOR_LOGS_PER_WINDOW,
    maxKeys: 128,
  });

  /**
   * @param logger diagnostics sink; omitted, every line below goes to
   *   `console.warn` / `console.log` exactly as before.
   */
  constructor(logger?: CatalogLogger) {
    this.log = new LogWriter(logger);
  }

  /**
   * Emit one throttled warning, tagged with this replica's id.
   *
   * The suppressed-count suffix is inserted *before* a trailing colon so
   * a line whose detail is passed as a second console argument still
   * reads `… failed (+3 similar suppressed): detail`. With nothing
   * suppressed the suffix is empty and the message is byte-identical to
   * what the call site emitted before it was throttled.
   */
  private warn(key: string, message: string, fields: Record<string, unknown>, ...tail: unknown[]): void {
    const suppressed = this.warnings.attempt(key);
    if (suppressed === null) return;
    const suffix = LogThrottle.suffix(suppressed);
    const text = message.endsWith(':')
      ? message.slice(0, -1) + suffix + ':'
      : message + suffix;
    this.log.warn(
      text,
      { component: 'registry-coordinator', replicaId: this.replicaId, ...fields, suppressed },
      ...tail,
    );
  }

  private pubClient: RedisClient | null = null;
  private subClient: RedisClient | null = null;
  private _started = false;

  /** Our own broadcast counter, so peers can spot a gap. */
  private seq = 0;
  /** Strictly-increasing stamp clock — never repeats within a replica. */
  private lastTs = 0;
  /** Last seq observed per peer replica; a jump means messages were lost. */
  private peerSeq = new Map<string, number>();
  /** Last applied stamp per conflict key. */
  private stamps = new Map<string, Stamp>();
  /** Mutations waiting for the declare of an event we haven't seen yet. */
  private pending: PendingMutation[] = [];
  private conflicts: ReplicationConflict[] = [];
  private _stale = false;
  private _resyncs = 0;
  /** True once a full-state read from shared storage has succeeded. */
  private bootSynced = false;
  private registry: Registry | null = null;

  get started(): boolean { return this._started; }

  /**
   * True when this replica is known to have missed at least one
   * broadcast and has not been able to repair itself from shared
   * state. A stale replica is serving a registry that may be missing
   * or holding outdated declarations.
   */
  isStale(): boolean { return this._stale; }

  /** Recent replication conflicts, newest last. For health/admin surfaces. */
  getConflicts(): ReplicationConflict[] { return [...this.conflicts]; }

  getStats(): { replicaId: string; stale: boolean; resyncs: number; pending: number; conflicts: number } {
    return {
      replicaId: this.replicaId,
      stale: this._stale,
      resyncs: this._resyncs,
      pending: this.pending.length,
      conflicts: this.conflicts.length,
    };
  }

  async start(redisUrl: string, registry: Registry): Promise<void> {
    if (this._started) return;
    this._started = true;
    this.registry = registry;

    // Boot-bounded reconnect — start() is fire-and-forget from createServer(),
    // so an unbounded first-connect retry would spin forever in the background
    // logging noise instead of failing once into the caller's catch.
    const pubBootStrategy = createBootBoundedReconnectStrategy({ label: 'coordinator pub' });
    const subBootStrategy = createBootBoundedReconnectStrategy({ label: 'coordinator sub' });

    this.pubClient = createClient({
      url: redisUrl,
      socket: { reconnectStrategy: pubBootStrategy.reconnectStrategy },
    });
    this.subClient = createClient({
      url: redisUrl,
      socket: { reconnectStrategy: subBootStrategy.reconnectStrategy },
    });

    this.pubClient.on('error', (err: Error) =>
      this.warnRedisClient('pub', err),
    );
    this.subClient.on('error', (err: Error) =>
      this.warnRedisClient('sub', err),
    );

    // A reconnect means the subscription was down for some interval and
    // pub/sub has no replay, so anything published in that window is
    // gone. Treat it exactly like a detected sequence gap.
    this.subClient.on('ready', () => {
      if (this.peerSeq.size > 0 || this._resyncs > 0) {
        this.markStale('sub client reconnected — messages during the outage are unrecoverable');
      }
    });

    await Promise.all([
      this.pubClient.connect().then(() => pubBootStrategy.markConnected()),
      this.subClient.connect().then(() => subBootStrategy.markConnected()),
    ]);

    await (this.subClient as unknown as {
      subscribe(ch: string, cb: (msg: string) => void): Promise<void>;
    }).subscribe(MUTATIONS_CHANNEL, (message: string) => {
      let mutation: MutationMessage;
      try { mutation = JSON.parse(message) as MutationMessage; } catch { return; }
      // Skip our own broadcasts — already applied locally.
      if (mutation.replicaId === this.replicaId) return;
      this.observeTs(mutation.ts);
      this.trackSequence(mutation);
      this.receive(mutation, registry);
    });

    // Boot into an existing cluster: the subscription is live *before*
    // the full-state read, so nothing published during the read is
    // missed — it either lands in the snapshot or arrives as a
    // broadcast we apply on top of it.
    await this.resync('boot');

    this.log.info(
      `[registry-coordinator] replica ${this.replicaId.slice(0, 8)} subscribed to ${MUTATIONS_CHANNEL}`,
      {
        component: 'registry-coordinator',
        replicaId: this.replicaId,
        channel: MUTATIONS_CHANNEL,
        action: 'subscribed',
      },
    );
  }

  /**
   * Redis client errors arrive once per failed reconnect attempt on each
   * of the two clients, so they are throttled per role. The message keeps
   * its two-argument console shape.
   */
  private warnRedisClient(role: 'pub' | 'sub', err: Error): void {
    const detail = formatRedisError(err);
    const suppressed = this.warnings.attempt(`client:${role}`);
    if (suppressed === null) return;
    this.log.warn(
      `[registry-coordinator] ${role} client error` + LogThrottle.suffix(suppressed) + ':',
      {
        component: 'registry-coordinator',
        replicaId: this.replicaId,
        role,
        error: detail,
        suppressed,
      },
      detail,
    );
  }

  async stop(): Promise<void> {
    await Promise.allSettled([
      this.subClient?.quit(),
      this.pubClient?.quit(),
    ]);
    this.pubClient = null;
    this.subClient = null;
    this.registry = null;
    this._started = false;
  }

  /** Publish a mutation to all peer replicas. Never throws. */
  async broadcast(kind: MutationKind, payload: unknown): Promise<void> {
    if (!this.pubClient) return;

    // Stamp our own write first. The local registry has already applied
    // it, so recording the stamp here is what lets us reject a peer's
    // concurrent write that loses the tie-break.
    const ts = this.nextTs();
    const key = conflictKey(kind, payload);
    if (key) {
      this.setStamp(key, {
        ts,
        replicaId: this.replicaId,
        ...(kind === 'remove' ? { removed: true } : {}),
      });
    }
    // A local delete destroys the entry and everything hanging off it,
    // so anything we parked waiting for that event is now unreplayable.
    if (kind === 'remove') this.purgePending(targetEvent(kind, payload));

    const msg: MutationMessage = {
      replicaId: this.replicaId,
      kind,
      payload,
      seq: ++this.seq,
      ts,
    };
    try {
      await (this.pubClient as unknown as {
        publish(ch: string, msg: string): Promise<number>;
      }).publish(MUTATIONS_CHANNEL, JSON.stringify(msg));
    } catch (err) {
      this.warn(
        'broadcast',
        '[registry-coordinator] broadcast failed:',
        { action: 'broadcast', kind, error: errorMessage(err) },
        (err as Error).message,
      );
    }
  }

  /**
   * Reload the whole registry from the shared Redis hash. This is the
   * only repair path for a replica that missed broadcasts — pub/sub
   * itself offers no replay. Returns false when the registry has no
   * Redis backing, in which case the replica stays marked stale.
   */
  async resync(cause: string): Promise<boolean> {
    const registry = this.registry;
    if (!registry) return false;
    try {
      const ok = await registry.reload();
      if (!ok) return false;
      this.bootSynced = true;
      this._resyncs++;
      this._stale = false;
      // Applied state came wholesale from shared storage; the stamps we
      // were holding describe a history that snapshot supersedes.
      this.stamps.clear();
      this.pending = [];
      if (cause !== 'boot') {
        this.warn(
          'resynced',
          `[registry-coordinator] resynced from shared registry (${cause})`,
          { action: 'resync', status: 'recovered', cause, resyncs: this._resyncs },
        );
      }
      return true;
    } catch (err) {
      this.warn(
        'resync-failed',
        '[registry-coordinator] resync failed:',
        { action: 'resync', status: 'failed', cause, error: errorMessage(err) },
        (err as Error).message,
      );
      return false;
    }
  }

  // ---------------------------------------------------------------
  // receive path
  // ---------------------------------------------------------------

  /**
   * Lamport clock. Wall time alone is not enough: two replicas writing
   * in the same millisecond would tie and fall through to the replicaId
   * tie-break, which can hand the win to a write that *causally
   * preceded* the other. Advancing our clock past every stamp we
   * observe means a write made after seeing a peer's write always
   * carries a strictly greater stamp.
   */
  private nextTs(): number {
    const now = Date.now();
    this.lastTs = now > this.lastTs ? now : this.lastTs + 1;
    return this.lastTs;
  }

  private observeTs(ts: number | undefined): void {
    if (typeof ts === 'number' && ts > this.lastTs) this.lastTs = ts;
  }

  private setStamp(key: string, stamp: Stamp): void {
    if (this.stamps.size >= MAX_STAMPS && !this.stamps.has(key)) {
      // Map preserves insertion order — drop the oldest entries. Losing
      // a stamp is safe (it degrades to last-write-wins for that key),
      // so a hard bound is preferable to unbounded growth.
      const oldest = this.stamps.keys().next();
      if (!oldest.done) this.stamps.delete(oldest.value);
    }
    this.stamps.set(key, stamp);
  }

  /**
   * Detect dropped messages. Redis pub/sub has no delivery guarantee
   * and no replay, so a gap in a peer's monotonic seq is the only
   * evidence we get that our registry is now incomplete.
   */
  private trackSequence(mutation: MutationMessage): void {
    if (typeof mutation.seq !== 'number') return;
    const prev = this.peerSeq.get(mutation.replicaId);
    if (prev === undefined) {
      this.peerSeq.set(mutation.replicaId, mutation.seq);
      // First contact with this peer. seq is 1-based, so anything above
      // 1 means the peer published before we started listening. That is
      // only benign if our boot read of the shared registry covered it —
      // without shared storage there is nothing that could have.
      if (mutation.seq > 1 && !this.bootSynced) {
        this.markStale(
          `first message from replica ${mutation.replicaId.slice(0, 8)} is seq ${mutation.seq}`
          + ' — earlier broadcasts were never received and there is no shared state to read',
        );
      }
      return;
    }
    // What we hold is a *high-water mark*, not "the last seq seen". A
    // redelivery or a message that overtook a newer one carries a seq at
    // or below it and must leave it alone: writing the lower value back
    // would make the next in-order message look like a gap and send a
    // perfectly healthy replica through a full registry reload.
    if (mutation.seq <= prev) return; // duplicate/reorder — stamps handle it
    this.peerSeq.set(mutation.replicaId, mutation.seq);
    if (mutation.seq === prev + 1) return; // in order
    this.markStale(
      `missed ${mutation.seq - prev - 1} broadcast(s) from replica ${mutation.replicaId.slice(0, 8)}`,
    );
  }

  private markStale(detail: string): void {
    // Guarded on the stale latch, so this is one line per healthy→stale
    // transition rather than one per missed broadcast.
    if (!this._stale) {
      this.log.warn(`[registry-coordinator] stale: ${detail}`, {
        component: 'registry-coordinator',
        replicaId: this.replicaId,
        status: 'stale',
        detail,
      });
    }
    this._stale = true;
    // Best-effort self-repair from the shared registry hash.
    void this.resync(detail);
  }

  private recordConflict(c: Omit<ReplicationConflict, 'at'>): void {
    this.conflicts.push({ at: new Date().toISOString(), ...c });
    if (this.conflicts.length > MAX_CONFLICTS) {
      this.conflicts = this.conflicts.slice(-MAX_CONFLICTS);
    }
  }

  /** Full receive pipeline: order → gate → apply → drain parked. */
  private receive(mutation: MutationMessage, registry: Registry): void {
    const key = conflictKey(mutation.kind, mutation.payload);
    if (key === null) {
      // Unknown kind, or a payload missing the fields that identify what
      // it mutates. Nothing safe to do with it.
      if (!isKnownKind(mutation.kind)) {
        this.warn(
          `unknown-kind:${String(mutation.kind)}`,
          '[registry-coordinator] unknown mutation kind:',
          { action: 'receive', kind: mutation.kind, fromReplica: mutation.replicaId },
          mutation.kind,
        );
      } else {
        this.warn(
          `malformed:${String(mutation.kind)}`,
          '[registry-coordinator] malformed mutation payload:',
          { action: 'receive', kind: mutation.kind, fromReplica: mutation.replicaId },
          mutation.kind,
        );
      }
      return;
    }

    // A peer running a build that predates stamping sends no `ts`. Its
    // messages cannot be ordered against ours, and dropping them would
    // be worse than the arrival-order behaviour they were written for,
    // so apply them as-is and leave the stamp untouched. Only relevant
    // during a rolling upgrade.
    const incoming: Stamp | null = typeof mutation.ts === 'number'
      ? { ts: mutation.ts, replicaId: mutation.replicaId }
      : null;

    const held = incoming && this.stamps.get(key);
    if (incoming && held && compareStamps(incoming, held) <= 0) {
      // We already applied a write that wins the total order. Dropping
      // is what makes concurrent writes converge — but if the loser
      // carried a different schema, two replicas genuinely disagreed
      // about a contract and an operator should see it.
      this.recordConflict({
        reason: 'stale-write',
        kind: mutation.kind,
        key,
        fromReplica: mutation.replicaId,
        detail: 'lost the (ts, replicaId) tie-break against the locally applied write',
      });
      return;
    }

    // A mutation for an event we've never seen can't be applied yet:
    // Redis pub/sub does not order across publishers, so its declare
    // may still be in flight. Park it rather than dropping it — unless
    // we have a tombstone, in which case the event is not "not here
    // yet", it is gone, and holding the edit would let it re-attach
    // itself to a future incarnation of the event that never had it.
    if (mutation.kind !== 'declare' && mutation.kind !== 'remove') {
      const name = targetEvent(mutation.kind, mutation.payload);
      if (name && !registry.get(name)) {
        if (this.stamps.get(`evt\x00${name}`)?.removed) {
          this.recordConflict({
            reason: 'stale-write',
            kind: mutation.kind,
            key,
            fromReplica: mutation.replicaId,
            detail: `event "${name}" was removed — the edit died with it`,
          });
          // Stamp the discard. A decision to throw a mutation away is
          // only safe if a redelivery of that same mutation reaches the
          // same decision, and after the event is re-declared the
          // tombstone is gone — so without this the copy Redis sends
          // again would be applied.
          if (incoming) this.setStamp(key, incoming);
          return;
        }
        this.park(mutation);
        return;
      }
    }

    if (!this.applyMutation(mutation, registry)) return;
    if (incoming) {
      this.setStamp(key, mutation.kind === 'remove' ? { ...incoming, removed: true } : incoming);
    }

    if (mutation.kind === 'remove') {
      this.purgePending(targetEvent('remove', mutation.payload));
    }
    if (mutation.kind === 'declare') {
      const name = targetEvent('declare', mutation.payload);
      if (name) this.drainPending(name, registry);
    }
  }

  /**
   * Forget everything parked for an event that has just been deleted.
   *
   * Without this a `subscriber.add` that was waiting for its declare
   * survives the delete and is replayed by the *next* declare of the
   * same name, re-attaching a consumer to a fresh incarnation of the
   * event that never had it — and only on the replicas that happened to
   * have parked it, which is a divergence.
   */
  private purgePending(name: string | null): void {
    if (!name || this.pending.length === 0) return;
    const keep: PendingMutation[] = [];
    for (const p of this.pending) {
      if (targetEvent(p.mutation.kind, p.mutation.payload) !== name) {
        keep.push(p);
        continue;
      }
      const key = conflictKey(p.mutation.kind, p.mutation.payload);
      this.recordConflict({
        reason: 'stale-write',
        kind: p.mutation.kind,
        key: key ?? '?',
        fromReplica: p.mutation.replicaId,
        detail: `event "${name}" was removed while this edit was parked`,
      });
      // Same reason as the tombstone discard above: record the stamp so
      // a redelivery of this mutation is refused rather than applied to
      // the next incarnation of the event.
      if (key && typeof p.mutation.ts === 'number') {
        this.setStamp(key, { ts: p.mutation.ts, replicaId: p.mutation.replicaId });
      }
    }
    this.pending = keep;
  }

  private park(mutation: MutationMessage): void {
    this.pending.push({ mutation, parkedAt: Date.now() });
    if (this.pending.length > MAX_PENDING) {
      const dropped = this.pending.shift();
      if (dropped) {
        this.recordConflict({
          reason: 'pending-expired',
          kind: dropped.mutation.kind,
          key: conflictKey(dropped.mutation.kind, dropped.mutation.payload) ?? '?',
          fromReplica: dropped.mutation.replicaId,
          detail: 'parked-mutation buffer overflowed before the declare arrived',
        });
      }
    }
  }

  /** Replay parked mutations whose event just showed up, in arrival order. */
  private drainPending(name: string, registry: Registry): void {
    if (this.pending.length === 0) return;
    const now = Date.now();
    const keep: PendingMutation[] = [];
    const ready: MutationMessage[] = [];
    for (const p of this.pending) {
      if (now - p.parkedAt > PENDING_TTL_MS) {
        this.recordConflict({
          reason: 'pending-expired',
          kind: p.mutation.kind,
          key: conflictKey(p.mutation.kind, p.mutation.payload) ?? '?',
          fromReplica: p.mutation.replicaId,
          detail: 'declare never arrived within the parking window',
        });
        continue;
      }
      if (targetEvent(p.mutation.kind, p.mutation.payload) === name) ready.push(p.mutation);
      else keep.push(p);
    }
    this.pending = keep;
    for (const m of ready) this.receive(m, registry);
  }

  /**
   * Run the same schema-evolution gate the HTTP declare route runs.
   * Without this, replication is a way around the one guarantee this
   * service exists to provide: a breaking schema refused with a 409 on
   * replica A could still be installed on replica B by broadcast.
   */
  private passesCompatGate(entry: RegistryEntry, registry: Registry, fromReplica: string): boolean {
    const existing = registry.get(entry.name);
    if (!existing) return true;
    const schema = entry.schema;
    if (!schema || Object.keys(schema).length === 0) return true;
    if (JSON.stringify(existing.schema) === JSON.stringify(schema)) return true;

    const strict = existing.compatMode === 'strict'
      || (existing.compatMode !== 'off' && process.env.EVENT_CATALOG_STRICT === 'true');
    if (!strict) return true;

    const compat = registry.checkSchemaCompat(entry.name, schema);
    if (compat.compatible) return true;

    this.recordConflict({
      reason: 'compat-violation',
      kind: 'declare',
      key: `evt\x00${entry.name}`,
      fromReplica,
      detail: compat.violations.join('; '),
    });
    this.warn(
      `compat:${entry.name}`,
      `[registry-coordinator] refused replicated declare for "${entry.name}" — `
      + `strict compat violation: ${compat.violations.join('; ')}`,
      {
        action: 'declare',
        status: 'refused',
        eventName: entry.name,
        fromReplica,
        violations: compat.violations,
      },
    );
    return false;
  }

  /** Returns true when the mutation was actually applied. */
  private applyMutation(mutation: MutationMessage, registry: Registry): boolean {
    try {
      switch (mutation.kind) {
        case 'declare': {
          const entry = mutation.payload as RegistryEntry;
          if (!this.passesCompatGate(entry, registry, mutation.replicaId)) return false;
          const known = registry.get(entry.name);
          registry.declare(entry as EventDeclaration);
          // Registry.declare *derives* version and schemaHistory from
          // the local prior schema. On the replication path that is the
          // wrong source: the payload is the peer's finished entry and
          // already carries the authoritative values, and re-deriving
          // them leaves two replicas holding the same schema under
          // different version numbers and different histories. Take the
          // peer's. Subscribers and deprecation are adopted only for a
          // brand-new entry — they have their own conflict keys, and
          // unioning a stale declare's subscriber list would resurrect
          // consumers a newer subscriber.remove already retired.
          this.adoptReplicatedFields(entry, registry, !known);
          return true;
        }
        case 'deprecate': {
          const { name, opts } = mutation.payload as { name: string; opts?: { reason?: string; by?: string } };
          return registry.deprecate(name, opts);
        }
        case 'undeprecate':
          registry.undeprecate((mutation.payload as { name: string }).name);
          return true;
        case 'subscriber.add': {
          const { eventName, serviceName } = mutation.payload as { eventName: string; serviceName: string };
          registry.addSubscriber(eventName, serviceName);
          return true;
        }
        case 'subscriber.remove': {
          const { eventName, serviceName } = mutation.payload as { eventName: string; serviceName: string };
          registry.removeSubscriber(eventName, serviceName);
          return true;
        }
        case 'remove':
          registry.remove((mutation.payload as { name: string }).name);
          return true;
        default:
          this.warn(
            `apply-unknown-kind:${String((mutation as MutationMessage).kind)}`,
            '[registry-coordinator] unknown mutation kind:',
            { action: 'apply', kind: (mutation as MutationMessage).kind, fromReplica: mutation.replicaId },
            (mutation as MutationMessage).kind,
          );
          return false;
      }
    } catch (err) {
      this.warn(
        `apply-failed:${mutation.kind}`,
        '[registry-coordinator] failed to apply remote mutation:',
        {
          action: 'apply',
          status: 'failed',
          kind: mutation.kind,
          fromReplica: mutation.replicaId,
          error: errorMessage(err),
        },
        (err as Error).message,
        mutation.kind,
      );
      return false;
    }
  }

  /**
   * Carry over the fields Registry.declare would otherwise derive from
   * local state. Never called for a local declare, where deriving them
   * is the intended behaviour.
   *
   * `version` and `schemaHistory` are adopted on every replicated
   * declare so the winning entry looks identical everywhere. The rest
   * — subscribers, deprecation — is adopted only when the entry is
   * brand-new here, because Registry.declare resets those for a fresh
   * entry and the peer's payload is the only copy we have. For an entry
   * we already hold, those fields are owned by their own mutation kinds
   * and their own conflict keys.
   *
   * A peer on a build that predates a field simply omits it, so each
   * adoption is guarded on the value actually being present.
   */
  private adoptReplicatedFields(source: RegistryEntry, registry: Registry, firstSight: boolean): void {
    const created = registry.get(source.name);
    if (!created) return;
    if (Array.isArray(source.schemaHistory)) {
      created.schemaHistory = source.schemaHistory;
    }
    if (typeof source.version === 'number') created.version = source.version;
    if (!firstSight) return;
    if (Array.isArray(source.subscribers)) {
      for (const s of source.subscribers) registry.addSubscriber(source.name, s);
    }
    if (source.deprecation) created.deprecation = source.deprecation;
  }
}

function isKnownKind(kind: string): boolean {
  return kind === 'declare' || kind === 'deprecate' || kind === 'undeprecate'
    || kind === 'subscriber.add' || kind === 'subscriber.remove' || kind === 'remove';
}
