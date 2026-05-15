// Phase E5.3 — per-event DLQ retention.
//
// Verifies DLQStore.put() honors the optional retentionSeconds override
// and falls back to the 30-day default when omitted.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DLQStore } from '../src/server/dlq-store.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const FIXED_NOW_SECONDS = Math.floor(FIXED_NOW_MS / 1000);

describe('DLQStore retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW_MS));
  });

  it('defaults TTL to 30 days when no retention override is supplied', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as DynamoDBDocumentClient;
    const store = new DLQStore(client, 'test-dlq');

    const entry = await store.put({
      eventName: 'orders.failed',
      payload: { id: 'o1' },
      error: 'boom',
      attempts: 3,
      deadAt: '2026-05-15T00:00:00.000Z',
    });

    expect(entry.ttl).toBe(FIXED_NOW_SECONDS + 30 * 86400);
    expect(send).toHaveBeenCalledOnce();
    const cmd = send.mock.calls[0]![0] as PutCommand;
    expect(cmd).toBeInstanceOf(PutCommand);
    expect((cmd.input.Item as { ttl: number }).ttl).toBe(entry.ttl);
  });

  it('uses the per-event retentionSeconds override when supplied', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as DynamoDBDocumentClient;
    const store = new DLQStore(client, 'test-dlq');

    // 7 days — short-lived webhook event
    const sevenDays = 7 * 86400;
    const entry = await store.put({
      eventName: 'webhook.delivery',
      payload: { url: 'https://x' },
      error: 'timeout',
      attempts: 5,
      deadAt: '2026-05-15T00:00:00.000Z',
    }, sevenDays);

    expect(entry.ttl).toBe(FIXED_NOW_SECONDS + sevenDays);
  });

  it('accepts a long retention for high-value audit events', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as DynamoDBDocumentClient;
    const store = new DLQStore(client, 'test-dlq');

    // 365 days
    const oneYear = 365 * 86400;
    const entry = await store.put({
      eventName: 'pipeline.approval.recorded',
      payload: { runId: 'r1' },
      error: 'consumer-unhealthy',
      attempts: 10,
      deadAt: '2026-05-15T00:00:00.000Z',
    }, oneYear);

    expect(entry.ttl).toBe(FIXED_NOW_SECONDS + oneYear);
  });
});
