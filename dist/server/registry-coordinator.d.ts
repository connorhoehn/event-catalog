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
import type { Registry } from '../registry/index.js';
export declare const MUTATIONS_CHANNEL = "event-catalog:mutations";
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
export type ConflictReason = 'stale-write' | 'compat-violation' | 'pending-expired';
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
    private pubClient;
    private subClient;
    private _started;
    /** Our own broadcast counter, so peers can spot a gap. */
    private seq;
    /** Strictly-increasing stamp clock — never repeats within a replica. */
    private lastTs;
    /** Last seq observed per peer replica; a jump means messages were lost. */
    private peerSeq;
    /** Last applied stamp per conflict key. */
    private stamps;
    /** Mutations waiting for the declare of an event we haven't seen yet. */
    private pending;
    private conflicts;
    private _stale;
    private _resyncs;
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
    getStats(): {
        replicaId: string;
        stale: boolean;
        resyncs: number;
        pending: number;
        conflicts: number;
    };
    start(redisUrl: string, registry: Registry): Promise<void>;
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
    private purgePending;
    private park;
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