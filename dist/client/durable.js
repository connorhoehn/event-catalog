"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DurableTransport = void 0;
const transport_1 = require("distributed-core/transport");
const bounded_1 = require("../utils/bounded");
const logger_1 = require("../utils/logger");
/** Max wait enforced on a server-driven Retry-After (5 minutes). */
const BACKPRESSURE_MAX_WAIT_MS = 300_000;
/** Cap on per-queue bookkeeping (metrics, ensure-cache, backpressure). */
const MAX_TRACKED_QUEUES = 1000;
/**
 * Cap on per-message delivery-attempt counters. Keyed by a message id the
 * *queue* chooses, and only cleared on success or dead-letter — a message
 * that fails once and is never redelivered (queue purged, retention
 * expiry, visibility change) otherwise leaves its counter behind forever.
 */
const MAX_TRACKED_MESSAGE_ATTEMPTS = 10_000;
/**
 * Parse an RFC 7231 Retry-After header value.
 * Returns milliseconds to wait, or `undefined` if unparseable.
 *
 *   - Integer seconds: "30" → 30_000
 *   - HTTP-date: "Wed, 21 Oct 2015 07:28:00 GMT" → delta from Date.now()
 */
function parseRetryAfterMs(header) {
    if (!header)
        return undefined;
    const trimmed = header.trim();
    // Integer seconds?
    const asInt = parseInt(trimmed, 10);
    if (!isNaN(asInt) && String(asInt) === trimmed) {
        return asInt * 1000;
    }
    // HTTP-date?
    const ts = Date.parse(trimmed);
    if (!isNaN(ts)) {
        const delta = ts - Date.now();
        return delta > 0 ? delta : 0;
    }
    return undefined;
}
/**
 * Process-wide counter for backpressure observations, shared by every
 * `DurableTransport` in the process. Bounded per-queue with an exact
 * lifetime total, because it is never cleared outside tests.
 */
const backpressureCounter = new bounded_1.BoundedCounter(MAX_TRACKED_QUEUES);
/**
 * HTTP transport to the `message-queue` service for `transport: 'durable'`
 * events.
 *
 * Failure semantics (the mirror image of {@link SignalTransport}):
 *   - **`publish()` throws on every failure** — not connected, network
 *     error, non-2xx, or sustained 429 backpressure — after exhausting
 *     `retryAttempts`. Nothing is silently dropped on the publish path.
 *   - **`connect()` never throws.** An unreachable message-queue is warned
 *     and the transport still reports connected; the failure resurfaces on
 *     the first publish. This is deliberate: a service should boot with a
 *     degraded durable bus rather than crash-loop.
 *   - **`ensureQueue()` never throws.** Queue-config drift (HTTP 409) is
 *     warned and accepted; a failed ensure still lets the publish proceed.
 *   - **`subscribe()` never throws.** Poll failures are retried with
 *     back-off forever; a handler that fails `maxProcessingAttempts` times
 *     records a diagnostic in {@link getDLQ}. Only the broker's redrive policy
 *     may move a failed message; the subscriber never deletes it for a failure.
 */
