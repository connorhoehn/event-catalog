import type { EventEnvelope } from '../types/index';
import { type ChannelMessageEnvelope } from '../types/envelopes';
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
    /**
     * Gateway-compatible channel-message publish (wave1-ec-3).
     *
     * Unlike `publish(channel, EventEnvelope)`, which is the generic
     * pub/sub primitive and writes to a per-channel history ring buffer,
     * this method publishes the websocket-gateway's `ChannelMessageEnvelope`
     * shape on `websocket:route:{channelId}` and looks up the target gateway
     * nodes from `websocket:channel:{channelId}:nodes` (set populated by
     * the gateway's NodeManager).
     *
     * Skips the publish when no nodes are subscribed (returns 0).
     * Does NOT write to ring buffer — the gateway has its own history.
     *
     * Returns the number of target nodes the envelope was addressed to.
     */
    publishChannelMessage(channelId: string, envelope: ChannelMessageEnvelope): Promise<number>;
    subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>>;
    getHistory(channel: string, count?: number): Promise<EventEnvelope[]>;
    getMetrics(channel?: string): Map<string, ChannelMetrics> | ChannelMetrics | undefined;
    getAllMetrics(): Map<string, ChannelMetrics>;
    isConnected(): boolean;
    healthCheck(): Promise<{
        status: 'connected' | 'degraded' | 'disconnected';
        latencyMs: number;
    }>;
    private incrementMetrics;
    private updateSubscriberCount;
}
export {};
//# sourceMappingURL=signal.d.ts.map