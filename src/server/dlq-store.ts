import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';

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

const DEFAULT_TTL_SECONDS = 30 * 86400;

export class DLQStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
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
    const { eventName, limit = 100 } = opts;

    if (eventName) {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `DLQ#${eventName}` },
        Limit: limit,
        ScanIndexForward: false,
      }));
      return (result.Items ?? []) as DLQEntry[];
    }

    // Without a specific eventName, scan all known partitions
    // In practice this does a full table scan — acceptable for an admin/debug endpoint
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
      Limit: limit,
    }));
    return (result.Items ?? []) as DLQEntry[];
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
    const entries = eventName
      ? await this.list({ eventName, limit: 1000 })
      : await this.list({ limit: 1000 });

    if (entries.length === 0) return 0;

    const batches: DLQEntry[][] = [];
    for (let i = 0; i < entries.length; i += 25) {
      batches.push(entries.slice(i, i + 25));
    }

    let deleted = 0;
    for (const batch of batches) {
      await this.client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map(entry => ({
            DeleteRequest: { Key: { pk: entry.pk, sk: entry.sk } },
          })),
        },
      }));
      deleted += batch.length;
    }

    return deleted;
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
