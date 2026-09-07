import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyFilter } from '../types/index';
import type { IRegistry, ValidationResult, DeclareResult, ResolveResult } from './types';
import { type CompatResult } from './schema-compat';
export declare class Registry implements IRegistry {
    private events;
    private readonly schemaValidator;
    private readonly redis;
    /** wave24-b — map keyed by `${eventName}\x00${serviceName}` → epoch ms. */
    private subscriberHeartbeats;
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
    addSubscriber(eventName: string, serviceName: string): void;
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