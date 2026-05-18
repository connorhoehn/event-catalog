import type { EventEnvelope } from '../types/index';
export interface DurableTransportConfig {
    url: string;
    retryAttempts?: number;
    retryBaseMs?: number;
    /** Max processing attempts before a message is dead-lettered. Default: 3 */
    maxProcessingAttempts?: number;
    /** Maximum number of dead-lettered messages to retain in memory. Default: 10000 */
    dlqCapacity?: number;
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
/**
 * Subset of an event-catalog EventDeclaration's durable-side config that
 * affects queue creation. Passed by EventCatalog.publish() (Phase 4.2)
 * so DurableTransport.ensureQueue() can PUT the right shape without
 * coupling to the full EventDeclaration type.
 */
export interface EnsureQueueOptions {
    /** Message retention in seconds (maps to message_retention_period_seconds). */
    retention?: number;
    /** FIFO queue ordering (maps to fifo_queue). */
    fifo?: boolean;
    /**
     * Auto-route to DLQ after this many delivery attempts. When set,
     * ensureQueue auto-creates a paired DLQ (named `${queue}-dlq` by
     * default) and wires redrive_policy on the main queue.
     */
    dlqAfterAttempts?: number;
    /** Override the auto-derived DLQ name. */
    dlqQueueName?: string;
}
interface QueueMetrics {
    sent: number;
    received: number;
    failed: number;
    inFlight: number;
}
type MessageHandler = (envelope: EventEnvelope) => Promise<void>;
export type DeadLetterCallback = (message: DeadLetteredMessage) => void;
export declare class DurableTransport {
    private readonly url;
    /** message-queue's canonical versioned queue surface (Roadmap 4.1). */
    private readonly queuesBase;
    private readonly retryAttempts;
    private readonly retryBaseMs;
    private readonly maxProcessingAttempts;
    private readonly dlqCapacity;
    private readonly retryManager;
    private readonly pollRetryManager;
    private connected;
    private activePollers;
    private queueMetrics;
    private ensuredQueues;
    private readonly deadLetterMessages;
    private readonly messageAttempts;
    private deadLetterCallbacks;
    constructor(config: DurableTransportConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    /**
     * Idempotent queue ensure via PUT (message-queue Phase 4.1 contract).
     * Maps event-catalog's declared queue config (retention/fifo/dlqAfterAttempts)
     * onto message-queue's QueueConfiguration shape. Three response codes
     * are handled distinctly:
     *
     *   201 — created with the requested config.
     *   200 — already existed with matching config (no change).
     *   409 — already existed with DIFFERING config; conflict body logged
     *         at warn level. The publish path still proceeds — operator
     *         must decide whether to delete-and-recreate or accept the
     *         drift. We do NOT auto-mutate the existing queue.
     *
     * When `dlqAfterAttempts` is declared, the paired DLQ queue is
     * auto-created first under the name `${queueName}-dlq` (conventional;
     * mirrors AWS SQS-redrive naming). If the DLQ ensure fails the main
     * queue is still attempted without redrive_policy — better to land
     * messages on the live queue than to refuse delivery.
     */
    ensureQueue(queueName: string, options?: EnsureQueueOptions): Promise<void>;
    /**
     * Map an event-catalog declaration's queue-config fields to
     * message-queue's snake_case QueueConfiguration shape.
     */
    private buildQueueConfig;
    /**
     * Single PUT to /api/v1/queues/{name}. Returns true on 200/201, false on 409
     * (logs the conflict diff) or any other status / network error.
     */
    private putQueue;
    publish(queueName: string, envelope: EventEnvelope, queueOptions?: EnsureQueueOptions): Promise<void>;
    subscribe(queueName: string, handler: MessageHandler, options?: DurableSubscribeOptions): () => void;
    getQueueAttributes(queueName: string): Promise<Record<string, unknown> | null>;
    getMetrics(queueName?: string): Map<string, QueueMetrics> | QueueMetrics | undefined;
    getAllMetrics(): Map<string, QueueMetrics>;
    getDLQ(): DeadLetteredMessage[];
    drainDLQ(): DeadLetteredMessage[];
    onDeadLetter(callback: DeadLetterCallback): () => void;
    isConnected(): boolean;
    healthCheck(): Promise<{
        status: 'connected' | 'degraded' | 'disconnected';
        latencyMs: number;
    }>;
    private pollLoop;
    private sleep;
    private incrementMetric;
    private decrementInFlight;
    static eventNameToQueueName(eventName: string): string;
}
export {};
//# sourceMappingURL=durable.d.ts.map