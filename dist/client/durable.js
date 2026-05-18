"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DurableTransport = void 0;
const transport_1 = require("distributed-core/transport");
class DurableTransport {
    url;
    /** message-queue's canonical versioned queue surface (Roadmap 4.1). */
    queuesBase;
    retryAttempts;
    retryBaseMs;
    maxProcessingAttempts;
    dlqCapacity;
    retryManager;
    pollRetryManager;
    connected = false;
    activePollers = new Map();
    queueMetrics = new Map();
    ensuredQueues = new Set();
    deadLetterMessages = [];
    messageAttempts = new Map();
    deadLetterCallbacks = [];
    constructor(config) {
        this.url = config.url.replace(/\/$/, '');
        this.queuesBase = `${this.url}/api/v1/queues`;
        this.retryAttempts = config.retryAttempts ?? 3;
        this.retryBaseMs = config.retryBaseMs ?? 100;
        this.maxProcessingAttempts = config.maxProcessingAttempts ?? 3;
        this.dlqCapacity = config.dlqCapacity ?? 10_000;
        this.retryManager = new transport_1.RetryManager({
            maxRetries: this.retryAttempts - 1, // RetryManager does initial attempt + retries
            baseDelay: this.retryBaseMs,
            backoffFactor: 2,
            jitter: false,
            enableLogging: false,
            name: 'durable-transport',
        });
        this.pollRetryManager = new transport_1.RetryManager({
            maxRetries: 2, // 3 total attempts (1 initial + 2 retries)
            baseDelay: 1000,
            backoffFactor: 2,
            jitter: false,
            enableLogging: false,
            name: 'durable-poll',
        });
    }
    async connect() {
        if (this.connected)
            return;
        // Verify message-queue is reachable
        try {
            const res = await fetch(`${this.url}/health`);
            if (!res.ok)
                throw new Error(`status ${res.status}`);
        }
        catch (err) {
            console.warn(`[durable-transport] message-queue not reachable at ${this.url}:`, err.message);
        }
        this.connected = true;
    }
    async disconnect() {
        for (const [, controller] of this.activePollers) {
            controller.abort();
        }
        this.activePollers.clear();
        this.connected = false;
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
                console.warn(`[durable-transport] DLQ ensure for "${dlqName}" failed; main queue "${queueName}" will be created WITHOUT redrive_policy`);
            }
        }
        // Step 2 — build the QueueConfiguration body from declared options.
        const configuration = this.buildQueueConfig(options, dlqArn);
        const ok = await this.putQueue(queueName, configuration);
        if (ok)
            this.ensuredQueues.add(queueName);
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
            const res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configuration }),
            });
            if (res.status === 200 || res.status === 201) {
                return true;
            }
            if (res.status === 409) {
                const body = await res.json().catch(() => ({}));
                console.warn(`[durable-transport] queue "${queueName}" exists with differing config — accepting drift:`, JSON.stringify(body.conflicts ?? body));
                // Drift is not a fatal error; the queue exists and we can publish.
                return true;
            }
            const text = await res.text().catch(() => 'unknown');
            console.warn(`[durable-transport] ensureQueue "${queueName}" failed: ${res.status} ${text}`);
            return false;
        }
        catch (err) {
            console.warn(`[durable-transport] ensureQueue "${queueName}" error:`, err.message);
            return false;
        }
    }
    async publish(queueName, envelope, queueOptions) {
        if (!this.connected) {
            throw new Error('[durable-transport] not connected');
        }
        await this.ensureQueue(queueName, queueOptions);
        const body = JSON.stringify({
            message_body: JSON.stringify(envelope),
        });
        try {
            await this.retryManager.execute(async () => {
                const res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                });
                if (!res.ok) {
                    throw new Error(`message-queue returned ${res.status}`);
                }
            });
            this.incrementMetric(queueName, 'sent');
        }
        catch (err) {
            this.incrementMetric(queueName, 'failed');
            throw new Error(`[durable-transport] publish to "${queueName}" failed after ${this.retryAttempts} attempts: ${err.message}`);
        }
    }
    subscribe(queueName, handler, options = {}) {
        const { pollingInterval = 1000, batchSize = 10, visibilityTimeout = 30, } = options;
        const controller = new AbortController();
        this.activePollers.set(queueName, controller);
        this.ensureQueue(queueName).then(() => {
            this.pollLoop(queueName, handler, {
                pollingInterval,
                batchSize,
                visibilityTimeout,
                signal: controller.signal,
            });
        });
        return () => {
            controller.abort();
            this.activePollers.delete(queueName);
        };
    }
    async getQueueAttributes(queueName) {
        try {
            const res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/attributes`);
            if (!res.ok)
                return null;
            return await res.json();
        }
        catch {
            return null;
        }
    }
    getMetrics(queueName) {
        if (queueName)
            return this.queueMetrics.get(queueName);
        return new Map(this.queueMetrics);
    }
    getAllMetrics() {
        return new Map(this.queueMetrics);
    }
    getDLQ() {
        return [...this.deadLetterMessages];
    }
    drainDLQ() {
        const messages = [...this.deadLetterMessages];
        this.deadLetterMessages.length = 0;
        return messages;
    }
    onDeadLetter(callback) {
        this.deadLetterCallbacks.push(callback);
        return () => {
            this.deadLetterCallbacks = this.deadLetterCallbacks.filter(cb => cb !== callback);
        };
    }
    isConnected() {
        return this.connected;
    }
    async healthCheck() {
        if (!this.connected) {
            return { status: 'disconnected', latencyMs: 0 };
        }
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${this.url}/health`, { signal: controller.signal });
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
                        const res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages?` +
                            `max_messages=${batchSize}&visibility_timeout=${visibilityTimeout}`, { signal });
                        if (!res.ok) {
                            throw new Error(`message-queue returned ${res.status}`);
                        }
                        return await res.json();
                    });
                }
                catch (pollErr) {
                    if (signal.aborted)
                        return;
                    console.error(`[durable-transport] poll failed for "${queueName}" after retries:`, pollErr.message);
                    await this.sleep(pollingInterval, signal);
                    continue;
                }
                const messages = data.messages ?? [];
                for (const msg of messages) {
                    this.incrementMetric(queueName, 'inFlight');
                    try {
                        const envelope = JSON.parse(msg.body);
                        await handler(envelope);
                        // Delete on success — processing succeeded
                        await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`, { method: 'DELETE' });
                        this.incrementMetric(queueName, 'received');
                        this.decrementInFlight(queueName);
                        // Clear attempt counter on success
                        this.messageAttempts.delete(msg.message_id);
                    }
                    catch (err) {
                        const attemptCount = (this.messageAttempts.get(msg.message_id) ?? 0) + 1;
                        this.messageAttempts.set(msg.message_id, attemptCount);
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
                            // Delete from source queue so it's not redelivered
                            await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`, { method: 'DELETE' }).catch(() => { });
                            this.messageAttempts.delete(msg.message_id);
                            console.error(`[durable-transport] message ${msg.message_id} dead-lettered after ${attemptCount} attempts in "${queueName}"`);
                        }
                        else {
                            console.warn(`[durable-transport] handler error for "${queueName}" (attempt ${attemptCount}/${this.maxProcessingAttempts}):`, err.message);
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
                console.warn(`[durable-transport] poll error for "${queueName}":`, err.message);
                await this.sleep(pollingInterval, signal);
            }
        }
    }
    sleep(ms, signal) {
        return new Promise(resolve => {
            if (signal.aborted) {
                resolve();
                return;
            }
            const timer = setTimeout(resolve, ms);
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
    }
    incrementMetric(queueName, field) {
        let metrics = this.queueMetrics.get(queueName);
        if (!metrics) {
            metrics = { sent: 0, received: 0, failed: 0, inFlight: 0 };
            this.queueMetrics.set(queueName, metrics);
        }
        metrics[field]++;
    }
    decrementInFlight(queueName) {
        const metrics = this.queueMetrics.get(queueName);
        if (metrics && metrics.inFlight > 0) {
            metrics.inFlight--;
        }
    }
    static eventNameToQueueName(eventName) {
        return eventName.replace(/[:.]/g, '-').replace(/--+/g, '-');
    }
}
exports.DurableTransport = DurableTransport;
//# sourceMappingURL=durable.js.map