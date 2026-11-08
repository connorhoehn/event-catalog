"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DurableTransport = exports.DurableSubscriptionUnavailableError = void 0;
exports.parseSubscriptionHandle = parseSubscriptionHandle;
const distributed_core_1 = require("distributed-core");
const node_crypto_1 = require("node:crypto");
const client_1 = require("@connorhoehn/message-queue/client");
const durable_lease_1 = require("./durable-lease");
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
 * Process-wide counter for backpressure observations, shared by every
 * `DurableTransport` in the process. Bounded per-queue with an exact
 * lifetime total, because it is never cleared outside tests.
 */
const backpressureCounter = new bounded_1.BoundedCounter(MAX_TRACKED_QUEUES);
/** Raised when an explicit subscription handle is stale, removed or belongs to a replaced queue. */
class DurableSubscriptionUnavailableError extends Error {
    queue;
    subscription;
    code;
    cause;
    name = 'DurableSubscriptionUnavailableError';
    constructor(queue, subscription, code, cause) {
        super(`Subscription "${subscription.id}" (generation ${subscription.generation}) on queue "${queue}" is unavailable: ${code}`);
        this.queue = queue;
        this.subscription = subscription;
        this.code = code;
        this.cause = cause;
    }
}
exports.DurableSubscriptionUnavailableError = DurableSubscriptionUnavailableError;
const TERMINAL_SUBSCRIPTION_CODES = new Set([
    'StaleSubscription',
    'StaleQueue',
    'SubscriptionDoesNotExist',
    'QueueDoesNotExist',
]);
/** Validate and freeze a queue-owned subscription handle. */
function parseSubscriptionHandle(value) {
    const handle = value;
    if (!handle ||
        typeof handle !== 'object' ||
        typeof handle.id !== 'string' ||
        !handle.id ||
        typeof handle.generation !== 'string' ||
        !handle.generation)
        throw new TypeError('subscription must be a queue-owned handle with a non-empty id and generation');
    return Object.freeze({ id: handle.id, generation: handle.generation });
}
function integer(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
    return value;
}
function deadLetterName(queue, fifo) {
    const base = queue.endsWith('.fifo') ? queue.slice(0, -5) : queue;
    const suffix = fifo ? '-dlq.fifo' : '-dlq';
    if (base.length + suffix.length <= 80)
        return base + suffix;
    const hash = (0, node_crypto_1.createHash)('sha256').update(queue).digest('hex').slice(0, 12);
    return (base.slice(0, 80 - suffix.length - hash.length - 1) + '-' + hash + suffix);
}
/** Durable event policy over the MQ-owned wire client. Broker storage owns delivery. */
class DurableTransport {
    client;
    drainTimeoutMs;
    url;
    retryAttempts;
    retryBaseMs;
    /** Per-attempt ceiling on a publish POST. See the constructor note. */
    publishTimeoutMs;
    acknowledgementTimeoutMs;
    maxProcessingAttempts;
    dlqCapacity;
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
    ensuredQueues = new Map();
    queuePolicies = new Map();
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
    unavailableSubscriptions = 0;
    deadLetteredTotal = 0;
    log;
    constructor(config) {
        this.url = config.url.replace(/\/$/, '');
        this.log = new logger_1.LogWriter(config.logger);
        this.retryAttempts = integer(config.retryAttempts ?? 3, 1, 100, 'retryAttempts');
        this.retryBaseMs = integer(config.retryBaseMs ?? 100, 0, 300000, 'retryBaseMs');
        // Without this, a message-queue that accepts the socket and never
        // answers leaves the publish promise pending forever — the caller
        // never resolves, never rejects, and nothing is metered. healthCheck
        // already bounded itself; publish did not.
        this.publishTimeoutMs = config.publishTimeoutMs ?? 10_000;
        this.acknowledgementTimeoutMs = config.acknowledgementTimeoutMs ?? 10_000;
        this.maxProcessingAttempts = integer(config.maxProcessingAttempts ?? 3, 1, 1000, 'maxProcessingAttempts');
        this.dlqCapacity = integer(config.dlqCapacity ?? 10_000, 1, 1000000, 'dlqCapacity');
        // keyIntervalMs: a queue that is still failing an hour later deserves a
        // fresh line; what it must not do is emit one per publish.
        this.backpressureWarnings = new bounded_1.LogThrottle({
            keyIntervalMs: 60_000,
            maxPerWindow: 5,
        });
        this.ensureQueueWarnings = new bounded_1.LogThrottle({
            keyIntervalMs: 60_000,
            maxPerWindow: 5,
        });
        this.pollWarnings = new bounded_1.LogThrottle({
            keyIntervalMs: 60_000,
            maxPerWindow: 5,
        });
        this.handlerWarnings = new bounded_1.LogThrottle({
            keyIntervalMs: 60_000,
            maxPerWindow: 5,
        });
        this.deadLetterWarnings = new bounded_1.LogThrottle({
            keyIntervalMs: 60_000,
            maxPerWindow: 5,
        });
        this.drainTimeoutMs = integer(config.drainTimeoutMs ?? 30000, 0, 2147483647, 'drainTimeoutMs');
        integer(this.acknowledgementTimeoutMs, 1, 2147483647, 'acknowledgementTimeoutMs');
        this.client = new client_1.HttpMessageQueue({
            baseUrl: this.url,
            requestHeaders: config.requestHeaders,
            timeoutMs: this.publishTimeoutMs,
            fetchImpl: (...args) => fetch(...args),
        });
    }
    /**
     * Probe `GET {url}/ready` and mark the transport connected.
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
            await this.client.ready({ timeoutMs: 2000 });
        }
        catch (err) {
            this.log.warn(`[durable-transport] message-queue not reachable at ${this.url}/ready ` +
                `(check MESSAGE_QUEUE_URL): ${err.message}. Continuing in degraded mode — ` +
                `durable publishes will retry and then throw until it recovers.`, { url: `${this.url}/ready`, error: (0, logger_1.errorMessage)(err) });
        }
        this.connected = true;
    }
    /**
     * Abort every active poll loop and mark the transport disconnected.
     * Waits for accepted handlers within the configured drain budget. Unfinished
     * deliveries are left for broker visibility expiry; diagnostics remain local.
     */
    async disconnect() {
        this.connected = false;
        const pollers = [...this.activePollers.values()];
        for (const poller of pollers)
            poller.stop();
        await Promise.all(pollers.map((poller) => poller.done));
        this.ensuredQueues.clear();
    }
    /** Active intake loops; draining handlers are awaited by disconnect/done. */
    getActivePollerCount() {
        return [...this.activePollers.values()].filter((poller) => !poller.stopped)
            .length;
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
        return {
            current: this.inFlightPublishes,
            peak: this.peakInFlightPublishes,
        };
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
            unavailableSubscriptions: this.unavailableSubscriptions,
            deadLetteredTotal: this.deadLetteredTotal,
            suppressedWarnings: this.backpressureWarnings.suppressedTotal +
                this.ensureQueueWarnings.suppressedTotal +
                this.pollWarnings.suppressedTotal +
                this.handlerWarnings.suppressedTotal +
                this.deadLetterWarnings.suppressedTotal,
        };
    }
    /** Strict full-policy ensure. No publish after a missing DLQ or configuration conflict. */
    async ensureQueue(queueName, options = {}, requestOptions = {}) {
        const dlq = options.dlqAfterAttempts === undefined
            ? undefined
            : (options.dlqQueueName ??
                deadLetterName(queueName, options.fifo ?? false));
        const configuration = {
            ...(options.retention === undefined
                ? {}
                : { message_retention_period_seconds: options.retention }),
            ...(options.fifo === undefined ? {} : { fifo_queue: options.fifo }),
            ...(dlq === undefined
                ? {}
                : {
                    redrive_policy: {
                        dead_letter_target_arn: `arn:message-queue:queue:${dlq}`,
                        max_receive_count: integer(options.dlqAfterAttempts, 1, 1000, 'dlqAfterAttempts'),
                    },
                }),
        };
        const fingerprint = JSON.stringify(configuration);
        if (this.ensuredQueues.get(queueName) === fingerprint)
            return;
        try {
            if (dlq !== undefined)
                await this.client.ensure(dlq, { fifo_queue: options.fifo ?? false }, requestOptions);
            await this.client.ensure(queueName, configuration, requestOptions);
            (0, bounded_1.rememberBounded)(this.ensuredQueues, queueName, fingerprint, MAX_TRACKED_QUEUES);
            (0, bounded_1.rememberBounded)(this.queuePolicies, queueName, { ...options }, MAX_TRACKED_QUEUES);
        }
        catch (error) {
            this.warnEnsureQueue(queueName, `[durable-transport] ensureQueue "${queueName}" failed; required policy was not accepted`, { queue: queueName, error: (0, logger_1.errorMessage)(error) });
            throw error;
        }
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
    /** Success means accepted. A failed/uncertain response can still redeliver. */
    async publish(queueName, envelope, queueOptions, options = {}) {
        if (!this.connected)
            throw new Error(`[durable-transport] not connected — cannot publish to queue "${queueName}". Call connect() first.`);
        this.inFlightPublishes++;
        this.peakInFlightPublishes = Math.max(this.peakInFlightPublishes, this.inFlightPublishes);
        try {
            const policy = queueOptions ?? this.queuePolicies.get(queueName);
            await this.ensureQueue(queueName, policy, options);
            if (policy?.fifo && !options.groupId)
                throw new Error('FIFO publish requires a groupId or declared partitionKey');
            const sendOptions = {
                ...options,
                eventName: envelope.eventName,
                ...(policy?.fifo
                    ? { deduplicationId: options.deduplicationId ?? envelope.metadata.id }
                    : {}),
            };
            for (let attempt = 1;; attempt++) {
                try {
                    await this.client.send(queueName, JSON.stringify(envelope), sendOptions);
                    this.incrementMetric(queueName, 'sent');
                    return;
                }
                catch (error) {
                    const failure = error instanceof client_1.MessageQueueError ? error : undefined;
                    let delay = (0, distributed_core_1.computeBackoffDelay)(attempt, {
                        initialDelayMs: this.retryBaseMs,
                        maxDelayMs: 30000,
                    });
                    if (failure?.status === 429) {
                        const count = this.recordBackpressure(queueName);
                        delay = Math.min(BACKPRESSURE_MAX_WAIT_MS, failure.retryAfterMs ?? delay);
                        const suppressed = this.backpressureWarnings.attempt(queueName);
                        if (suppressed !== null)
                            this.log.warn(`[durable-transport] mq_backpressure_observed_total{queue="${queueName}"} ${count} — retry-after ${delay}ms` +
                                bounded_1.LogThrottle.suffix(suppressed), {
                                queue: queueName,
                                backpressureCount: count,
                                retryAfterMs: delay,
                                attempt,
                                suppressed,
                            });
                    }
                    if (options.signal?.aborted ||
                        attempt >= this.retryAttempts ||
                        (failure &&
                            failure.status > 0 &&
                            failure.status < 500 &&
                            failure.status !== 429 &&
                            failure.status !== 404)) {
                        throw new Error(`[durable-transport] publish to "${queueName}" failed after ${attempt} attempts: ${(0, logger_1.errorMessage)(error)}`, { cause: error });
                    }
                    if (failure?.status === 404 && failure.code === 'QueueDoesNotExist') {
                        this.ensuredQueues.delete(queueName);
                        await this.ensureQueue(queueName, policy, options);
                    }
                    await this.sleep(delay, options.signal);
                }
            }
        }
        catch (error) {
            this.incrementMetric(queueName, 'failed');
            throw error;
        }
        finally {
            this.inFlightPublishes--;
        }
    }
    /** Stop intake synchronously; `done` includes bounded draining of accepted handlers. */
    subscribe(queueName, handler, options = {}) {
        const pollingInterval = integer(options.pollingInterval ?? 1000, 0, 300000, 'pollingInterval');
        const batchSize = integer(options.batchSize ?? 10, 1, 10, 'batchSize');
        const subscription = options.subscription === undefined
            ? undefined
            : parseSubscriptionHandle(options.subscription);
        const visibilityTimeout = integer(options.visibilityTimeout ?? 30, 1, 43200, 'visibilityTimeout');
        const intake = new AbortController();
        const leases = new Set();
        let timer;
        const id = this.nextPollerId++;
        let terminalError;
        const poller = {
            stopped: false,
            done: Promise.resolve(),
            stop: () => {
                if (poller.stopped)
                    return;
                poller.stopped = true;
                intake.abort();
                if (leases.size)
                    timer = setTimeout(() => {
                        for (const lease of leases)
                            lease.abandon(new Error('Subscriber drain deadline exceeded'));
                    }, this.drainTimeoutMs);
            },
        };
        this.activePollers.set(id, poller);
        poller.done = this.pollLoop(queueName, handler, { ...options, subscription, pollingInterval, batchSize, visibilityTimeout }, intake.signal, leases, (error) => {
            terminalError = error;
            this.unavailableSubscriptions++;
            poller.stop();
            try {
                options.onTerminalError?.(error);
            }
            catch {
                // Observer failures never change delivery ownership.
            }
        }).finally(() => {
            clearTimeout(timer);
            for (const lease of leases)
                lease.abandon();
            this.activePollers.delete(id);
        });
        const cancel = Object.defineProperties(() => poller.stop(), {
            done: { value: poller.done, enumerable: true },
            terminalError: { get: () => terminalError, enumerable: true },
        });
        return cancel;
    }
    /**
     * Fetch a queue's attributes from message-queue. Never throws — returns
     * `null` on any non-2xx or network error, so `null` does not distinguish
     * "no such queue" from "message-queue is down".
     */
    async getQueueAttributes(queueName) {
        try {
            return await this.client.attributes(queueName);
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
            this.deadLetterCallbacks = this.deadLetterCallbacks.filter((cb) => cb !== callback);
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
     * Probe `GET {url}/ready` with a 2s timeout. Never throws.
     * `'degraded'` = timed out or non-2xx; `'disconnected'` = not connected
     * or the request errored.
     */
    async healthCheck() {
        if (!this.connected) {
            return { status: 'disconnected', latencyMs: 0 };
        }
        const start = performance.now();
        try {
            await this.client.ready({ timeoutMs: 2000 });
            return {
                status: 'connected',
                latencyMs: Math.round(performance.now() - start),
            };
        }
        catch (error) {
            const degraded = error instanceof client_1.MessageQueueError &&
                (error.status > 0 || error.code === 'Timeout');
            return {
                status: degraded ? 'degraded' : 'disconnected',
                latencyMs: Math.round(performance.now() - start),
            };
        }
    }
    async pollLoop(queueName, handler, options, signal, leases, terminate) {
        let failures = 0;
        const subscription = options.subscription;
        const policy = options.queueOptions ?? this.queuePolicies.get(queueName);
        while (!signal.aborted) {
            try {
                if (options.isPaused?.()) {
                    await this.sleep(options.pollingInterval, signal);
                    continue;
                }
                // Explicit subscriptions belong to a host-provisioned queue
                // incarnation; ensuring here could re-create a deleted queue.
                if (!subscription)
                    await this.ensureQueue(queueName, policy, { signal });
                const started = performance.now();
                const messages = await this.client.receive(queueName, {
                    max: options.batchSize,
                    visibilityTimeoutSeconds: options.visibilityTimeout,
                    waitSeconds: 0,
                    signal,
                    ...(subscription ? { subscription } : {}),
                });
                failures = 0;
                // Renew every acquired receipt, including queued members of a slow batch.
                const batch = messages.map((message) => {
                    const lease = new durable_lease_1.DurableLease(this.client, queueName, message, options.visibilityTimeout * 1000, started, this.acknowledgementTimeoutMs);
                    leases.add(lease);
                    this.incrementMetric(queueName, 'inFlight');
                    return { message, lease };
                });
                try {
                    for (const { message, lease } of batch) {
                        if (signal.aborted || options.isPaused?.())
                            break;
                        let processed = false;
                        try {
                            await lease.run(async () => {
                                await handler(JSON.parse(message.body), lease.context);
                            });
                            processed = true;
                            this.messageAttempts.delete(message.message_id);
                            await lease.acknowledge();
                            this.incrementMetric(queueName, 'received');
                        }
                        catch (error) {
                            if (!processed && lease.active)
                                this.recordHandlerFailure(queueName, message, error);
                            else {
                                const suppressed = this.pollWarnings.attempt(`ack:${queueName}`);
                                if (suppressed !== null)
                                    this.log.warn(`[durable-transport] delivery ownership or acknowledgement failed for "${queueName}"; message may be redelivered`, {
                                        queue: queueName,
                                        messageId: message.message_id,
                                        error: (0, logger_1.errorMessage)(error),
                                        suppressed,
                                    });
                            }
                            this.incrementMetric(queueName, 'failed');
                        }
                        finally {
                            lease.abandon();
                            leases.delete(lease);
                            this.decrementInFlight(queueName);
                        }
                    }
                }
                finally {
                    for (const { lease } of batch)
                        if (leases.delete(lease)) {
                            lease.abandon();
                            this.decrementInFlight(queueName);
                        }
                }
                if (!messages.length)
                    await this.sleep(options.pollingInterval, signal);
            }
            catch (error) {
                if (signal.aborted)
                    return;
                if (subscription &&
                    error instanceof client_1.MessageQueueError &&
                    [404, 409].includes(error.status) &&
                    TERMINAL_SUBSCRIPTION_CODES.has(error.code)) {
                    const unavailable = new DurableSubscriptionUnavailableError(queueName, subscription, error.code, error);
                    this.log.error(`[durable-transport] ${unavailable.message}; intake stopped`, {
                        queue: queueName,
                        subscription: subscription.id,
                        generation: subscription.generation,
                        code: error.code,
                    });
                    terminate(unavailable);
                    return;
                }
                if (error instanceof client_1.MessageQueueError &&
                    error.status === 404 &&
                    error.code === 'QueueDoesNotExist') {
                    this.ensuredQueues.delete(queueName);
                    this.queueVanishedCount++;
                }
                this.pollFailures++;
                const suppressed = this.pollWarnings.attempt(`poll:${queueName}`);
                if (suppressed !== null)
                    this.log.error(`[durable-transport] poll failed for "${queueName}"` +
                        bounded_1.LogThrottle.suffix(suppressed), {
                        queue: queueName,
                        error: (0, logger_1.errorMessage)(error),
                        pollFailures: this.pollFailures,
                        suppressed,
                    });
                await this.sleep((0, distributed_core_1.computeBackoffDelay)(++failures, {
                    initialDelayMs: options.pollingInterval,
                    maxDelayMs: 30000,
                }), signal);
            }
        }
    }
    recordHandlerFailure(queueName, msg, err) {
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
            catch {
                /* use undefined */
            }
            if (this.deadLetterMessages.length >= this.dlqCapacity) {
                this.deadLetterMessages.splice(0, this.deadLetterMessages.length - this.dlqCapacity + 1);
            }
            const dlqMessage = {
                messageId: msg.message_id,
                queueName,
                envelope: envelope ?? {
                    eventName: 'unknown',
                    payload: msg.body,
                    metadata: {
                        id: msg.message_id,
                        producer: 'unknown',
                        timestamp: Date.now(),
                    },
                },
                error: err.message,
                attempts: attemptCount,
                deadLetteredAt: new Date().toISOString(),
            };
            this.deadLetterMessages.push(dlqMessage);
            for (const cb of this.deadLetterCallbacks) {
                try {
                    cb(dlqMessage);
                }
                catch {
                    /* ignore callback errors */
                }
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
                this.log.error(`[durable-transport] message ${msg.message_id} retained at source after ${attemptCount} failed attempts in "${queueName}" ` +
                    `(${this.deadLetteredTotal} poison observations this process)` +
                    bounded_1.LogThrottle.suffix(dlSuppressed), {
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
                this.log.warn(`[durable-transport] handler error for "${queueName}" (attempt ${attemptCount}/${this.maxProcessingAttempts}) ` +
                    `(${this.handlerFailures} handler failures this process)` +
                    bounded_1.LogThrottle.suffix(hSuppressed) +
                    ':', {
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
    }
    sleep(ms, signal) {
        return new Promise((resolve) => {
            if (signal?.aborted) {
                resolve();
                return;
            }
            const onAbort = () => {
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            signal?.addEventListener('abort', onAbort, { once: true });
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
    static eventNameToQueueName(eventName, fifo = false) {
        const name = eventName.replace(/[:.]/g, '-').replace(/--+/g, '-');
        return fifo ? `${name}.fifo` : name;
    }
}
exports.DurableTransport = DurableTransport;
//# sourceMappingURL=durable.js.map