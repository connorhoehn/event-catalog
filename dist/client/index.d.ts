import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import type { EventCatalogConfig, EventDeclaration, EventHandler, NamespacePolicy, PublishOptions, Subscription, SubscribeOptions } from '../types/index';
import type { ResolveResult } from '../registry/types';
export declare class EventCatalog {
    private readonly config;
    private readonly registry;
    private readonly signal;
    private readonly durable;
    private readonly syncRetryManager;
    private connected;
    private resyncInterval;
    /** Phase E3.5 — dedupe deprecation log to one line per alias per process. */
    private readonly warnedAliases;
    /** wave25-a — track which deprecated event names we've already warned about. */
    private readonly warnedDeprecated;
    constructor(config: EventCatalogConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    /**
     * Register an event with the local registry. In strict mode
     * (`config.strict === true` or `EVENT_CATALOG_STRICT=true`), throws
     * when the new schema breaks compatibility against the registered
     * history. Otherwise the violation is non-fatal — callers may inspect
     * the catalog's logs or the server's `GET /api/events/:name/schema/check`
     * endpoint.
     */
    declare(event: EventDeclaration): void;
    /** Phase 20-h — public access to the merged namespace policy for a name. */
    getNamespacePolicy(namespace: string): NamespacePolicy | undefined;
    /**
     * Phase 20-b — bulk-declare convenience. Equivalent to looping
     * `declare()` per event but documents intent at the call site (most
     * consumers register many declarations at boot from an exported
     * array, e.g. `pipelineEventDeclarations`). In strict mode each
     * incompatible declaration throws *immediately*; earlier successful
     * declarations stay in the local registry.
     */
    declareAll(events: EventDeclaration[]): void;
    /**
     * wave24-e — periodically POST /api/heartbeat for every event this
     * catalog instance is currently subscribed to. Returns a `stop()`
     * function for graceful shutdown wiring.
     *
     * Defaults to 5-minute cadence which sits comfortably within the
     * server's default 30-min `SUBSCRIBER_TTL_SECONDS`. Best-effort:
     * heartbeat HTTP failures log a warn and the loop continues.
     *
     * Use case (consumer boot):
     *   const stopHb = catalog.startHeartbeating();
     *   process.on('SIGTERM', async () => { stopHb(); await catalog.disconnect(); });
     */
    startHeartbeating(intervalMs?: number): () => void;
    /**
     * wave24-e — derive a manifest of every event this consumer is
     * subscribed to + the current local fingerprint. Returns the shape
     * the wave23-b PUT /api/manifests/:consumer endpoint expects.
     *
     * Use case:
     *   const manifest = catalog.exportManifest();
     *   await fetch(`${url}/api/manifests/audit-worker`, { method: 'PUT', body: JSON.stringify(manifest) });
     */
    exportManifest(): {
        events: Array<{
            name: string;
            fingerprint: string;
        }>;
    };
    /**
     * wave24-e — convenience: derive the manifest via exportManifest()
     * and PUT it to the registry under the configured serviceName (or
     * an explicit override). Returns the server's response body. Throws
     * on non-2xx HTTP. No-op when registryUrl is unset.
     */
    pinManifest(consumerName?: string): Promise<unknown>;
    /**
     * Phase 21-b — bulk drift detection. For every event in the local
     * registry, fetches the current fingerprint from the remote registry
     * and compares to the local one. Returns a per-event status report.
     *
     *   'fresh'   — local fingerprint matches remote
     *   'stale'   — fingerprints differ; the local declaration is out of sync
     *   'unknown' — no remote fingerprint (event not yet on the registry,
     *               or `registryUrl` is unset)
     *
     * Useful at consumer boot to log a single startup line summarizing
     * declaration drift, or for periodic health checks. Network errors
     * on individual events show as 'unknown' (they don't abort the loop).
     */
    checkAllSchemaFreshness(): Promise<Array<{
        eventName: string;
        status: 'fresh' | 'stale' | 'unknown';
        localFingerprint: string;
        remoteFingerprint: string | null;
    }>>;
    /**
     * Phase 20-b — fetch the current sha256 fingerprint of an event's
     * schema from the remote registry. Returns null when the event is
     * not declared on the registry, or when `registryUrl` is unset.
     * Throws on network errors (callers can wrap to fail open).
     *
     * Use case: a consumer caches the fingerprint from its last fetch.
     * On a tick it calls this and compares — if the value changed, the
     * cached schema is stale and the consumer should re-fetch.
     */
    getSchemaFingerprint(eventName: string): Promise<string | null>;
    private isStrict;
    publish<T = unknown>(eventName: string, payload: T, options?: PublishOptions): Promise<void>;
    /**
     * Channel-scoped signal publish for the websocket-gateway broadcast path
     * (wave1-ec-3).
     *
     * Differs from `publish(eventName, payload)` in two ways:
     *   1. Targets a specific channel (room/document/etc.) rather than the
     *      bare event-name as a pub/sub channel. The envelope is published
     *      to `websocket:route:{channelId}` and addressed to the gateway
     *      nodes registered in `websocket:channel:{channelId}:nodes`.
     *   2. Wraps the payload in the gateway's `ChannelMessageEnvelope` /
     *      `SignalMessage` shape so the gateway's MessageRouter can fan it
     *      out to local WebSocket subscribers without reshaping.
     *
     * Schema enforcement (wave1-ec-3 P0):
     *   - If the event IS declared, payload is validated against the
     *     declared JSON schema. Validation failures throw — same as
     *     `publish()`. This is the whole point of routing through the
     *     catalog instead of writing directly to Redis.
     *   - If the event is NOT declared, a warning is logged but the
     *     publish proceeds. Strict-mode rejection of undeclared events is
     *     deferred to a later wave (MQ-7 / EC-7 strict mode).
     *
     * @returns number of gateway nodes the envelope was addressed to (0
     *   when no listeners are registered).
     */
    publishSignal<T = unknown>(channelId: string, eventName: string, payload: T, options?: PublishOptions): Promise<number>;
    subscribe<T = unknown>(eventName: string, handler: EventHandler<T>, options?: SubscribeOptions): Subscription;
    getRegistry(): Registry;
    /**
     * Phase 20-a — alias-aware public lookup. Returns the canonical
     * RegistryEntry plus alias-info if the caller queried by a deprecated
     * name. Use this for "what's my canonical name for this old alias?"
     * audits without reaching into `getRegistry()`.
     */
    resolveEvent(name: string): ResolveResult | undefined;
    getSignalTransport(): SignalTransport;
    getDurableTransport(): DurableTransport;
    isConnected(): boolean;
    private warnDeprecatedAlias;
    private scheduleBackgroundSync;
    private syncToRemoteRegistry;
    private registerSubscriberRemote;
    private deregisterSubscriberRemote;
}
//# sourceMappingURL=index.d.ts.map