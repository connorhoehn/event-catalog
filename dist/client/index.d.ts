import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import type { EventCatalogConfig, EventDeclaration, EventEnvelope, EventHandler, NamespacePolicy, PublishOptions, Subscription, SubscribeOptions } from '../types/index';
import type { ResolveResult } from '../registry/types';
import type { EventPayloadMap } from '../generated/event-types';
/**
 * Payload type for a declared event name, or `unknown` for a name the
 * generated map doesn't know about. Drives the typed `publish()` overload.
 */
type PayloadFor<K> = K extends keyof EventPayloadMap ? EventPayloadMap[K] : unknown;
/**
 * A publish that was discarded before it reached a transport, rather than
 * throwing. Today the only cause is a signal publish issued while the
 * Redis transport is disconnected.
 */
export interface DroppedPublish {
    eventName: string;
    transport: 'signal';
    reason: 'transport-not-connected';
    /** The envelope that was lost, so a caller can buffer or re-emit it. */
    envelope: EventEnvelope;
    /**
     * Set for `publishSignal()` drops — the channel the message was
     * addressed to. Absent for `publish()` drops.
     */
    channelId?: string;
}
/**
 * `EventCatalogConfig` plus the client-only knobs that govern what happens
 * when a publish cannot be delivered.
 *
 * Additive: every field is optional and the defaults preserve the
 * historical behaviour, so existing `EventCatalogConfig` objects remain
 * valid without change.
 */
