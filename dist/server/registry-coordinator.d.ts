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
 * Fire-and-forget: broadcast failures are logged but never propagate.
 * If a replica misses a message it will re-sync on the next declare from
 * any service (which is idempotent).
 */
import type { Registry } from '../registry/index.js';
export declare const MUTATIONS_CHANNEL = "event-catalog:mutations";
export type MutationKind = 'declare' | 'deprecate' | 'undeprecate' | 'subscriber.add' | 'subscriber.remove' | 'remove';
export interface MutationMessage {
    replicaId: string;
    kind: MutationKind;
    payload: unknown;
}
export declare class RegistryCoordinator {
    readonly replicaId: string;
    private pubClient;
    private subClient;
    private _started;
    get started(): boolean;
    start(redisUrl: string, registry: Registry): Promise<void>;
    stop(): Promise<void>;
    /** Publish a mutation to all peer replicas. Never throws. */
    broadcast(kind: MutationKind, payload: unknown): Promise<void>;
    private applyMutation;
}
//# sourceMappingURL=registry-coordinator.d.ts.map