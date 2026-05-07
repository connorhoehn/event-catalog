import type { EventEnvelope } from '../types/index';
export interface SignalTransportConfig {
    url: string;
    ringBufferSize?: number;
}
interface ChannelMetrics {
    publishCount: number;
    lastPublishedAt: string | null;
    subscriberCount: number;
}
type MessageHandler = (envelope: EventEnvelope) => void;
export declare class SignalTransport {
    private publishClient;
    private subscribeClient;
    private readonly url;
    private readonly ringBufferSize;
    private connected;
    private subscriptions;
    private channelMetrics;
    private readonly circuitBreaker;
    constructor(config: SignalTransportConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    publish(channel: string, envelope: EventEnvelope): Promise<void>;
    subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>>;
    getHistory(channel: string, count?: number): Promise<EventEnvelope[]>;
    getMetrics(channel?: string): Map<string, ChannelMetrics> | ChannelMetrics | undefined;
    getAllMetrics(): Map<string, ChannelMetrics>;
    isConnected(): boolean;
    private incrementMetrics;
    private updateSubscriberCount;
}
export {};
//# sourceMappingURL=signal.d.ts.map