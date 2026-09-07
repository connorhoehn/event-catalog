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
 *     Repair is coalesced and backed off (`requestResync`) — one reload
 *     at a time, spacing that doubles under repeated gaps — because the
 *     reload clears every stamp and every parked mutation, so doing it
 *     per missed message degrades convergence to last-write-wins.
 *
 *  5. **Bounded on hostile input.** Every field of a broadcast is chosen
 *     by the publisher, and anything that can reach the same Redis can
 *     publish. So each structure keyed off that input has a ceiling: the
 *     message itself (`MAX_MUTATION_BYTES`, matching the HTTP body
 *     limit), the stamp map (`MAX_STAMPS`), the parked buffer (bounded
 *     in *both* entries and bytes, and swept on a timer rather than only
 *     when a declare happens to arrive), and the peer sequence table
 *     (`MAX_PEERS`, aged out least-recently-seen first). Every one of
 *     them reports what it dropped rather than dropping it silently.
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
 *    The one exception is when the peer table has evicted a peer that
 *    was still talking: that is the case where "first contact" might be
 *    our own forgetting, so `forgotLivePeer` turns the assumption off
 *    until the next successful reload.
 *
 *  - **Timestamps are per-replica.** `metadata.createdAt`,
 *    `deprecation.deprecatedAt` and `schemaHistory[].updatedAt` are
 *    stamped by whichever replica applied the mutation. The broadcast
 *    payload carries no authoritative value for the first two, so they
 *    differ between replicas by construction. The semantic content does
 *    not.
 */
import type { Registry } from '../registry/index.js';
import { type CatalogLogger } from '../utils/logger.js';
export declare const MUTATIONS_CHANNEL = "event-catalog:mutations";
/**
 * Largest single broadcast this replica will parse.
 *
 * The HTTP path reads bodies under `MAX_REQUEST_BODY_BYTES` (1 MiB); the
 * broadcast path had no equivalent, so a peer — or anything else able to
 * reach the same Redis — could hand every replica an arbitrarily large
 * string to parse and retain. Same number, same reason.
 */
