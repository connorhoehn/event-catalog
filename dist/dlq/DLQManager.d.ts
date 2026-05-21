import type { IDLQStore } from './DLQStore.js';
import type { DLQRecord, DLQReason, DLQQueryOptions, ReplayResult } from './types.js';
/**
 * Manages the dead-letter queue for failed events.
 *
 * Usage:
 *   const dlq = new DLQManager(new InMemoryDLQStore());
 *   await dlq.append('pipeline.run.started', payload, 'VALIDATION_FAILED', 'Missing runId');
 *   const records = await dlq.list({ eventName: 'pipeline.run.started' });
 *   const result = await dlq.replay(records, async (record) => {
 *     await myPublisher(record.eventName, record.payload);
 *   });
 */
export declare class DLQManager {
    private readonly store;
    constructor(store: IDLQStore);
    /**
     * Add a failed event to the DLQ.
     * Fire-and-forget: store errors are swallowed and logged, not thrown.
     */
    append(eventName: string, payload: unknown, reason: DLQReason, errorMessage?: string): Promise<void>;
    /** List DLQ records, optionally filtered by eventName or reason. */
    list(opts?: DLQQueryOptions): Promise<DLQRecord[]>;
    /**
     * Replay a batch of DLQ records through a handler function.
     * Successfully replayed records are deleted from the DLQ.
     * Failed replays increment retryCount and update lastReplayedAt.
     */
    replay(records: DLQRecord[], handler: (record: DLQRecord) => Promise<void>): Promise<ReplayResult>;
    /** Delete a specific record by ID. */
    delete(id: string): Promise<void>;
    /** Clear all records, or records for a specific event. */
    clear(eventName?: string): Promise<void>;
}
//# sourceMappingURL=DLQManager.d.ts.map