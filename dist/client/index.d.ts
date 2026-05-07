import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import type { EventCatalogConfig, EventDeclaration, EventHandler, PublishOptions, Subscription, SubscribeOptions } from '../types/index';
export declare class EventCatalog {
    private readonly config;
    private readonly registry;
    private readonly signal;
    private readonly durable;
    private connected;
    constructor(config: EventCatalogConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    declare(event: EventDeclaration): void;
    publish<T = unknown>(eventName: string, payload: T, options?: PublishOptions): Promise<void>;
    subscribe<T = unknown>(eventName: string, handler: EventHandler<T>, options?: SubscribeOptions): Subscription;
    getRegistry(): Registry;
    getSignalTransport(): SignalTransport;
    getDurableTransport(): DurableTransport;
    isConnected(): boolean;
    private syncToRemoteRegistry;
    private registerSubscriberRemote;
    private deregisterSubscriberRemote;
}
//# sourceMappingURL=index.d.ts.map