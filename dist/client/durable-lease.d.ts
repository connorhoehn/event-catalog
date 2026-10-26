import type { HttpMessageQueue, QueueMessage } from '@connorhoehnslalom/message-queue/client';
export interface DurableHandlerContext {
    /** Aborted on lease loss or drain expiry. Business writes still need idempotency. */
    readonly signal: AbortSignal;
    readonly messageId: string;
    readonly receiveCount: number;
}
/** One acquired delivery. Renewals and terminal acknowledgement never overlap. */
export declare class DurableLease {
    private readonly client;
    private readonly queue;
    private readonly visibilityMs;
    private readonly timeoutMs;
    private receipt;
    private deadline;
    private renewal?;
    private expiry?;
    private renewing?;
    private terminal;
    private closed;
    private readonly cancellation;
    private readonly io;
    readonly context: DurableHandlerContext;
    constructor(client: Pick<HttpMessageQueue, 'ack' | 'extend'>, queue: string, message: QueueMessage, visibilityMs: number, acquiredAt: number, timeoutMs: number);
    get active(): boolean;
    private clearTimers;
    abandon(reason?: unknown): void;
    private assertActive;
    private requestOptions;
    private arm;
    private renew;
    acknowledge(): Promise<void>;
    /** Bound an uncooperative handler after ownership loss without a late ACK. */
    run<T>(operation: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=durable-lease.d.ts.map