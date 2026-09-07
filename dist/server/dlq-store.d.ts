import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DeadLetteredMessage } from '../client/durable.js';
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
/**
 * The single shape `GET /api/transports/durable/dlq` serves, whichever
 * source answered.
 *
 * Before this existed the route returned raw {@link DLQEntry} rows on the
 * happy path and raw `DeadLetteredMessage` objects (`messageId`/`envelope`)
 * from the in-process mirror when DynamoDB was down — two different
 * shapes under the same 200, switching precisely during an outage, i.e.
 * exactly when someone is reading the DLQ. Both sources are now
 * normalized into this shape by {@link toDlqWireEntry}.
 *
 * `pk`/`sk` are gone: they are the DynamoDB composite key, a storage
 * detail that was never meaningful to an HTTP client and is trivially
 * re-derivable (`DLQ#<eventName>` / `<deadAt>#<id>`). `ttl` is gone too,
 * replaced by `expiresAt` — the same fact as an ISO-8601 instant rather
 * than DynamoDB's epoch-seconds TTL attribute, and absent when the
 * answering source has no expiry concept.
 */
export interface DlqWireEntry {
    /** Stable entry id — the same value the replay/delete routes take. */
    id: string;
    eventName: string;
    payload: unknown;
    /** Why the message was dead-lettered. */
    error: string;
    /** Delivery attempts made before dead-lettering. */
    attempts: number;
    /** ISO-8601 instant the message was dead-lettered. */
    deadAt: string;
    /** ISO-8601 expiry, when the answering source expires entries. */
    expiresAt?: string;
}
/** A `DeadLetteredMessage` read defensively — see {@link toDlqWireEntry}. */
type LooseDeadLetteredMessage = Partial<DeadLetteredMessage> & {
    /** Older mirrors keyed the entry `id` rather than `messageId`. */
    id?: string;
    /** …and carried a bare payload instead of a full envelope. */
    eventName?: string;
    payload?: unknown;
    deadAt?: string;
};
/**
 * Normalize either source's entry into the single wire shape.
 *
 * The in-memory branch reads defensively rather than trusting
 * `DeadLetteredMessage` field-for-field: this path only ever runs while
 * the durable store is already failing, and serving `undefined` fields
 * to an operator mid-outage would be a second failure on top of the
 * first. `messageId` wins over `id`, and `envelope.eventName`/
 * `envelope.payload` over the bare top-level equivalents.
 */
export declare function toDlqWireEntry(entry: DLQEntry | LooseDeadLetteredMessage): DlqWireEntry;
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
export {};
//# sourceMappingURL=dlq-store.d.ts.map