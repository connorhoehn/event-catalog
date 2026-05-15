import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import type { EventCatalogConfig, EventDeclaration, EventHandler, PublishOptions, Subscription, SubscribeOptions } from '../types/index';
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