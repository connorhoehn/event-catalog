"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DLQStore = void 0;
exports.toDlqWireEntry = toDlqWireEntry;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const node_crypto_1 = __importDefault(require("node:crypto"));
function isDlqEntry(entry) {
    return typeof entry.deadAt === 'string'
        && entry.envelope === undefined;
}
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
function toDlqWireEntry(entry) {
    if (isDlqEntry(entry)) {
        const wire = {
            id: entry.id,
            eventName: entry.eventName,
            payload: entry.payload,
            error: entry.error,
            attempts: entry.attempts,
            deadAt: entry.deadAt,
        };
        if (typeof entry.ttl === 'number' && Number.isFinite(entry.ttl)) {
            wire.expiresAt = new Date(entry.ttl * 1000).toISOString();
        }
        return wire;
    }
    return {
        id: entry.messageId ?? entry.id ?? '',
        eventName: entry.envelope?.eventName ?? entry.eventName ?? entry.queueName ?? '',
        payload: entry.envelope !== undefined ? entry.envelope.payload : entry.payload,
        error: entry.error ?? '',
        attempts: typeof entry.attempts === 'number' ? entry.attempts : 0,
        deadAt: entry.deadLetteredAt ?? entry.deadAt ?? '',
    };
}
const DEFAULT_TTL_SECONDS = 30 * 86400;
const BATCH_WRITE_MAX_RETRIES = 5;
const defaultBackoff = (attempt) => new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
class DLQStore {
    client;
    tableName;
    backoff;
    constructor(client, tableName, 
    // Injectable for tests; defaults to exponential backoff
    // (50ms, 100ms, 200ms, 400ms, 800ms).
    backoff = defaultBackoff) {
        this.client = client;
        this.tableName = tableName;
        this.backoff = backoff;
    }
    /**
     * Phase E5.3 — `retentionSeconds` overrides the global 30-day default
     * on a per-entry basis. Wired by the server's onDeadLetter hook from
     * the corresponding EventDeclaration.dlqRetention.
     */
    async put(entry, retentionSeconds) {
        const id = node_crypto_1.default.randomUUID();
        const ttl = Math.floor(Date.now() / 1000)
            + (retentionSeconds ?? DEFAULT_TTL_SECONDS);
        const item = {
            id,
            pk: `DLQ#${entry.eventName}`,
            sk: `${entry.deadAt}#${id}`,
            eventName: entry.eventName,
            payload: entry.payload,
            error: entry.error,
            attempts: entry.attempts,
            deadAt: entry.deadAt,
            ttl,
        };
        await this.client.send(new lib_dynamodb_1.PutCommand({
            TableName: this.tableName,
            Item: item,
        }));
        return item;
    }
    async list(opts = {}) {
        // Paginate via LastEvaluatedKey: DynamoDB's `Limit` caps items
        // *evaluated* per page, not items returned. A 1MB page boundary
        // (or single-partition Query cap) can short-return well below the
        // caller's requested limit, silently hiding entries past the first
        // page. Same hazard class as clear() and findById() (commits
        // 5b0e2a9, c088584; hub #806, #849).
        const { eventName, limit = 100 } = opts;
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        const items = [];
        let ExclusiveStartKey;
        do {
            const remaining = limit - items.length;
            const result = eventName
                ? await this.client.send(new lib_dynamodb_1.QueryCommand({
                    TableName: this.tableName,
                    KeyConditionExpression: 'pk = :pk',
                    ExpressionAttributeValues: { ':pk': `DLQ#${eventName}` },
                    Limit: remaining,
                    ScanIndexForward: false,
                    ExclusiveStartKey,
                }))
                : await this.client.send(new ScanCommand({
                    TableName: this.tableName,
                    Limit: remaining,
                    ExclusiveStartKey,
                }));
            for (const entry of (result.Items ?? [])) {
                if (items.length >= limit)
                    break;
                items.push(entry);
            }
            ExclusiveStartKey = result.LastEvaluatedKey;
        } while (ExclusiveStartKey && items.length < limit);
        return items;
    }
    async remove(id) {
        const entry = await this.findById(id);
        if (!entry)
            return false;
        await this.client.send(new lib_dynamodb_1.DeleteCommand({
            TableName: this.tableName,
            Key: { pk: entry.pk, sk: entry.sk },
        }));
        return true;
    }
    async clear(eventName) {
        // Paginate via LastEvaluatedKey so a partition (or table) larger than
        // one DynamoDB page (1MB or the implicit Query/Scan cap) is fully
        // drained. Without this loop, clear() silently leaves items past the
        // first page and returns a deleted count that doesn't match reality.
        // Same pagination hazard as findById (commit c088584 / hub #806).
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        let ExclusiveStartKey;
        let deleted = 0;
        // A throw from a later page used to discard the count of everything
        // already deleted, so the caller was told "0 cleared" after thousands
        // of real deletions and could not tell what remained. The count travels
        // on the error instead.
        try {
            do {
                const result = eventName
                    ? await this.client.send(new lib_dynamodb_1.QueryCommand({
                        TableName: this.tableName,
                        KeyConditionExpression: 'pk = :pk',
                        ExpressionAttributeValues: { ':pk': `DLQ#${eventName}` },
                        ExclusiveStartKey,
                    }))
                    : await this.client.send(new ScanCommand({
                        TableName: this.tableName,
                        ExclusiveStartKey,
                    }));
                const entries = (result.Items ?? []);
                for (let i = 0; i < entries.length; i += 25) {
                    const batch = entries.slice(i, i + 25);
                    deleted += await this.batchDeleteWithRetry(batch.map(entry => ({
                        DeleteRequest: { Key: { pk: entry.pk, sk: entry.sk } },
                    })));
                }
                ExclusiveStartKey = result.LastEvaluatedKey;
            } while (ExclusiveStartKey);
        }
        catch (err) {
            throw Object.assign(new Error(`DLQ clear stopped after deleting ${deleted} entr${deleted === 1 ? 'y' : 'ies'}: `
                + (err instanceof Error ? err.message : String(err)), { cause: err }), { deleted });
        }
        return deleted;
    }
    // BatchWriteItem partial-success handling: DDB returns failed/throttled
    // DeleteRequests in `UnprocessedItems` rather than failing the call.
    // Retry those with exponential backoff and only count items actually
    // accepted by DDB toward `deleted`. Same silent-drift hazard class as
    // the pagination fixes (commits c088584 / 5b0e2a9 / bbeaeca).
    async batchDeleteWithRetry(requests) {
        let pending = requests;
        for (let attempt = 0;; attempt++) {
            const result = await this.client.send(new lib_dynamodb_1.BatchWriteCommand({
                RequestItems: { [this.tableName]: pending },
            }));
            const unprocessed = (result.UnprocessedItems?.[this.tableName] ?? []);
            if (unprocessed.length === 0)
                return requests.length;
            if (attempt >= BATCH_WRITE_MAX_RETRIES) {
                throw new Error(`DLQStore.clear: ${unprocessed.length} of ${requests.length} ` +
                    `BatchWrite deletes still unprocessed after ${BATCH_WRITE_MAX_RETRIES} retries`);
            }
            await this.backoff(attempt);
            pending = unprocessed;
        }
    }
    async findById(id) {
        // Paginate the Scan: DynamoDB applies `Limit` to items evaluated,
        // not to items matched by `FilterExpression`. Capping at 1 would
        // silently miss entries past the first scanned page. Loop on
        // LastEvaluatedKey until found or table exhausted.
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        let ExclusiveStartKey;
        do {
            const result = await this.client.send(new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'id = :id',
                ExpressionAttributeValues: { ':id': id },
                ExclusiveStartKey,
            }));
            const found = result.Items?.[0];
            if (found)
                return found;
            ExclusiveStartKey = result.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        return null;
    }
}
exports.DLQStore = DLQStore;
//# sourceMappingURL=dlq-store.js.map