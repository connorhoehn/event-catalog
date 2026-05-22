import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
export interface DLQEntry {
    id: string;
    pk: string;
    sk: string;
    eventName: string;
    payload: unknown;
    error: string;
    attempts: number;
    deadAt: string;
    ttl: number;
}
export interface DLQPutInput {
    eventName: string;
    payload: unknown;
    error: string;
    attempts: number;
    deadAt: string;
}
export interface DLQListOptions {
    eventName?: string;
    limit?: number;
}
export declare class DLQStore {
    private readonly client;
    private readonly tableName;
    private readonly backoff;
    constructor(client: DynamoDBDocumentClient, tableName: string, backoff?: (attempt: number) => Promise<void>);
    /**
     * Phase E5.3 — `retentionSeconds` overrides the global 30-day default
     * on a per-entry basis. Wired by the server's onDeadLetter hook from
     * the corresponding EventDeclaration.dlqRetention.
     */
    put(entry: DLQPutInput, retentionSeconds?: number): Promise<DLQEntry>;
    list(opts?: DLQListOptions): Promise<DLQEntry[]>;
    remove(id: string): Promise<boolean>;
    clear(eventName?: string): Promise<number>;
    private batchDeleteWithRetry;
    findById(id: string): Promise<DLQEntry | null>;
}
//# sourceMappingURL=dlq-store.d.ts.map