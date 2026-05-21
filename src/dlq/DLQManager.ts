import crypto from 'node:crypto';
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
export class DLQManager {
  constructor(private readonly store: IDLQStore) {}

  /**
   * Add a failed event to the DLQ.
   * Fire-and-forget: store errors are swallowed and logged, not thrown.
   */
  async append(
    eventName: string,
    payload: unknown,
    reason: DLQReason,
    errorMessage?: string,
  ): Promise<void> {
    const record: DLQRecord = {
      id: crypto.randomUUID(),
      eventName,
      payload,
      reason,
      errorMessage,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    try {
      await this.store.append(record);
    } catch (err) {
      console.error('[DLQManager] Failed to append record to store:', err);
    }
  }

  /** List DLQ records, optionally filtered by eventName or reason. */
  async list(opts?: DLQQueryOptions): Promise<DLQRecord[]> {
    return this.store.list(opts);
  }

  /**
   * Replay a batch of DLQ records through a handler function.
   * Successfully replayed records are deleted from the DLQ.
   * Failed replays increment retryCount and update lastReplayedAt.
   */
  async replay(
    records: DLQRecord[],
    handler: (record: DLQRecord) => Promise<void>,
  ): Promise<ReplayResult> {
    const result: ReplayResult = { replayed: 0, failed: 0, errors: [] };

    for (const record of records) {
      try {
        await handler(record);
        await this.store.delete(record.id);
        result.replayed++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        result.failed++;
        result.errors.push({ id: record.id, error: errorMessage });

        // Update retry metadata — mutate then re-append as a delete+put
        // since IDLQStore has no update surface. This keeps the interface
        // minimal while preserving correct retry state.
        const updated: DLQRecord = {
          ...record,
          retryCount: record.retryCount + 1,
          lastReplayedAt: new Date().toISOString(),
        };
        try {
          await this.store.delete(record.id);
          await this.store.append(updated);
        } catch (storeErr) {
          console.error('[DLQManager] Failed to update retry state for record', record.id, storeErr);
        }
      }
    }

    return result;
  }

  /** Delete a specific record by ID. */
  async delete(id: string): Promise<void> {
    return this.store.delete(id);
  }

  /** Clear all records, or records for a specific event. */
  async clear(eventName?: string): Promise<void> {
    return this.store.clear(eventName);
  }
}