class DurableTransport {
    requestHeaders;
    url;
    /** message-queue's canonical versioned queue surface (Roadmap 4.1). */
    queuesBase;
    retryAttempts;
    retryBaseMs;
    /** Per-attempt ceiling on a publish POST. See the constructor note. */
    publishTimeoutMs;
    acknowledgementTimeoutMs;
    maxProcessingAttempts;
    dlqCapacity;
    pollRetryManager;
    connected = false;
    /**
     * Keyed by a monotonic id, not by queue name: two `subscribe()` calls on
     * the same queue used to overwrite each other's AbortController, which
     * orphaned the first poll loop for the life of the process and made
     * `disconnect()` unable to stop it.
     */
    activePollers = new Map();
    nextPollerId = 1;
    queueMetrics = new Map();
    evictedQueueMetrics = 0;
    ensuredQueues = new Set();
    deadLetterMessages = [];
    messageAttempts = new Map();
    evictedMessageAttempts = 0;
    deadLetterCallbacks = [];
    /** Publishes currently awaiting message-queue. See {@link getInFlightPublishCount}. */
    inFlightPublishes = 0;
    peakInFlightPublishes = 0;
    /**
     * Every log line below runs per-publish or per-message, which is exactly
     * the rate at which a dependency outage executes. Counted always,
     * logged at a bounded rate.
     */
    backpressureWarnings;
    ensureQueueWarnings;
    pollWarnings;
    handlerWarnings;
    deadLetterWarnings;
    handlerFailures = 0;
    ensureQueueFailures = 0;
    /** Times a polled queue answered 404 and was re-created in place. */
    queueVanishedCount = 0;
    pollFailures = 0;
    deadLetteredTotal = 0;
    log;
    constructor(config) {
        this.requestHeaders = config.requestHeaders;
        this.url = config.url.replace(/\/$/, '');
        this.log = new logger_1.LogWriter(config.logger);
        this.queuesBase = `${this.url}/api/v1/queues`;
        this.retryAttempts = config.retryAttempts ?? 3;
        this.retryBaseMs = config.retryBaseMs ?? 100;
        // Without this, a message-queue that accepts the socket and never
        // answers leaves the publish promise pending forever — the caller
        // never resolves, never rejects, and nothing is metered. healthCheck
        // already bounded itself; publish did not.
        this.publishTimeoutMs = config.publishTimeoutMs ?? 10_000;
        this.acknowledgementTimeoutMs = config.acknowledgementTimeoutMs ?? 10_000;
        this.maxProcessingAttempts = config.maxProcessingAttempts ?? 3;
        this.dlqCapacity = config.dlqCapacity ?? 10_000;
        // keyIntervalMs: a queue that is still failing an hour later deserves a
        // fresh line; what it must not do is emit one per publish.
        this.backpressureWarnings = new bounded_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
        this.ensureQueueWarnings = new bounded_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
        this.pollWarnings = new bounded_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
        this.handlerWarnings = new bounded_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
        this.deadLetterWarnings = new bounded_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
        this.pollRetryManager = new transport_1.RetryManager({
            maxRetries: 2, // 3 total attempts (1 initial + 2 retries)
            baseDelay: 1000,
            backoffFactor: 2,
            jitter: false,
            enableLogging: false,
            name: 'durable-poll',
        });
    }
    /**
     * Probe `GET {url}/health` and mark the transport connected.
     *
     * Never throws, and marks itself connected **even when the probe fails**
     * — the warning names the URL so an operator can check
     * `MESSAGE_QUEUE_URL`, and publishes will surface the real error with
     * their own retries. Idempotent.
     */
    async connect() {
        if (this.connected)
            return;
        // Verify message-queue is reachable
        try {
            const res = await this.request(`${this.url}/health`);
            if (!res.ok)
                throw new Error(`status ${res.status}`);
        }
        catch (err) {
            this.log.warn(`[durable-transport] message-queue not reachable at ${this.url}/health `
                + `(check MESSAGE_QUEUE_URL): ${err.message}. Continuing in degraded mode — `
                + `durable publishes will retry and then throw until it recovers.`, { url: `${this.url}/health`, error: (0, logger_1.errorMessage)(err) });
        }
        this.connected = true;
    }
    /**
     * Abort every active poll loop and mark the transport disconnected.
     * Never throws. In-memory DLQ contents survive; in-flight messages are
     * left for the queue's visibility timeout to redeliver.
     */
    async disconnect() {
        for (const [, controller] of this.activePollers) {
            controller.abort();
        }
        this.activePollers.clear();
        this.connected = false;
    }
    /** Poll loops still running. Should be 0 after `disconnect()`. */
    getActivePollerCount() {
        return this.activePollers.size;
    }
    /**
     * Publishes currently awaiting message-queue, and the high-water mark.
     *
     * **This transport applies no backpressure of its own.** `publish()` has
     * no internal queue and no concurrency limit: every concurrent caller
     * holds its own fetch, and on 429/5xx its own retry sleep — which a
     * server `Retry-After` can stretch to 5 minutes per attempt. A producer
     * that publishes faster than message-queue drains therefore accumulates
     * in-flight promises without limit, bounded only by the caller's own
     * concurrency. Watch this gauge and rate-limit upstream.
     */
    getInFlightPublishCount() {
        return { current: this.inFlightPublishes, peak: this.peakInFlightPublishes };
    }
    /**
     * Aggregates that survive per-key eviction and log suppression.
     *
     * `getMetrics()` and `getBackpressureCount()` hold at most
     * {@link MAX_TRACKED_QUEUES} entries each; these totals do not evict, so
     * they remain the truthful answer to "did anything fail?".
     */
    getOverflowStats() {
        return {
            trackedQueues: this.queueMetrics.size,
            evictedQueueMetrics: this.evictedQueueMetrics,
            trackedMessageAttempts: this.messageAttempts.size,
            evictedMessageAttempts: this.evictedMessageAttempts,
            handlerFailures: this.handlerFailures,
            ensureQueueFailures: this.ensureQueueFailures,
            pollFailures: this.pollFailures,
            queueVanished: this.queueVanishedCount,
            deadLetteredTotal: this.deadLetteredTotal,
            suppressedWarnings: this.backpressureWarnings.suppressedTotal
                + this.ensureQueueWarnings.suppressedTotal
                + this.pollWarnings.suppressedTotal
                + this.handlerWarnings.suppressedTotal
                + this.deadLetterWarnings.suppressedTotal,
        };
    }
    /**
     * Idempotent queue ensure via PUT (message-queue Phase 4.1 contract).
     * Maps event-catalog's declared queue config (retention/fifo/dlqAfterAttempts)
     * onto message-queue's QueueConfiguration shape. Three response codes
     * are handled distinctly:
     *
     *   201 — created with the requested config.
     *   200 — already existed with matching config (no change).
     *   409 — already existed with DIFFERING config; conflict body logged
     *         at warn level. The publish path still proceeds — operator
     *         must decide whether to delete-and-recreate or accept the
     *         drift. We do NOT auto-mutate the existing queue.
     *
     * When `dlqAfterAttempts` is declared, the paired DLQ queue is
     * auto-created first under the name `${queueName}-dlq` (conventional;
     * mirrors AWS SQS-redrive naming). If the DLQ ensure fails the main
     * queue is still attempted without redrive_policy — better to land
     * messages on the live queue than to refuse delivery.
     */
    async ensureQueue(queueName, options) {
        if (this.ensuredQueues.has(queueName))
            return;
        // Step 1 — if dlqAfterAttempts is declared, ensure the paired DLQ
        // exists first. Auto-name is "{queueName}-dlq" unless the caller
        // overrides via options.dlqQueueName.
        let dlqArn;
        if (options?.dlqAfterAttempts && options.dlqAfterAttempts > 0) {
            const dlqName = options.dlqQueueName ?? `${queueName}-dlq`;
            const dlqOk = await this.putQueue(dlqName, {});
            if (dlqOk) {
                dlqArn = `arn:message-queue:queue:${dlqName}`;
            }
            else {
                this.warnEnsureQueue(`dlq:${dlqName}`, `[durable-transport] DLQ ensure for "${dlqName}" failed; main queue "${queueName}" will be created WITHOUT redrive_policy`, { queue: queueName, dlqQueue: dlqName });
            }
        }
        // Step 2 — build the QueueConfiguration body from declared options.
        const configuration = this.buildQueueConfig(options, dlqArn);
        const ok = await this.putQueue(queueName, configuration);
        // Bounded: a caller publishing to an unbounded queue-name space would
        // otherwise grow this Set forever. Eviction only costs a redundant
        // (idempotent) PUT the next time that queue is published to.
        if (ok)
            this.rememberEnsuredQueue(queueName);
    }
    rememberEnsuredQueue(queueName) {
        if (this.ensuredQueues.has(queueName))
            return;
        if (this.ensuredQueues.size >= MAX_TRACKED_QUEUES) {
            const oldest = this.ensuredQueues.values().next();
            if (!oldest.done)
                this.ensuredQueues.delete(oldest.value);
        }
        this.ensuredQueues.add(queueName);
    }
    /**
     * `ensureQueue` runs on every publish until it succeeds, so a
     * message-queue outage puts these warnings on the per-publish path.
     * Count every failure; log a bounded sample.
     */
    warnEnsureQueue(key, message, fields, ...rest) {
        this.ensureQueueFailures++;
        const suppressed = this.ensureQueueWarnings.attempt(key);
        if (suppressed === null)
            return;
        this.log.warn(message + bounded_1.LogThrottle.suffix(suppressed), { ...fields, ensureQueueFailures: this.ensureQueueFailures, suppressed }, ...rest);
    }
    /**
     * Map an event-catalog declaration's queue-config fields to
     * message-queue's snake_case QueueConfiguration shape.
     */
    buildQueueConfig(options, dlqArn) {
        const config = {};
        if (options?.retention !== undefined) {
            config.message_retention_period_seconds = options.retention;
        }
        if (options?.fifo !== undefined) {
            config.fifo_queue = options.fifo;
        }
        if (dlqArn && options?.dlqAfterAttempts) {
            config.redrive_policy = {
                dead_letter_target_arn: dlqArn,
                max_receive_count: options.dlqAfterAttempts,
            };
        }
        return config;
    }
    /**
     * Single PUT to /api/v1/queues/{name}. Returns true on 200/201, false on 409
     * (logs the conflict diff) or any other status / network error.
     */
    async putQueue(queueName, configuration) {
        try {
            const res = await this.request(`${this.queuesBase}/${encodeURIComponent(queueName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configuration }),
            });
            if (res.status === 200 || res.status === 201) {
                return true;
            }
            if (res.status === 409) {
                const body = await res.json().catch(() => ({}));
                // 409 still counts as ensured, so this fires once per queue — but
                // route it through the throttle anyway in case the queue-name space
                // is caller-controlled.
                const suppressed = this.ensureQueueWarnings.attempt(`conflict:${queueName}`);
                if (suppressed !== null) {
                    const conflicts = JSON.stringify(body.conflicts ?? body);
                    this.log.warn(`[durable-transport] queue "${queueName}" exists with differing config — accepting drift:`
                        + bounded_1.LogThrottle.suffix(suppressed), { queue: queueName, status: res.status, conflicts, suppressed }, conflicts);
                }
                // Drift is not a fatal error; the queue exists and we can publish.
                return true;
            }
            const text = await res.text().catch(() => 'unknown');
            this.warnEnsureQueue(`status:${queueName}`, `[durable-transport] ensureQueue "${queueName}" failed: ${res.status} ${text}`, { queue: queueName, status: res.status, body: text });
            return false;
        }
        catch (err) {
            this.warnEnsureQueue(`error:${queueName}`, `[durable-transport] ensureQueue "${queueName}" error:`, { queue: queueName, error: (0, logger_1.errorMessage)(err) }, err.message);
            return false;
        }
    }
    /**
     * Increment and return the module-level backpressure counter for a queue.
     * Exposed via `DurableTransport.getBackpressureCount()` for tests/metrics.
     */
    recordBackpressure(queueName) {
        return backpressureCounter.increment(queueName);
    }
    /**
     * Return total backpressure events observed for a queue (or all queues).
     *
     * The no-argument map holds at most {@link MAX_TRACKED_QUEUES} queues;
     * `getBackpressureTotal()` is the number that never loses an observation.
     */
    static getBackpressureCount(queueName) {
        if (queueName !== undefined) {
            return backpressureCounter.get(queueName);
        }
        return backpressureCounter.snapshot();
    }
    /** Lifetime backpressure observations, unaffected by per-queue eviction. */
    static getBackpressureTotal() {
        return backpressureCounter.total;
    }
    /** Reset backpressure counters (useful in tests). */
    static resetBackpressureCounters() {
        backpressureCounter.reset();
    }
    /**
     * POST an envelope to a message-queue queue, ensuring the queue exists
     * first. Retries up to `retryAttempts` times with exponential back-off,
     * honouring a server `Retry-After` on HTTP 429 (clamped to 5 minutes and
     * jittered).
     *
     * Nothing is dropped: if this resolves, message-queue accepted the
     * message; if it rejects, it did not.
     *
     * @throws when the transport is not connected, or after the final
     *   attempt fails — the message contains the queue name, the attempt
     *   count, and the underlying status or network error.
     */
    async publish(queueName, envelope, queueOptions) {
        if (!this.connected) {
            throw new Error(`[durable-transport] not connected — cannot publish to queue "${queueName}". `
                + 'Call connect() (or EventCatalog.connect()) and await it before publishing.');
        }
        this.inFlightPublishes++;
        if (this.inFlightPublishes > this.peakInFlightPublishes) {
            this.peakInFlightPublishes = this.inFlightPublishes;
        }
        try {
            await this.publishInner(queueName, envelope, queueOptions);
        }
        finally {
            this.inFlightPublishes--;
        }
    }
    async publishInner(queueName, envelope, queueOptions) {
        await this.ensureQueue(queueName, queueOptions);
        const body = JSON.stringify({
            message_body: JSON.stringify(envelope),
        });
        const maxAttempts = this.retryAttempts;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let res;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.publishTimeoutMs);
            try {
                res = await this.request(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: controller.signal,
                });
            }
            catch (err) {
                // An abort lands here too, and is treated as a network error: a hung
                // queue is retried with back-off like any other transport failure.
                // Network error — hand off to retry logic
                if (attempt >= maxAttempts) {
                    this.incrementMetric(queueName, 'failed');
                    throw new Error(`[durable-transport] publish to "${queueName}" failed after ${maxAttempts} attempts: ${err.message}`);
                }
                // Exponential back-off for network errors (mirrors RetryManager defaults)
                const backoff = Math.min(this.retryBaseMs * Math.pow(2, attempt - 1), 30_000);
                await this.sleepMs(backoff);
                continue;
            }
            finally {
                clearTimeout(timeout);
            }
            if (res.status === 429) {
                // Server-driven backpressure — honour Retry-After
                const count = this.recordBackpressure(queueName);
                let waitMs = parseRetryAfterMs(res.headers.get('Retry-After'));
                const retryManagerDefault = Math.min(this.retryBaseMs * Math.pow(2, attempt - 1), 30_000);
                if (waitMs === undefined) {
                    waitMs = retryManagerDefault;
                }
                if (waitMs > BACKPRESSURE_MAX_WAIT_MS) {
                    const clampSuppressed = this.backpressureWarnings.attempt(`clamp:${queueName}`);
                    if (clampSuppressed !== null) {
                        this.log.warn(`[durable-transport] backpressure on "${queueName}": Retry-After ${waitMs}ms exceeds cap ${BACKPRESSURE_MAX_WAIT_MS}ms; clamping`
                            + bounded_1.LogThrottle.suffix(clampSuppressed), {
                            queue: queueName,
                            retryAfterMs: waitMs,
                            capMs: BACKPRESSURE_MAX_WAIT_MS,
                            attempt,
                            suppressed: clampSuppressed,
                        });
                    }
                    waitMs = BACKPRESSURE_MAX_WAIT_MS;
                }
                // Apply jitter: multiply by random in [0.5, 1.0)
                const jittered = Math.round(waitMs * (0.5 + Math.random() * 0.5));
                // Sustained backpressure means this line runs on every attempt of
                // every publish — the full request rate of the service. The count
                // in the message is the un-suppressed truth; the line itself is a
                // once-a-minute-per-queue sample.
                const suppressed = this.backpressureWarnings.attempt(queueName);
                if (suppressed !== null) {
                    this.log.warn(`[durable-transport] mq_backpressure_observed_total{queue="${queueName}"} ${count} — ` +
                        `retry-after ${Math.round(waitMs / 1000)}s jittered=${jittered}ms attempt=${attempt}/${maxAttempts}`
                        + bounded_1.LogThrottle.suffix(suppressed), {
                        queue: queueName,
                        backpressureCount: count,
                        status: res.status,
                        retryAfterMs: waitMs,
                        jitteredMs: jittered,
                        attempt,
                        maxAttempts,
                        suppressed,
                    });
                }
                if (attempt >= maxAttempts) {
                    this.incrementMetric(queueName, 'failed');
                    throw new Error(`[durable-transport] publish to "${queueName}" failed after ${maxAttempts} attempts: message-queue returned 429`);
                }
                await this.sleepMs(jittered);
                continue;
            }
            if (!res.ok) {
                // Other 4xx/5xx — use standard retry with exponential back-off
                if (attempt >= maxAttempts) {
                    this.incrementMetric(queueName, 'failed');
                    throw new Error(`[durable-transport] publish to "${queueName}" failed after ${maxAttempts} attempts: message-queue returned ${res.status}`);
                }
                const backoff = Math.min(this.retryBaseMs * Math.pow(2, attempt - 1), 30_000);
                await this.sleepMs(backoff);
                continue;
            }
            // Success
            this.incrementMetric(queueName, 'sent');
            return;
        }
        // Should be unreachable, but satisfy TS
        this.incrementMetric(queueName, 'failed');
        throw new Error(`[durable-transport] publish to "${queueName}" failed after ${maxAttempts} attempts`);
    }
    /**
     * Start a long-poll loop against a queue. Synchronous and non-throwing:
     * the queue ensure and the loop itself start in the background, so a
     * message-queue outage at subscribe time is not an error here.
     *
     * A handler rejection causes redelivery. After `maxProcessingAttempts`
     * rejections for the same message a diagnostic is recorded (see
     * {@link getDLQ} / {@link onDeadLetter}). The source is retained for the
     * broker's redrive policy or redelivery. Diagnostic attempt counts are
     * process-local, so a restart resets them.
     *
     * @returns a cancel function that aborts the poll loop. It does not wait
     *   for an in-flight handler to finish.
     */
    subscribe(queueName, handler, options = {}) {
        const { pollingInterval = 1000, batchSize = 10, visibilityTimeout = 30, } = options;
        const controller = new AbortController();
        const pollerId = this.nextPollerId++;
        this.activePollers.set(pollerId, controller);
        // `.catch` matters: ensureQueue never rejects today, but an unhandled
        // rejection here would take the process down instead of leaving the
        // poller unstarted.
        void this.ensureQueue(queueName).then(() => {
            if (controller.signal.aborted)
                return;
            void this.pollLoop(queueName, handler, {
                pollingInterval,
                batchSize,
                visibilityTimeout,
                signal: controller.signal,
            });
        }).catch(() => { });
        return () => {
            controller.abort();
            this.activePollers.delete(pollerId);
        };
    }
    /**
     * Fetch a queue's attributes from message-queue. Never throws — returns
     * `null` on any non-2xx or network error, so `null` does not distinguish
     * "no such queue" from "message-queue is down".
     */
    async getQueueAttributes(queueName) {
        try {
            const res = await this.request(`${this.queuesBase}/${encodeURIComponent(queueName)}/attributes`);
            if (!res.ok)
                return null;
            return await res.json();
        }
        catch {
            return null;
        }
    }
    /**
     * Per-queue sent/received/failed/in-flight counters. Process-local and
     * reset on restart; not a substitute for message-queue's own metrics.
     */
    getMetrics(queueName) {
        if (queueName)
            return this.queueMetrics.get(queueName);
        return new Map(this.queueMetrics);
    }
    /** Same as `getMetrics()` with no argument, but narrowly typed to the map. */
    getAllMetrics() {
        return new Map(this.queueMetrics);
    }
    /**
     * Snapshot of the in-memory dead-letter buffer (a copy — mutating it
     * does not affect the transport).
     *
     * This buffer is **not durable**: it is capped at `dlqCapacity`, evicts
     * oldest-first when full, and is lost on restart. Source messages are never
     * acknowledged on its strength. Configure broker redrive for durable DLQ
     * movement; onDeadLetter callbacks only observe failures.
     */
    getDLQ() {
        return [...this.deadLetterMessages];
    }
    /** Return and clear the in-memory dead-letter buffer. */
    drainDLQ() {
        const messages = [...this.deadLetterMessages];
        this.deadLetterMessages.length = 0;
        return messages;
    }
    /**
     * Register a callback fired synchronously whenever a message is
     * recorded as poison. Callback exceptions are swallowed; callbacks do not
     * authorize source deletion. Returns an
     * unregister function.
     */
    onDeadLetter(callback) {
        this.deadLetterCallbacks.push(callback);
        return () => {
            this.deadLetterCallbacks = this.deadLetterCallbacks.filter(cb => cb !== callback);
        };
    }
    /**
     * True once `connect()` has run. Says nothing about whether
     * message-queue is actually reachable — use {@link healthCheck} for that.
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Probe `GET {url}/health` with a 2s timeout. Never throws.
     * `'degraded'` = timed out or non-2xx; `'disconnected'` = not connected
     * or the request errored.
     */
    async healthCheck() {
        if (!this.connected) {
            return { status: 'disconnected', latencyMs: 0 };
        }
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const res = await this.request(`${this.url}/health`, { signal: controller.signal });
            clearTimeout(timeout);
            const latencyMs = Math.round(performance.now() - start);
            if (res.ok) {
                return { status: 'connected', latencyMs };
            }
            return { status: 'degraded', latencyMs };
        }
        catch (err) {
            const latencyMs = Math.round(performance.now() - start);
            if (err.name === 'AbortError') {
                return { status: 'degraded', latencyMs };
            }
            return { status: 'disconnected', latencyMs };
        }
    }
    async pollLoop(queueName, handler, opts) {
        const { pollingInterval, batchSize, visibilityTimeout, signal } = opts;
        while (!signal.aborted) {
            try {
                // Wrap the poll fetch in RetryManager for backoff on transient failures
                let data;
                try {
                    data = await this.pollRetryManager.execute(async () => {
                        const res = await this.request(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages?` +
                            `max_messages=${batchSize}&visibility_timeout=${visibilityTimeout}`, { signal });
                        if (!res.ok) {
                            const err = new Error(`message-queue returned ${res.status}`);
                            err.status = res.status;
                            throw err;
                        }
                        return await res.json();
                    });
                }
                catch (pollErr) {
                    if (signal.aborted)
                        return;
                    // 404 means the queue itself is gone — message-queue restarted on
                    // its in-memory store, or an operator deleted the queue. The
                    // subscribe-time ensureQueue() is a one-shot, so without this the
                    // poller would 404 every interval for the rest of the process.
                    // Forget the cached ensure and re-create the queue in place; the
                    // next iteration polls normally.
                    if (pollErr.status === 404) {
                        this.ensuredQueues.delete(queueName);
                        this.queueVanishedCount++;
                        this.log.warn(`[durable-transport] queue "${queueName}" no longer exists (404); re-creating it`, { queue: queueName, queueVanished: this.queueVanishedCount });
                        await this.ensureQueue(queueName);
                        await this.sleep(pollingInterval, signal);
                        continue;
                    }
                    // A down message-queue fails this every `pollingInterval` (1s by
                    // default) for as long as the outage lasts — ~86k lines a day
                    // per queue if left unthrottled.
                    this.pollFailures++;
                    const suppressed = this.pollWarnings.attempt(`poll:${queueName}`);
                    if (suppressed !== null) {
                        this.log.error(`[durable-transport] poll failed for "${queueName}" after retries `
                            + `(${this.pollFailures} failures this process)`
                            + bounded_1.LogThrottle.suffix(suppressed) + ':', {
                            queue: queueName,
                            error: (0, logger_1.errorMessage)(pollErr),
                            pollFailures: this.pollFailures,
                            suppressed,
                        }, pollErr.message);
                    }
                    await this.sleep(pollingInterval, signal);
                    continue;
                }
                const messages = data.messages ?? [];
                for (const msg of messages) {
                    this.incrementMetric(queueName, 'inFlight');
                    let processed = false;
                    try {
                        const envelope = JSON.parse(msg.body);
                        await handler(envelope);
                        processed = true;
                        this.messageAttempts.delete(msg.message_id);
                        // A completed handler is not a committed acknowledgement. Failed
                        // deletion leaves the queue responsible for redelivery.
                        await this.acknowledge(queueName, msg.receipt_handle, signal);
                        this.incrementMetric(queueName, 'received');
                        this.decrementInFlight(queueName);
                        // Clear attempt counter on success
                        this.messageAttempts.delete(msg.message_id);
                    }
                    catch (err) {
                        if (processed) {
                            const suppressed = this.pollWarnings.attempt(`ack:${queueName}`);
                            if (suppressed !== null) {
                                this.log.warn(`[durable-transport] acknowledgement failed for "${queueName}"; message may be redelivered`, {
                                    queue: queueName, messageId: msg.message_id, error: (0, logger_1.errorMessage)(err), suppressed,
                                });
                            }
                            this.decrementInFlight(queueName);
                            this.incrementMetric(queueName, 'failed');
                            continue; // Never charge storage/network failure to the handler's poison budget.
                        }
                        this.handlerFailures++;
                        const attemptCount = (this.messageAttempts.get(msg.message_id) ?? 0) + 1;
                        // Bounded: message ids are chosen by the queue, and an entry is
                        // only removed on success or dead-letter. A message that fails
                        // once and is never redelivered would otherwise leak its counter.
                        // Eviction only means the message gets a fresh attempt budget.
                        if ((0, bounded_1.rememberBounded)(this.messageAttempts, msg.message_id, attemptCount, MAX_TRACKED_MESSAGE_ATTEMPTS) !== undefined) {
                            this.evictedMessageAttempts++;
                        }
                        if (attemptCount >= this.maxProcessingAttempts) {
                            // Dead-letter this message
                            let envelope;
                            try {
                                envelope = JSON.parse(msg.body);
                            }
                            catch { /* use undefined */ }
                            if (this.deadLetterMessages.length >= this.dlqCapacity) {
                                this.deadLetterMessages.splice(0, this.deadLetterMessages.length - this.dlqCapacity + 1);
                            }
                            const dlqMessage = {
                                messageId: msg.message_id,
                                queueName,
                                envelope: envelope ?? { eventName: 'unknown', payload: msg.body, metadata: { id: msg.message_id, producer: 'unknown', timestamp: Date.now() } },
                                error: err.message,
                                attempts: attemptCount,
                                deadLetteredAt: new Date().toISOString(),
                            };
                            this.deadLetterMessages.push(dlqMessage);
                            for (const cb of this.deadLetterCallbacks) {
                                try {
                                    cb(dlqMessage);
                                }
                                catch { /* ignore callback errors */ }
                            }
                            // A capped diagnostic buffer is not durable storage. Retain the
                            // source even if callbacks succeed: only broker redrive can move
                            // it without a copy/delete crash gap. Without redrive, it retries.
                            this.deadLetteredTotal++;
                            // Keyed by queue, not message id: a poison batch dead-letters
                            // at the drain rate, and the useful signal is "this queue is
                            // dead-lettering", not each id.
                            const dlSuppressed = this.deadLetterWarnings.attempt(`dlq:${queueName}`);
                            if (dlSuppressed !== null) {
                                this.log.error(`[durable-transport] message ${msg.message_id} retained at source after ${attemptCount} failed attempts in "${queueName}" `
                                    + `(${this.deadLetteredTotal} poison observations this process)`
                                    + bounded_1.LogThrottle.suffix(dlSuppressed), {
                                    queue: queueName,
                                    messageId: msg.message_id,
                                    eventName: envelope?.eventName,
                                    attempt: attemptCount,
                                    error: (0, logger_1.errorMessage)(err),
                                    deadLetteredTotal: this.deadLetteredTotal,
                                    suppressed: dlSuppressed,
                                });
                            }
                        }
                        else {
                            const hSuppressed = this.handlerWarnings.attempt(`handler:${queueName}`);
                            if (hSuppressed !== null) {
                                this.log.warn(`[durable-transport] handler error for "${queueName}" (attempt ${attemptCount}/${this.maxProcessingAttempts}) `
                                    + `(${this.handlerFailures} handler failures this process)`
                                    + bounded_1.LogThrottle.suffix(hSuppressed) + ':', {
                                    queue: queueName,
                                    messageId: msg.message_id,
                                    attempt: attemptCount,
                                    maxAttempts: this.maxProcessingAttempts,
                                    error: (0, logger_1.errorMessage)(err),
                                    handlerFailures: this.handlerFailures,
                                    suppressed: hSuppressed,
                                }, err.message);
                            }
                        }
                        this.decrementInFlight(queueName);
                        this.incrementMetric(queueName, 'failed');
                    }
                }
                if (messages.length === 0) {
                    await this.sleep(pollingInterval, signal);
                }
            }
            catch (err) {
                if (signal.aborted)
                    return;
                this.pollFailures++;
                const suppressed = this.pollWarnings.attempt(`loop:${queueName}`);
                if (suppressed !== null) {
                    // `error`, matching the "poll failed after retries" site above.
                    // These are one failure class from an operator's point of view
                    // — the poll loop for this queue did not complete an iteration,
                    // so nothing is being consumed — and reporting it at two levels
                    // meant a filter on `error` caught an outage only when it
                    // happened to surface on the inner path.
                    //
                    // `error` is the right one of the two, not `warn`: the inner
                    // site fires only *after* `pollRetryManager` has exhausted its
                    // backoff, so transient blips are already absorbed and what is
                    // left is "durable delivery on this queue has stopped". The
                    // outer catch is the broader class (anything else thrown in the
                    // loop body, including message processing), which is if anything
                    // more serious. Neither loses a message — the loop sleeps and
                    // retries — but "we are consuming nothing until something
                    // changes" is what `error` is for.
                    this.log.error(`[durable-transport] poll error for "${queueName}"` + bounded_1.LogThrottle.suffix(suppressed) + ':', {
                        queue: queueName,
                        error: (0, logger_1.errorMessage)(err),
                        pollFailures: this.pollFailures,
                        suppressed,
                    }, err.message);
                }
                await this.sleep(pollingInterval, signal);
            }
        }
    }
    request(url, init = {}) {
        if (!this.requestHeaders)
            return Object.keys(init).length ? fetch(url, init) : fetch(url);
        if (init.body !== undefined && typeof init.body !== 'string') {
            throw new Error('Durable HTTP signing requires a UTF-8 string body');
        }
        const headers = new Headers(init.headers);
        for (const [name, value] of Object.entries(this.requestHeaders({ url,
            method: init.method ?? 'GET', body: init.body ?? '' })))
            headers.set(name, value);
        // A redirected request has a different signed target and may leak credentials.
        return fetch(url, { ...init, headers, redirect: 'error' });
    }
    async acknowledge(queueName, receipt, signal) {
        const response = await this.request(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(receipt)}`, { method: 'DELETE', signal: AbortSignal.any([signal, AbortSignal.timeout(this.acknowledgementTimeoutMs)]) });
        if (!response.ok)
            throw new Error(`message-queue acknowledgement returned ${response.status}`);
    }
    /** Unconditional sleep without an abort signal (used in publish retry loop). */
    sleepMs(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    sleep(ms, signal) {
        return new Promise(resolve => {
            if (signal.aborted) {
                resolve();
                return;
            }
            // The abort listener has `{once:true}` so IT cleans up if abort
            // fires — but in the steady-state poll loop, abort rarely fires
            // and each sleep iteration leaks a listener (2199+ observed in
            // gateway logs at ~1/sec poll cadence → MaxListenersExceeded).
            // Explicit cleanup on timer expiry closes the leak: when the
            // timer fires normally, remove the abort listener BEFORE resolve.
            const onAbort = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }
    incrementMetric(queueName, field) {
        let metrics = this.queueMetrics.get(queueName);
        if (!metrics) {
            metrics = { sent: 0, received: 0, failed: 0, inFlight: 0 };
            // Bounded, because `publish()` is public and its queue name is
            // derived from a caller-supplied event name.
            if ((0, bounded_1.rememberBounded)(this.queueMetrics, queueName, metrics, MAX_TRACKED_QUEUES) !== undefined) {
                this.evictedQueueMetrics++;
            }
        }
        metrics[field]++;
    }
    decrementInFlight(queueName) {
        const metrics = this.queueMetrics.get(queueName);
        if (metrics && metrics.inFlight > 0) {
            metrics.inFlight--;
        }
    }
    /**
     * Default event-name → queue-name derivation: `:` and `.` become `-`,
     * runs of `-` collapse. `pipeline:run:started` → `pipeline-run-started`.
     *
     * Note the mapping is lossy — `a:b` and `a.b` derive the same queue. Set
     * `queue` on the declaration when you need them kept apart.
     */
    static eventNameToQueueName(eventName) {
        return eventName.replace(/[:.]/g, '-').replace(/--+/g, '-');
    }
}
exports.DurableTransport = DurableTransport;
//# sourceMappingURL=durable.js.map