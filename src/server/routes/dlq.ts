// src/server/routes/dlq.ts
//
// Durable-transport dead-letter queue: listing, single-entry delete,
// single + batch redrive, and bulk clear.

import type { Request, Response } from '../http-router.js';
import { DurableTransport } from '../../client/durable.js';
import { toDlqWireEntry, type DlqWireEntry } from '../dlq-store.js';
import { badRequest, RouteLog, type RoutesDeps } from './_shared.js';
import { MAX_DLQ_REPLAY_IDS, withinArrayLimit } from './limits.js';

const MAX_DLQ_LIMIT = 1000;

/** Mirrors `DLQStore.list()`'s own default so both sources page alike. */
const DEFAULT_DLQ_LIMIT = 100;

/** Apply the route's `?eventName=`/`?limit=` to an in-memory array. */
function filterWireEntries(
  entries: DlqWireEntry[],
  eventName: string | undefined,
  limit: number,
): DlqWireEntry[] {
  const matched = eventName === undefined
    ? entries
    : entries.filter((entry) => entry.eventName === eventName);
  // The store queries DynamoDB with ScanIndexForward:false, i.e. newest-first,
  // and `?limit=2` there means "the 2 most recent". The in-memory mirror is
  // append-ordered (oldest-first), so slicing its head returned the 2 OLDEST
  // during an outage — same request, same shape, silently inverted meaning.
  // Sort newest-first so degraded reads answer the question that was asked.
  const newestFirst = [...matched].sort(
    (a, b) => Date.parse(b.deadAt) - Date.parse(a.deadAt),
  );
  return newestFirst.slice(0, limit);
}

// ─── Error redaction ─────────────────────────────────────────────────────────
//
// These three sites used to forward `(err as Error).message` straight to
// the client. That message is raw AWS SDK or message-queue text —
// table names, endpoint hostnames, credential-resolution chains, queue
// URLs — none of which the caller can act on and all of which describe
// our internals. The detail is still written to the server log, where an
// operator can read it; the client gets a stable, actionable sentence.
// (The router already redacts uncaught handler errors to
// `InternalServerError`; these were the hand-rolled leaks around it.)

const DLQ_LIST_DEGRADED_MESSAGE =
  'DLQ store unavailable — serving this instance\'s in-memory mirror, '
  + 'which holds only what it dead-lettered since start. Check the server logs.';

const DLQ_REPLAY_FAILED_MESSAGE =
  'Replay failed — the durable transport rejected the message. '
  + 'Retry once it is healthy; see the server logs for detail.';

/**
 * Log the real error under `context`, return the message clients get.
 *
 * `log` is the route family's throttled writer: every caller of this is a
 * request handler, so an unreachable DynamoDB turns each poll of the DLQ
 * browser into a log line. `context` doubles as the throttle key — it is
 * a fixed string per call site, never request input.
 */
function redact(log: RouteLog, context: string, err: unknown, clientMessage: string): string {
  const detail = err instanceof Error ? err.message : String(err);
  // Several contexts embed a DLQ entry id, which is request input. Fold
  // it out of the throttle key so a caller cycling ids cannot mint a
  // fresh dedupe bucket per request.
  const key = context.replace(/"[^"]*"/g, '"*"');
  log.warn(
    `redact:${key}`,
    `[event-catalog] ${context}:`,
    { component: 'routes/dlq', context, error: detail },
    detail,
  );
  return clientMessage;
}

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
  const log = new RouteLog(deps.logger);
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

    // Both arms normalize through `toDlqWireEntry` so the response has
    // one shape regardless of which source answered. `source` still says
    // which one did, so an operator can see the data is degraded — the
    // in-memory mirror is this process's only, and holds nothing from
    // before it started or from any sibling replica.
    try {
      const entries = await dlqStore.list({
        eventName: eventNameResult.value,
        limit: limitResult.value,
      });
      const messages = entries.map(toDlqWireEntry);
      res.json({ messages, total: messages.length, source: 'store' });
    } catch (err) {
      // The mirror is an unfiltered array, so `?eventName=`/`?limit=`
      // have to be applied here — otherwise the same query silently
      // widens to "everything this process has" the moment DynamoDB
      // goes down, on top of changing shape.
      const messages = filterWireEntries(
        durable.getDLQ().map(toDlqWireEntry),
        eventNameResult.value,
        limitResult.value ?? DEFAULT_DLQ_LIMIT,
      );
      res.json({
        messages,
        total: messages.length,
        source: 'in-memory',
        error: redact(log, 'DLQ list fell back to the in-memory mirror', err, DLQ_LIST_DEGRADED_MESSAGE),
      });
    }
  }

  // The remaining handlers return no DLQ entry at all — only ids,
  // counts and per-id outcomes — so `list` was the only dual-shape
  // surface. They also have no in-memory fallback: while the durable
  // store is down they throw, and the router turns that into a redacted
  // 500. That asymmetry is deliberate — an id from the degraded list is
  // not replayable — and is called out in the list route's OpenAPI
  // description so an operator isn't surprised by it.

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
    // Each id is a DynamoDB read plus a message-queue POST, run
    // sequentially inside this request.
    if (!withinArrayLimit(res, ids, MAX_DLQ_REPLAY_IDS, 'ids')) return;

    const replayed: Array<{ id: string; eventName: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids as string[]) {
      // findById belongs INSIDE the try: it is a DynamoDB read, and a single
      // throttled lookup used to abort the whole batch with a bare 500 —
      // losing the per-id breakdown for every other id in the request, and
      // giving the caller no way to know which ones actually replayed.
      let entry: Awaited<ReturnType<typeof dlqStore.findById>>;
      try {
        entry = await dlqStore.findById(id);
      } catch (err) {
        failed.push({
          id,
          error: redact(log, `DLQ replay lookup failed for "${id}"`, err, DLQ_REPLAY_FAILED_MESSAGE),
        });
        continue;
      }
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
        failed.push({
          id,
          error: redact(log, `DLQ batch replay failed for "${id}"`, err, DLQ_REPLAY_FAILED_MESSAGE),
        });
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
      res.status(500).json({
        error: redact(log, `DLQ replay failed for "${entry.id}"`, err, DLQ_REPLAY_FAILED_MESSAGE),
      });
    }
  }

  return { list, remove, replayBatch, clear, replay };
}
