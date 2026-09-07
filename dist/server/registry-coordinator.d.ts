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
 *
 * Fire-and-forget: broadcast failures are logged but never propagate.
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
     * Carry over the fields Registry.declare resets for a brand-new
     * event. Only for first-sight replicated entries — never for a local
     * declare, where the reset is the intended behaviour.
     */
    private adoptReplicatedFields;
}
//# sourceMappingURL=registry-coordinator.d.ts.map