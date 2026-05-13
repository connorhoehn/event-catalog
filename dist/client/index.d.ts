import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import type { EventCatalogConfig, EventDeclaration, EventHandler, PublishOptions, Subscription, SubscribeOptions } from '../types/index';
export declare class EventCatalog {
    private readonly config;
    private readonly registry;
    private readonly signal;
    private readonly durable;
    private readonly syncRetryManager;
    private connected;
    private resyncInterval;
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
    subscribe<T = unknown>(eventName: string, handler: EventHandler<T>, options?: SubscribeOptions): Subscription;
    getRegistry(): Registry;
    getSignalTransport(): SignalTransport;
    getDurableTransport(): DurableTransport;
    isConnected(): boolean;
    private scheduleBackgroundSync;
    private syncToRemoteRegistry;
    private registerSubscriberRemote;
    private deregisterSubscriberRemote;
}
//# sourceMappingURL=index.d.ts.map