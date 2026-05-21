/** A failed event that was routed to the dead-letter queue. */
export interface DLQRecord<T = unknown> {
    /** Unique record ID (uuid). */
    id: string;
    /** The event type/name that failed (e.g. 'pipeline.run.started'). */
    eventName: string;
    /** The raw payload that failed validation or delivery. */
    payload: T;
    /** Human-readable reason for DLQ routing. */
    reason: DLQReason;
    /** Optional detail from the original error. */
    errorMessage?: string;
    /** ISO-8601 timestamp when the record was added. */
    enqueuedAt: string;
    /** Number of replay attempts so far. */
    retryCount: number;
    /** ISO-8601 timestamp of last replay attempt. */
    lastReplayedAt?: string;
}
export type DLQReason = 'VALIDATION_FAILED' | 'DELIVERY_FAILED' | 'UNKNOWN_EVENT_TYPE';
export interface DLQQueryOptions {
    eventName?: string;
    limit?: number;
    reason?: DLQReason;
}
export interface ReplayResult {
    replayed: number;
    failed: number;
    errors: Array<{
        id: string;
        error: string;
    }>;
}
//# sourceMappingURL=types.d.ts.map