export declare const MAX_MUTATION_BYTES = 1048576;
export type MutationKind = 'declare' | 'deprecate' | 'undeprecate' | 'subscriber.add' | 'subscriber.remove' | 'remove';
export interface MutationMessage {
    replicaId: string;
    kind: MutationKind;
    payload: unknown;
    /** Per-replica monotonic broadcast counter — used for gap detection. */
    seq?: number;
    /** Strictly-increasing local clock; the primary ordering key. */
    ts?: number;
}
export type ConflictReason = 'stale-write' | 'compat-violation' | 'pending-expired' | 'oversized';
export interface ReplicationConflict {
    at: string;
    reason: ConflictReason;
    kind: MutationKind;
    key: string;
    fromReplica: string;
    detail?: string;
}
export declare class RegistryCoordinator {
    readonly replicaId: string;
    private readonly log;
    private readonly warnings;
    /**
     * @param logger diagnostics sink; omitted, every line below goes to
     *   `console.warn` / `console.log` exactly as before.
     */
    constructor(logger?: CatalogLogger);
    /**
     * Emit one throttled warning, tagged with this replica's id.
     *
     * The suppressed-count suffix is inserted *before* a trailing colon so
     * a line whose detail is passed as a second console argument still
     * reads `… failed (+3 similar suppressed): detail`. With nothing
     * suppressed the suffix is empty and the message is byte-identical to
     * what the call site emitted before it was throttled.
     */
    private warn;
    private pubClient;
    private subClient;
    private _started;
    /** Our own broadcast counter, so peers can spot a gap. */
    private seq;
    /** Strictly-increasing stamp clock — never repeats within a replica. */
    private lastTs;
    /**
     * Last seq observed per peer replica; a jump means messages were lost.
     * Bounded by `MAX_PEERS` and aged out at `PEER_IDLE_TTL_MS`, in
     * least-recently-seen order — see `rememberPeer`.
     */
    private peerSeq;
    /** Peers dropped under capacity pressure, not because they went idle. */
    private _peersForgotten;
    /**
     * Set when a *live* peer was evicted for capacity. While it is set, a
     * first-contact message at seq > 1 is no longer assumed benign — the
     * peer may be one we forgot. Cleared by the resync that repairs it.
     */
    private forgotLivePeer;
    /** Last applied stamp per conflict key. */
    private stamps;
    /** Mutations waiting for the declare of an event we haven't seen yet. */
    private pending;
    /** Running sum of `pending[].bytes`, kept in step by `setPending`/`park`. */
    private pendingBytes;
    /** Sweeps the parked buffer's TTL; only alive while something is parked. */
    private pendingSweep;
    private conflicts;
    private _stale;
    private _resyncs;
    /** Repair requests folded into a reload that was already happening. */
    private _resyncsCoalesced;
    /** The reload currently running, if any — a second one never starts. */
    private resyncInFlight;
    /** Cause of the one follow-up reload queued behind the in-flight one. */
    private resyncQueued;
    private resyncTimer;
    /** Current minimum spacing between reloads; doubles, decays when quiet. */
    private resyncBackoffMs;
    private lastResyncAt;
    /** True once a full-state read from shared storage has succeeded. */
    private bootSynced;
    private registry;
    get started(): boolean;
    /**
     * True when this replica is known to have missed at least one
     * broadcast and has not been able to repair itself from shared
     * state. A stale replica is serving a registry that may be missing
     * or holding outdated declarations.
     */
    isStale(): boolean;
    /** Recent replication conflicts, newest last. For health/admin surfaces. */
    getConflicts(): ReplicationConflict[];
    /**
     * `pendingBytes`, `peers` and `peersForgotten` exist so the two bounds
     * that can silently degrade behaviour are visible rather than
     * inferred: a parked buffer trimmed for memory, and a peer whose
     * high-water mark was dropped (which resets gap detection for it).
     */
    getStats(): {
        replicaId: string;
        stale: boolean;
        resyncs: number;
        resyncsCoalesced: number;
        pending: number;
        pendingBytes: number;
        peers: number;
        peersForgotten: number;
        conflicts: number;
    };
    start(redisUrl: string, registry: Registry): Promise<void>;
    /**
     * Redis client errors arrive once per failed reconnect attempt on each
     * of the two clients, so they are throttled per role. The message keeps
     * its two-argument console shape.
     */
    private warnRedisClient;
    /**
     * Release everything this replica holds on behalf of the cluster.
     *
     * Both timers are cleared here and nulled, not merely cancelled: an
     * interval that outlives `stop()` keeps the event loop alive, so
     * SIGTERM stops shutting the container down and the orchestrator falls
     * back to SIGKILL. The maps are dropped for the same reason a restart
     * should not inherit them — a coordinator restarted in-process would
     * otherwise carry a stale peer table and parked mutations whose
     * declares were addressed to a previous life.
     */
    stop(): Promise<void>;
    /** Publish a mutation to all peer replicas. Never throws. */
    broadcast(kind: MutationKind, payload: unknown): Promise<void>;
    /**
     * Reload the whole registry from the shared Redis hash. This is the
     * only repair path for a replica that missed broadcasts — pub/sub
     * itself offers no replay. Returns false when the registry has no
     * Redis backing, in which case the replica stays marked stale.
     */
    resync(cause: string): Promise<boolean>;
    /**
     * Ask for a repair reload, at most one at a time and no faster than
     * the current backoff allows.
     *
     * A reload is an `HGETALL` of the entire registry hash plus a wholesale
     * rebuild of the event map, and it clears every stamp and every parked
     * mutation on the way through — which means that while reloads are
     * happening, conflict resolution has no history to resolve against and
     * degrades to last-write-wins. Firing one per missed broadcast turns a
     * flaky peer into a self-inflicted outage: the audit's 500 gapped
     * messages produced 500 full reloads.
     *
     * Two mechanisms, doing different jobs:
     *
     *  - **Coalescing.** A reload already in flight absorbs any request
     *    that arrives while it runs. At most one follow-up is queued behind
     *    it — one is enough, because the follow-up reads the *current*
     *    snapshot, which already reflects every mutation the coalesced
     *    requests were complaining about.
     *  - **Backoff.** The first gap after a quiet period repairs
     *    immediately, because that is the common case and delaying it just
     *    serves a truncated registry for longer. Each further reload
     *    doubles the minimum spacing to `RESYNC_MAX_INTERVAL_MS`, and the
     *    spacing decays back to zero once `RESYNC_BACKOFF_RESET_MS` passes
     *    without one.
     *
     * The replica stays flagged stale for the whole deferral, so a health
     * check never reads "fine" while a repair is still pending.
     */
    private requestResync;
    /** One reload, with the in-flight latch and the backoff bookkeeping. */
    private runResync;
    /**
     * Lamport clock. Wall time alone is not enough: two replicas writing
     * in the same millisecond would tie and fall through to the replicaId
     * tie-break, which can hand the win to a write that *causally
     * preceded* the other. Advancing our clock past every stamp we
     * observe means a write made after seeing a peer's write always
     * carries a strictly greater stamp.
     */
    private nextTs;
    private observeTs;
    private setStamp;
    /**
     * Detect dropped messages. Redis pub/sub has no delivery guarantee
     * and no replay, so a gap in a peer's monotonic seq is the only
     * evidence we get that our registry is now incomplete.
     */
    private trackSequence;
    /**
     * Drop peers we have not heard from in `PEER_IDLE_TTL_MS`.
     *
     * The map is kept in least-recently-seen order, so the expired entries
     * are a prefix and the scan stops at the first live one — this is O(1)
     * on every message that evicts nothing, which is every message in a
     * healthy cluster.
     *
     * Aging out costs no gap detection. A high-water mark is only useful
     * against a message still in flight, and pub/sub latency is
     * milliseconds; nothing arriving fifteen minutes later could have been
     * ordered against it anyway. Only the capacity path in `rememberPeer`
     * can forget a peer that is still talking, and that path says so.
     */
    private prunePeers;
    /**
     * Record a peer's high-water mark, keeping the table bounded and in
     * least-recently-seen order (delete-then-set moves a key to the end).
     *
     * Eviction under capacity pressure is the one case that can forget a
     * peer still publishing, and it is the case that must not be silent —
     * forgetting a mark resets gap detection for that peer, which is the
     * mechanism that repairs divergence in the first place. So it is
     * counted in `getStats().peersForgotten`, warned about, and latched in
     * `forgotLivePeer` so the next unexplained first-contact is treated as
     * a possible gap rather than assumed benign.
     *
     * In practice the LRU order means a real cluster never reaches this:
     * `MAX_PEERS` is far above any pod count, idle pods age out first, and
     * the ids that a flood mints are seen exactly once, so they sit at the
     * head of the LRU and evict each other rather than the live peers.
     */
    private rememberPeer;
    private markStale;
    private recordConflict;
    /** Full receive pipeline: order → gate → apply → drain parked. */
    private receive;
    /**
     * Forget everything parked for an event that has just been deleted.
     *
     * Without this a `subscriber.add` that was waiting for its declare
     * survives the delete and is replayed by the *next* declare of the
     * same name, re-attaching a consumer to a fresh incarnation of the
     * event that never had it — and only on the replicas that happened to
     * have parked it, which is a divergence.
     */
    /**
     * The only place `pending` is replaced wholesale. It keeps the byte
     * total in step and retires the sweep timer once nothing is parked —
     * the alternative is a timer that ticks for the life of the process
     * over an empty array.
     */
    private setPending;
    private purgePending;
    /**
     * Park a mutation whose declare has not arrived, under two bounds.
     *
     * `MAX_PENDING` bounds how many mutations can be waiting; the byte
     * budget bounds what those slots are allowed to *hold*, because the
     * payload is the peer's and nothing on this path checks its field
     * lengths. Both trim oldest-first, and both record what they dropped —
     * a mutation thrown away silently is the same divergence as one never
     * received.
     */
    private park;
    /**
     * Enforce the parking TTL without waiting for a message.
     *
     * `drainPending` also applies the TTL, but it only runs when a
     * `declare` broadcast arrives — so on a cluster that goes quiet,
     * parked mutations were held indefinitely and `PENDING_TTL_MS` meant
     * nothing. The interval exists only while something is parked, is
     * unref'd so it never holds the process open on its own, and is
     * cleared by `stop()`.
     */
    private ensurePendingSweep;
    private stopPendingSweep;
    /** Drop every parked mutation whose declare never turned up in time. */
    private sweepPending;
    /** TTL check plus the conflict record, shared by the sweep and the drain. */
    private expired;
    /** Replay parked mutations whose event just showed up, in arrival order. */
    private drainPending;
    /**
     * Run the same schema-evolution gate the HTTP declare route runs.
     * Without this, replication is a way around the one guarantee this
     * service exists to provide: a breaking schema refused with a 409 on
     * replica A could still be installed on replica B by broadcast.
     */
    private passesCompatGate;
    /** Returns true when the mutation was actually applied. */
    private applyMutation;
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
    private adoptReplicatedFields;
}
//# sourceMappingURL=registry-coordinator.d.ts.map