export interface EventCatalogClientOptions extends EventCatalogConfig {
    /**
     * Called for every publish discarded because the signal transport was
     * not connected. Without this, such a publish resolves normally and the
     * only trace is a one-shot `console.warn` plus the drop counters.
     *
     * Exceptions thrown here are caught and logged; they never fail the
     * publish. Wire it to a metric or a retry buffer.
     */
    onPublishDropped?(drop: DroppedPublish): void;
    /**
     * When true, `publish()` and `publishSignal()` **reject** instead of
     * dropping when the signal transport is disconnected — matching what
     * the durable transport already does.
     *
     * Defaults to `false` to preserve the v0.x contract. Prefer turning this
     * on in any service where a lost realtime event is worse than a rejected
     * request.
     */
    strictTransport?: boolean;
}
/**
 * The library half of event-catalog: declare events, publish them with
 * local schema validation, and subscribe to them.
 *
 * Failure semantics at a glance:
 *   - Programming errors (undeclared event, bad payload, bad discriminator,
 *     a throwing `beforePublish` hook) **reject**.
 *   - Registry-server failures (declaration sync, subscriber registration,
 *     heartbeat) are **swallowed and warned** — publishing never blocks on
 *     the registry.
 *   - Durable transport failures **reject** after retries.
 *   - Signal transport failures **reject**, except a publish issued while
 *     disconnected, which is **dropped**. Dropped publishes are counted
 *     ({@link getDroppedPublishCount}), reported to `onPublishDropped`, and
 *     can be made to reject with `strictTransport: true`. They never count
 *     toward `publishCount`.
 */
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
    /** Undeclared names already warned about on the publishSignal path. */
    private readonly warnedUndeclaredSignal;
    /** Publishes discarded because a transport was down, keyed by event name. */
    private readonly droppedPublishes;
    /**
     * @param config transport URLs, service identity, and optional
     *   validation/observability knobs. `redis.url` and `messageQueue.url`
     *   must be non-empty — the constructor throws otherwise, naming the
     *   env var each is normally read from, because an empty URL otherwise
     *   surfaces much later as a confusing connection failure.
     * @throws when `redis.url`, `messageQueue.url` or `serviceName` is
     *   missing or blank.
     */
    constructor(config: EventCatalogClientOptions);
    /**
     * Connect both transports, then push local declarations to the remote
     * registry if `registryUrl` is set. Idempotent.
     *
     * Publish before this resolves and the event is dropped (signal) or
     * rejected (durable) — always await it during boot.
     *
     * @throws when Redis cannot be reached. An unreachable message-queue or
     *   registry does **not** throw: the registry sync retries twice, then
     *   falls back to a background retry loop, and a 60s periodic re-sync
     *   starts regardless. Publishing never blocks on the registry.
     */
    connect(): Promise<void>;
    /**
     * Stop the periodic registry re-sync and disconnect both transports.
     * Idempotent and best-effort — safe to call from a SIGTERM handler.
     *
     * Does not deregister this service's subscriptions from the remote
     * registry (they age out via the heartbeat TTL), and does not drain
     * in-flight durable messages.
     */
    disconnect(): Promise<void>;
    /**
     * Register an event with the local registry. In strict mode
     * (`config.strict === true` or `EVENT_CATALOG_STRICT=true`), throws
     * when the new schema breaks compatibility against the registered
     * history. Otherwise the violation is non-fatal — callers may inspect
     * the catalog's logs or the server's `GET /api/events/:name/schema/check`
     * endpoint.
     *
     * Purely local and synchronous — it does not reach the registry server.
     * Declarations are pushed on `connect()` and by the 60s re-sync, so an
     * event declared after connect is publishable immediately but visible to
     * the server only on the next sync.
     *
     * @throws when the schema shape itself is invalid (e.g. `type: 'objct'`),
     *   and — in strict mode only — when the new schema breaks compatibility
     *   with the registered history.
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
    /**
     * Publish a declared event. Validates the payload locally against the
     * declared JSON Schema, then routes to the signal transport, the durable
     * transport, or both, according to the declaration's `transport`.
     *
     * When `eventName` is a name the generated `EventPayloadMap` knows
     * about, the payload is contextually typed for you — object literals get
     * field autocomplete and inference from the declared schema. Passing a
     * `string` variable, or a name not in the map, keeps the old untyped
     * behaviour.
     *
     * @throws when the event is not declared (the message suggests close
     *   declared names), when the payload fails schema or discriminator
     *   validation (the message names the field, the rule and the value),
     *   when a `beforePublish` hook throws, or when a transport send fails.
     *   `errorCount` is incremented on every one of those.
     * @remarks Does **not** guarantee delivery. A signal publish issued while
     *   the Redis transport is disconnected is dropped, not thrown — see
     *   {@link getDroppedPublishCount} and the `onPublishDropped` /
     *   `strictTransport` options. Signal delivery itself is fire-and-forget
     *   with no ack. Never blocks on the registry server.
     */
    publish<K extends string>(eventName: K, payload: PayloadFor<K>, options?: PublishOptions): Promise<void>;
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
     * Not interchangeable with `publish()`: this one takes a channel, skips
     * the registry's transport routing (always signal), does not run
     * `beforePublish`/`afterPublish` hooks, and — because the gateway's wire
     * envelope has nowhere to carry them — **ignores `options.headers` and
     * `options.correlationId`**. Only `options.timestamp` is honoured. Use
     * `publish()` for anything that isn't a gateway channel broadcast.
     *
     * @returns number of gateway nodes the envelope was addressed to.
     *   **`0` is ambiguous** — it means "no gateway node is registered for
     *   this channel" *or* "the signal transport is disconnected and the
     *   message was dropped". {@link getDroppedPublishCount} distinguishes
     *   them.
     * @throws when a declared payload fails schema or discriminator
     *   validation, when Redis rejects the publish, or — with
     *   `strictTransport: true` — when the transport is disconnected.
     * @remarks An undeclared event publishes anyway, with a one-time warning
     *   per event name and no schema enforcement.
     */
    publishSignal<T = unknown>(channelId: string, eventName: string, payload: T, options?: PublishOptions): Promise<number>;
    /**
     * Subscribe to a declared event, routed to Redis pub/sub or message-queue
     * polling by the declaration's `transport`. Synchronous — the returned
     * handle is usable immediately, while the underlying attach completes in
     * the background (`unsubscribe()` awaits it).
     *
     * `options` (`pollingInterval`, `batchSize`, `visibilityTimeout`) apply
     * to durable events only and are ignored for signal events.
     *
     * @throws synchronously when the event is not declared, or when a signal
     *   event's declared `channel` is a function (per-payload channels can't
     *   be resolved without a payload).
     * @remarks Registration with the remote registry is fire-and-forget: a
     *   failure warns and leaves the local subscription working, so "who
     *   consumes X?" on the server may be incomplete. Handler exceptions are
     *   swallowed and logged on the signal path; on the durable path they
     *   trigger redelivery and eventual dead-lettering.
     */
    subscribe<T = unknown>(eventName: string, handler: EventHandler<T>, options?: SubscribeOptions): Subscription;
    /**
     * The live local registry. Returned by reference — mutating it changes
     * this catalog's behaviour, so treat it as read-only unless you mean
     * otherwise. Prefer {@link resolveEvent} for name lookups.
     */
    getRegistry(): Registry;
    /**
     * Phase 20-a — alias-aware public lookup. Returns the canonical
     * RegistryEntry plus alias-info if the caller queried by a deprecated
     * name. Use this for "what's my canonical name for this old alias?"
     * audits without reaching into `getRegistry()`.
     */
    resolveEvent(name: string): ResolveResult | undefined;
    /**
     * The underlying Redis transport, for health checks, per-channel metrics
     * and drop counters. Publishing through it directly bypasses schema
     * validation, alias resolution and hooks — use {@link publish} instead.
     */
    getSignalTransport(): SignalTransport;
    /**
     * The underlying message-queue transport, for health checks, queue
     * metrics and the in-memory DLQ. Publishing through it directly bypasses
     * schema validation, alias resolution and hooks — use {@link publish}.
     */
    getDurableTransport(): DurableTransport;
    /**
     * True once `connect()` has resolved. Says nothing about whether Redis
     * or message-queue are currently healthy — ask the transports'
     * `healthCheck()` for that.
     */
    isConnected(): boolean;
    /**
     * Publishes discarded because a transport was not connected — with
     * `eventName`, that event's count; without, a copy of the whole map.
     *
     * These publishes resolved successfully from the caller's point of view
     * but delivered nothing, so this counter (or the `onPublishDropped`
     * callback) is the only way to notice. A non-zero value means events
     * were lost. Process-local; resets on restart.
     */
    getDroppedPublishCount(eventName: string): number;
    getDroppedPublishCount(): Map<string, number>;
    /** Count a dropped publish and notify the configured observer. */
    private recordDroppedPublish;
    /**
     * Message for "you referenced an event nobody declared". Includes what
     * to do next and the closest declared names — colon/dot confusion
     * (`pipeline.run.started` vs `pipeline:run:started`) is the usual cause.
     */
    private undeclaredEventMessage;
    private warnDeprecatedAlias;
    private scheduleBackgroundSync;
    private syncToRemoteRegistry;
    private registerSubscriberRemote;
    private deregisterSubscriberRemote;
}
export {};
//# sourceMappingURL=index.d.ts.map