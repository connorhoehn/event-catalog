import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';
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

function isDlqEntry(entry: DLQEntry | LooseDeadLetteredMessage): entry is DLQEntry {
  return typeof (entry as DLQEntry).deadAt === 'string'
    && (entry as LooseDeadLetteredMessage).envelope === undefined;
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
export function toDlqWireEntry(
  entry: DLQEntry | LooseDeadLetteredMessage,
): DlqWireEntry {
  if (isDlqEntry(entry)) {
    const wire: DlqWireEntry = {
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

const DEFAULT_TTL_SECONDS = 30 * 86400;
const BATCH_WRITE_MAX_RETRIES = 5;
const defaultBackoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));

export class DLQStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    // Injectable for tests; defaults to exponential backoff
    // (50ms, 100ms, 200ms, 400ms, 800ms).
    private readonly backoff: (attempt: number) => Promise<void> = defaultBackoff,
  ) {}

  /**
   * Phase E5.3 — `retentionSeconds` overrides the global 30-day default
   * on a per-entry basis. Wired by the server's onDeadLetter hook from
   * the corresponding EventDeclaration.dlqRetention.
   */
  async put(entry: DLQPutInput, retentionSeconds?: number): Promise<DLQEntry> {
    const id = crypto.randomUUID();
    const ttl = Math.floor(Date.now() / 1000)
      + (retentionSeconds ?? DEFAULT_TTL_SECONDS);

    const item: DLQEntry = {
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

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));

    return item;
  }

  async list(opts: DLQListOptions = {}): Promise<DLQEntry[]> {
    // Paginate via LastEvaluatedKey: DynamoDB's `Limit` caps items
    // *evaluated* per page, not items returned. A 1MB page boundary
    // (or single-partition Query cap) can short-return well below the
    // caller's requested limit, silently hiding entries past the first
    // page. Same hazard class as clear() and findById() (commits
    // 5b0e2a9, c088584; hub #806, #849).
    const { eventName, limit = 100 } = opts;
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');

    const items: DLQEntry[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const remaining = limit - items.length;
      const result = eventName
        ? await this.client.send(new QueryCommand({
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

      for (const entry of (result.Items ?? []) as DLQEntry[]) {
        if (items.length >= limit) break;
        items.push(entry);
      }

      ExclusiveStartKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (ExclusiveStartKey && items.length < limit);

    return items;
  }

  async remove(id: string): Promise<boolean> {
    const entry = await this.findById(id);
    if (!entry) return false;

    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: entry.pk, sk: entry.sk },
    }));
    return true;
  }

  async clear(eventName?: string): Promise<number> {
    // Paginate via LastEvaluatedKey so a partition (or table) larger than
    // one DynamoDB page (1MB or the implicit Query/Scan cap) is fully
    // drained. Without this loop, clear() silently leaves items past the
    // first page and returns a deleted count that doesn't match reality.
    // Same pagination hazard as findById (commit c088584 / hub #806).
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    let deleted = 0;

    do {
      const result = eventName
        ? await this.client.send(new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': `DLQ#${eventName}` },
            ExclusiveStartKey,
          }))
        : await this.client.send(new ScanCommand({
            TableName: this.tableName,
            ExclusiveStartKey,
          }));

      const entries = (result.Items ?? []) as DLQEntry[];

      for (let i = 0; i < entries.length; i += 25) {
        const batch = entries.slice(i, i + 25);
        deleted += await this.batchDeleteWithRetry(
          batch.map(entry => ({
            DeleteRequest: { Key: { pk: entry.pk, sk: entry.sk } },
          })),
        );
      }

      ExclusiveStartKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (ExclusiveStartKey);

    return deleted;
  }

  // BatchWriteItem partial-success handling: DDB returns failed/throttled
  // DeleteRequests in `UnprocessedItems` rather than failing the call.
  // Retry those with exponential backoff and only count items actually
  // accepted by DDB toward `deleted`. Same silent-drift hazard class as
  // the pagination fixes (commits c088584 / 5b0e2a9 / bbeaeca).
  private async batchDeleteWithRetry(
    requests: Array<{ DeleteRequest: { Key: { pk: string; sk: string } } }>,
  ): Promise<number> {
    let pending = requests;
    for (let attempt = 0; ; attempt++) {
      const result = await this.client.send(new BatchWriteCommand({
        RequestItems: { [this.tableName]: pending },
      }));
      const unprocessed = (result.UnprocessedItems?.[this.tableName] ?? []) as typeof pending;
      if (unprocessed.length === 0) return requests.length;
      if (attempt >= BATCH_WRITE_MAX_RETRIES) {
        throw new Error(
          `DLQStore.clear: ${unprocessed.length} of ${requests.length} ` +
          `BatchWrite deletes still unprocessed after ${BATCH_WRITE_MAX_RETRIES} retries`,
        );
      }
      await this.backoff(attempt);
      pending = unprocessed;
    }
  }

  async findById(id: string): Promise<DLQEntry | null> {
    // Paginate the Scan: DynamoDB applies `Limit` to items evaluated,
    // not to items matched by `FilterExpression`. Capping at 1 would
    // silently miss entries past the first scanned page. Loop on
    // LastEvaluatedKey until found or table exhausted.
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': id },
        ExclusiveStartKey,
      }));
      const found = result.Items?.[0] as DLQEntry | undefined;
      if (found) return found;
      ExclusiveStartKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (ExclusiveStartKey);
    return null;
  }
}
