import type { EventEnvelope } from '../types/index';
export interface DurableTransportConfig {
    url: string;
    retryAttempts?: number;
    retryBaseMs?: number;
    /** Max processing attempts before a message is dead-lettered. Default: 3 */
    maxProcessingAttempts?: number;
}
export interface DeadLetteredMessage {
    messageId: string;
    queueName: string;
    envelope: EventEnvelope;
    error: string;
    attempts: number;
    deadLetteredAt: string;
}
export interface DurableSubscribeOptions {
    pollingInterval?: number;
    batchSize?: number;
    visibilityTimeout?: number;
}
interface QueueMetrics {
    sent: number;
    received: number;
    failed: number;
    inFlight: number;
}
type MessageHandler = (envelope: EventEnvelope) => Promise<void>;
export declare class DurableTransport {
    private readonly url;
    private readonly retryAttempts;
    private readonly retryBaseMs;
    private readonly maxProcessingAttempts;
    private readonly retryManager;
    private readonly pollRetryManager;
    private connected;
    private activePollers;
    private queueMetrics;
    private ensuredQueues;
    private readonly deadLetterMessages;
    private readonly messageAttempts;
    constructor(config: DurableTransportConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    ensureQueue(queueName: string): Promise<void>;
    publish(queueName: string, envelope: EventEnvelope): Promise<void>;
    subscribe(queueName: string, handler: MessageHandler, options?: DurableSubscribeOptions): () => void;
    getQueueAttributes(queueName: string): Promise<Record<string, unknown> | null>;
    getMetrics(queueName?: string): Map<string, QueueMetrics> | QueueMetrics | undefined;
    getAllMetrics(): Map<string, QueueMetrics>;
    getDLQ(): DeadLetteredMessage[];
    isConnected(): boolean;
    private pollLoop;
    private sleep;
    private incrementMetric;
    private decrementInFlight;
    static eventNameToQueueName(eventName: string): string;
}
export {};
//# sourceMappingURL=durable.d.ts.map