import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyFilter } from '../types/index';
import type { IRegistry, ValidationResult, DeclareResult, ResolveResult } from './types';
import { type CompatResult } from './schema-compat';
export declare class Registry implements IRegistry {
    private events;
    private readonly schemaValidator;
    private readonly redis;
    /**
     * wave24-b — map keyed by `${eventName}\x00${serviceName}` → epoch ms.
     *
     * Invariant: every key in here corresponds to a (event, service) pair
     * that is currently in some entry's `subscribers` list. Nothing else
     * can reach an entry — `pruneStaleSubscribers` and
     * `listSubscriberHeartbeats` both iterate live events — so a key that
     * falls out of that set is unreclaimable. Every path on which an
     * event or a subscriber can disappear (`remove`, `removeSubscriber`,
     * `clear`, `load`, `reload`, the sweeper) is responsible for keeping
     * the invariant.
     */
    private subscriberHeartbeats;
    /**
     * Subscriber registrations refused, by reason. The cap and the name
     * guard are both silent from the registry's side — replication has no
     * response to write a 4xx into — so a counter is what keeps a capped
     * event from looking like a quiet one. Surfaced on
     * `GET /api/subscribers`.
     */
    private subscriberRefusals;
    /**
     * alias name → canonical event name. Built lazily on the first alias
     * lookup and dropped whenever the event map changes. `resolve()` sits on
     * the publish hot path and used to walk every entry on the alias branch,
     * which cost ~24µs on a 5k-event registry — 20x a whole publish.
     */
    private aliasIndex;
    constructor(redis?: RedisClientType);
    load(): Promise<void>;
    /**
     * Full-state resync from the shared Redis hash — delete-aware, unlike
     * `load()`, which only overlays. This is the repair path for a replica
     * that missed pub/sub broadcasts: Redis pub/sub offers no replay, so
     * the persisted hash is the only shared record of current truth.
     *
     * Returns false when the registry has no Redis backing (single-process
     * mode), so the caller can tell "resynced" from "cannot resync".
     */
    reload(): Promise<boolean>;
    /**
     * Drop every heartbeat that no longer names a live (event, service)
     * pair. One pass over the live subscriber edges — the same order of
     * work the caller (`load` / `reload`) is already doing — rather than a
     * scan of the heartbeat map, which is the collection that grows.
     */
    private reconcileHeartbeats;
    /**
     * Phase E6.5 — backfill `fingerprint` on `schemaHistory` entries that
     * lack it (entries persisted before wave19-h, when the field was
     * introduced). Idempotent: returns 0 when every history entry already
     * carries a fingerprint. Called from `load()` after Redis hydration;
     * exposed publicly so a one-shot CLI / test can drive it.
     */
    migrateHistoryFingerprints(): number;
    declare(event: EventDeclaration): DeclareResult;
    get(name: string): RegistryEntry | undefined;
    /**
     * Phase E3.5 — alias-aware lookup.
     *
     * Returns the canonical RegistryEntry for `name`, whether `name` is the
     * canonical event name or a deprecated alias declared on some canonical
     * event. When `name` resolves via an alias, `viaAlias` carries the alias
     * record so callers can surface a deprecation warning.
     */
    resolve(name: string): ResolveResult | undefined;
    /**
     * Build (or reuse) the alias → canonical-name index. Invalidated by any
     * change to the event map, so it can never outlive the declarations it
     * was derived from. Insertion order is preserved, which keeps the
     * first-declaration-wins behaviour of the old linear scan when two
     * events declare the same alias.
     */
    private getAliasIndex;
    list(filter?: RegistryFilter): RegistryEntry[];
    /**
     * Register `serviceName` as a consumer of `eventName`.
     *
     * Returns false when the registration was refused: the event does not
     * exist, the name is unusable, or the event is already at
     * `MAX_SUBSCRIBERS_PER_EVENT` distinct subscribers. The guard lives
     * here rather than only in the HTTP handler because replication
     * (`RegistryCoordinator` applying a peer's `subscriber.add`) and the
     * library client both call this directly.
     *
     * Refusing a *new* name at the cap is a deliberate choice over
     * evicting an old one: the subscriber list is the answer to "who
     * consumes X?", so silently dropping a live consumer would corrupt
     * that answer, while refusing an addition merely fails to record one
     * — and loudly, via the 429 the route returns and the counters below.
     * A consumer legitimately scaling out is unaffected: subscribers are
     * service identities, so every replica of it de-dupes onto the one
     * name it already holds.
     */
    addSubscriber(eventName: string, serviceName: string): boolean;
    /**
     * Registrations refused, by reason, plus the ceiling in force. A cap
     * that is never reported is indistinguishable from a consumer that
     * never called.
     */
    getSubscriberRefusalStats(): {
        atCapacity: number;
        invalidName: number;
        capacity: number;
    };
    removeSubscriber(eventName: string, serviceName: string): void;
    /**
     * wave24-b — refresh a subscriber's lastSeenAt for one event or all
     * events it currently subscribes to (when `eventNames` is omitted).
     * Used by POST /api/heartbeat. Returns the list of events that were
     * actually refreshed (skipping any the consumer wasn't subscribed to).
     */
    heartbeat(serviceName: string, eventNames?: string[]): string[];
    /** wave24-b — list events a service currently subscribes to. */
    eventsSubscribedBy(serviceName: string): string[];
    /**
     * wave24-b — return all subscriber records with their last-seen
     * timestamps. Each entry is `{ eventName, serviceName, lastSeenAt }`.
     * For the admin UI's "Subscribers" view + the GET /api/subscribers
     * surface.
     */
    listSubscriberHeartbeats(): Array<{
        eventName: string;
        serviceName: string;
        lastSeenAt: string;
    }>;
    /**
     * wave24-b — remove subscriber records older than `ttlMs`.
     * Returns the list of `{ eventName, serviceName }` pairs that were
     * pruned so callers can audit / log / emit.
     */
    pruneStaleSubscribers(ttlMs: number, nowMs?: number): Array<{
        eventName: string;
        serviceName: string;
    }>;
    private touchHeartbeat;
    updateStats(eventName: string, stats: Partial<RegistryEntry['metadata']>): void;
    remove(eventName: string): boolean;
    /**
     * wave25-a — mark an event as deprecated. Publish still works
     * (don't break existing producers); the catalog logs a warn at
     * publish time when warnOnDeprecated is on. Idempotent: re-calling
     * with new metadata updates the deprecation record. Returns true if
     * the event existed (and was marked or remarked).
     */
    deprecate(eventName: string, opts?: {
        reason?: string;
        by?: string;
    }): boolean;
    /**
     * wave25-a — clear the deprecation flag. Returns true if the event
     * existed and was previously deprecated; false if no-op.
     */
    undeprecate(eventName: string): boolean;
    /** wave25-a — convenience: every currently-deprecated event. */
    listDeprecated(): RegistryEntry[];
    getTopology(filter?: TopologyFilter): TopologyGraph;
    validate(eventName: string, payload: unknown): ValidationResult;
    size(): number;
    clear(): void;
    checkSchemaCompat(eventName: string, proposedSchema: Record<string, unknown>): CompatResult;
    private runCompatCheck;
    private persist;
}
//# sourceMappingURL=index.d.ts.map