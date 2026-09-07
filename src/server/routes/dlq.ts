// src/server/routes/dlq.ts
//
// Durable-transport dead-letter queue: listing, single-entry delete,
// single + batch redrive, and bulk clear.

import type { Request, Response } from '../http-router.js';
import { DurableTransport } from '../../client/durable.js';
import { badRequest, type RoutesDeps } from './_shared.js';

const MAX_DLQ_LIMIT = 1000;

// Express delivers duplicate `?eventName=A&eventName=B` as an array, which
// silently coerces to `'A,B'` when passed to the DDB Query — wrong partition,
// 0 entries, looks like a clean DLQ. Reject the array form loudly so
// operators don't act on phantom-empty state. Same silent-drift hazard
// class as the dlq-store pagination fixes (hub #806/#842/#858/#883).
function parseDlqEventName(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'eventName must be a single string' };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed === '' ? undefined : trimmed };
}

function parseDlqLimit(
  raw: unknown,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'limit must be a single integer' };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_DLQ_LIMIT) {
    return {
      ok: false,
      error: `limit must be a positive integer ≤ ${MAX_DLQ_LIMIT}`,
    };
  }
  return { ok: true, value: parsed };
}

export function createDlqHandlers(deps: RoutesDeps) {
  const { durable, dlqStore } = deps;

  // Durable transport dead-letter queue (persisted)
  async function list(req: Request, res: Response): Promise<void> {
    const eventNameResult = parseDlqEventName(req.query.eventName);
    if (!eventNameResult.ok) {
      badRequest(res, eventNameResult.error);
      return;
    }
    const limitResult = parseDlqLimit(req.query.limit);
    if (!limitResult.ok) {
      badRequest(res, limitResult.error);
      return;
    }

    try {
      const entries = await dlqStore.list({
        eventName: eventNameResult.value,
        limit: limitResult.value,
      });
      res.json({ messages: entries, total: entries.length });
    } catch (err) {
      const inMemory = durable.getDLQ();
      res.json({ messages: inMemory, total: inMemory.length, source: 'in-memory', error: (err as Error).message });
    }
  }

  // Delete a single DLQ entry
  async function remove(req: Request, res: Response): Promise<void> {
    const removed = await dlqStore.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: `DLQ entry "${req.params.id}" not found` });
      return;
    }
    res.json({ removed: req.params.id });
  }

  // Phase E5.2 — batch redrive. Accepts `{ ids: string[] }` and runs the
  // single-replay logic per id. Reuses each entry's id as the published
  // envelope's idempotency key so partial-failure retries don't double-
  // deliver. Always returns 200 with a per-id breakdown — callers
  // inspect `failed[]` to decide whether to retry.
  async function replayBatch(req: Request, res: Response): Promise<void> {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string')) {
      badRequest(res, 'ids must be a non-empty array of strings');
      return;
    }

    const replayed: Array<{ id: string; eventName: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids as string[]) {
      const entry = await dlqStore.findById(id);
      if (!entry) {
        failed.push({ id, error: 'not found' });
        continue;
      }
      const queueName = DurableTransport.eventNameToQueueName(entry.eventName);
      try {
        await durable.publish(queueName, {
          eventName: entry.eventName,
          payload: entry.payload,
          metadata: { id: entry.id, producer: 'dlq-replay', timestamp: Date.now() },
        });
        await dlqStore.remove(entry.id);
        replayed.push({ id: entry.id, eventName: entry.eventName });
      } catch (err) {
        failed.push({ id, error: (err as Error).message });
      }
    }

    res.json({ replayed, failed, total: ids.length });
  }

  // Bulk-clear DLQ entries. Optional ?eventName= scopes to one event.
  // Returns { cleared: N } so callers know how many entries were removed.
  async function clear(req: Request, res: Response): Promise<void> {
    const eventNameResult = parseDlqEventName(req.query.eventName);
    if (!eventNameResult.ok) {
      badRequest(res, eventNameResult.error);
      return;
    }
    const cleared = await dlqStore.clear(eventNameResult.value);
    res.json({ cleared });
  }

  // Replay a DLQ entry: re-publish to durable transport, then delete
  async function replay(req: Request, res: Response): Promise<void> {
    const entry = await dlqStore.findById(req.params.id);
    if (!entry) {
      res.status(404).json({ error: `DLQ entry "${req.params.id}" not found` });
      return;
    }

    const queueName = DurableTransport.eventNameToQueueName(entry.eventName);
    try {
      await durable.publish(queueName, {
        eventName: entry.eventName,
        payload: entry.payload,
        metadata: { id: entry.id, producer: 'dlq-replay', timestamp: Date.now() },
      });
      await dlqStore.remove(entry.id);
      res.json({ replayed: entry.id, eventName: entry.eventName });
    } catch (err) {
      res.status(500).json({ error: `Replay failed: ${(err as Error).message}` });
    }
  }

  return { list, remove, replayBatch, clear, replay };
}
