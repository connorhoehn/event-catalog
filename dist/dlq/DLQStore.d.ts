import type { DLQRecord, DLQQueryOptions } from './types.js';
export interface IDLQStore {
    append(record: DLQRecord): Promise<void>;
    list(opts?: DLQQueryOptions): Promise<DLQRecord[]>;
    delete(id: string): Promise<void>;
    clear(eventName?: string): Promise<void>;
}
/**
 * In-memory DLQ store — bounded ring buffer capped at 1000 records.
 * Oldest records are dropped when the buffer is full. Suitable for
 * tests and local development. Not durable across restarts.
 */
export declare class InMemoryDLQStore implements IDLQStore {
    private readonly records;
    append(record: DLQRecord): Promise<void>;
    list(opts?: DLQQueryOptions): Promise<DLQRecord[]>;
    delete(id: string): Promise<void>;
    clear(eventName?: string): Promise<void>;
    /** For tests — synchronous read of current record count. */
    size(): number;
}
//# sourceMappingURL=DLQStore.d.ts.map