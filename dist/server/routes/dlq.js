"use strict";
// src/server/routes/dlq.ts
//
// Durable-transport dead-letter queue: listing, single-entry delete,
// single + batch redrive, and bulk clear.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDlqHandlers = createDlqHandlers;
const durable_js_1 = require("../../client/durable.js");
const _shared_js_1 = require("./_shared.js");
const limits_js_1 = require("./limits.js");
const MAX_DLQ_LIMIT = 1000;
// Express delivers duplicate `?eventName=A&eventName=B` as an array, which
// silently coerces to `'A,B'` when passed to the DDB Query — wrong partition,
// 0 entries, looks like a clean DLQ. Reject the array form loudly so
// operators don't act on phantom-empty state. Same silent-drift hazard
// class as the dlq-store pagination fixes (hub #806/#842/#858/#883).
function parseDlqEventName(raw) {
    if (raw === undefined)
        return { ok: true, value: undefined };
    if (typeof raw !== 'string') {
        return { ok: false, error: 'eventName must be a single string' };
    }
    const trimmed = raw.trim();
    return { ok: true, value: trimmed === '' ? undefined : trimmed };
}
function parseDlqLimit(raw) {
    if (raw === undefined)
        return { ok: true, value: undefined };
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
function createDlqHandlers(deps) {
    const { durable, dlqStore } = deps;
    // Durable transport dead-letter queue (persisted)
    async function list(req, res) {
        const eventNameResult = parseDlqEventName(req.query.eventName);
        if (!eventNameResult.ok) {
            (0, _shared_js_1.badRequest)(res, eventNameResult.error);
            return;
        }
        const limitResult = parseDlqLimit(req.query.limit);
        if (!limitResult.ok) {
            (0, _shared_js_1.badRequest)(res, limitResult.error);
            return;
        }
        try {
            const entries = await dlqStore.list({
                eventName: eventNameResult.value,
                limit: limitResult.value,
            });
            res.json({ messages: entries, total: entries.length });
        }
        catch (err) {
            const inMemory = durable.getDLQ();
            res.json({ messages: inMemory, total: inMemory.length, source: 'in-memory', error: err.message });
        }
    }
    // Delete a single DLQ entry
    async function remove(req, res) {
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
    async function replayBatch(req, res) {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string')) {
            (0, _shared_js_1.badRequest)(res, 'ids must be a non-empty array of strings');
            return;
        }
        // Each id is a DynamoDB read plus a message-queue POST, run
        // sequentially inside this request.
        if (!(0, limits_js_1.withinArrayLimit)(res, ids, limits_js_1.MAX_DLQ_REPLAY_IDS, 'ids'))
            return;
        const replayed = [];
        const failed = [];
        for (const id of ids) {
            const entry = await dlqStore.findById(id);
            if (!entry) {
                failed.push({ id, error: 'not found' });
                continue;
            }
            const queueName = durable_js_1.DurableTransport.eventNameToQueueName(entry.eventName);
            try {
                await durable.publish(queueName, {
                    eventName: entry.eventName,
                    payload: entry.payload,
                    metadata: { id: entry.id, producer: 'dlq-replay', timestamp: Date.now() },
                });
                await dlqStore.remove(entry.id);
                replayed.push({ id: entry.id, eventName: entry.eventName });
            }
            catch (err) {
                failed.push({ id, error: err.message });
            }
        }
        res.json({ replayed, failed, total: ids.length });
    }
    // Bulk-clear DLQ entries. Optional ?eventName= scopes to one event.
    // Returns { cleared: N } so callers know how many entries were removed.
    async function clear(req, res) {
        const eventNameResult = parseDlqEventName(req.query.eventName);
        if (!eventNameResult.ok) {
            (0, _shared_js_1.badRequest)(res, eventNameResult.error);
            return;
        }
        const cleared = await dlqStore.clear(eventNameResult.value);
        res.json({ cleared });
    }
    // Replay a DLQ entry: re-publish to durable transport, then delete
    async function replay(req, res) {
        const entry = await dlqStore.findById(req.params.id);
        if (!entry) {
            res.status(404).json({ error: `DLQ entry "${req.params.id}" not found` });
            return;
        }
        const queueName = durable_js_1.DurableTransport.eventNameToQueueName(entry.eventName);
        try {
            await durable.publish(queueName, {
                eventName: entry.eventName,
                payload: entry.payload,
                metadata: { id: entry.id, producer: 'dlq-replay', timestamp: Date.now() },
            });
            await dlqStore.remove(entry.id);
            res.json({ replayed: entry.id, eventName: entry.eventName });
        }
        catch (err) {
            res.status(500).json({ error: `Replay failed: ${err.message}` });
        }
    }
    return { list, remove, replayBatch, clear, replay };
}
//# sourceMappingURL=dlq.js.map