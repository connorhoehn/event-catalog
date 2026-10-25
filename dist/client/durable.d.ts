import type { EventEnvelope } from '../types/index';
import { type CatalogLogger } from '../utils/logger';
/** Re-exported so consumers can type a logger without reaching into a subpath. */
export type { CatalogLogger, LogFields } from '../utils/logger';
export interface DurableTransportConfig {
    /**
     * Base URL of the `message-queue` service (no trailing slash required).
     * Usually sourced from the `MESSAGE_QUEUE_URL` env var by the owning
     * service; the platform default is `http://localhost:3004`.
     */
    url: string;
    /** Called for every HTTP attempt, including receive and acknowledgement. */
    requestHeaders?: (request: {
        url: string;
        method: string;
        body: string;
    }) => Record<string, string>;
    /** Total publish attempts before giving up (not *extra* retries). Default 3. */
    retryAttempts?: number;
    /** Base for the exponential publish back-off, in ms. Default 100. */
    retryBaseMs?: number;
    /**
     * Per-attempt ceiling on a publish POST, in ms. Default 10000. A queue
     * that accepts the connection and never responds is treated as a network
     * failure and retried, rather than hanging the caller indefinitely.
     */
    publishTimeoutMs?: number;
    /** Deadline for receipt deletion after processing; default 10000 ms. */
    acknowledgementTimeoutMs?: number;
    /** Handler failures before a diagnostic is recorded. Broker redrive owns removal. Default: 3. */
    maxProcessingAttempts?: number;
    /** Maximum poison-message diagnostics retained in memory. Default: 10000. */
    dlqCapacity?: number;
    /**
     * Sink for this transport's diagnostics. Defaults to `console.warn` /
     * `console.error` — byte-identical to the pre-logger behaviour.
     */
    logger?: CatalogLogger;
}
export interface DeadLetteredMessage {
    messageId: string;
    queueName: string;
    envelope: EventEnvelope;
    error: string;
    attempts: number;
    deadLetteredAt: string;
}
export interface DurableSubscribeOptions {
    pollingInterval?: number;
    batchSize?: number;
    visibilityTimeout?: number;
}
/**
 * Subset of an event-catalog EventDeclaration's durable-side config that
 * affects queue creation. Passed by EventCatalog.publish() (Phase 4.2)
 * so DurableTransport.ensureQueue() can PUT the right shape without
 * coupling to the full EventDeclaration type.
 */
export interface EnsureQueueOptions {
    /** Message retention in seconds (maps to message_retention_period_seconds). */
    retention?: number;
    /** FIFO queue ordering (maps to fifo_queue). */
    fifo?: boolean;
    /**
     * Auto-route to DLQ after this many delivery attempts. When set,
     * ensureQueue auto-creates a paired DLQ (named `${queue}-dlq` by
     * default) and wires redrive_policy on the main queue.
     */
    dlqAfterAttempts?: number;
    /** Override the auto-derived DLQ name. */
    dlqQueueName?: string;
}
interface QueueMetrics {
    sent: number;
    received: number;
    failed: number;
    inFlight: number;
}
type MessageHandler = (envelope: EventEnvelope) => Promise<void>;
export type DeadLetterCallback = (message: DeadLetteredMessage) => void;
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
export declare class DurableTransport {
    private readonly requestHeaders?;
    private readonly url;
    /** message-queue's canonical versioned queue surface (Roadmap 4.1). */
    private readonly queuesBase;
    private readonly retryAttempts;
    private readonly retryBaseMs;
    /** Per-attempt ceiling on a publish POST. See the constructor note. */
    private readonly publishTimeoutMs;
    private readonly acknowledgementTimeoutMs;
    private readonly maxProcessingAttempts;
    private readonly dlqCapacity;
    private readonly pollRetryManager;
    private connected;
    /**
     * Keyed by a monotonic id, not by queue name: two `subscribe()` calls on
     * the same queue used to overwrite each other's AbortController, which
     * orphaned the first poll loop for the life of the process and made
     * `disconnect()` unable to stop it.
     */
    private activePollers;
    private nextPollerId;
    private queueMetrics;
    private evictedQueueMetrics;
    private ensuredQueues;
    private readonly deadLetterMessages;
    private readonly messageAttempts;
    private evictedMessageAttempts;
    private deadLetterCallbacks;
    /** Publishes currently awaiting message-queue. See {@link getInFlightPublishCount}. */
    private inFlightPublishes;
    private peakInFlightPublishes;
    /**
     * Every log line below runs per-publish or per-message, which is exactly
     * the rate at which a dependency outage executes. Counted always,
     * logged at a bounded rate.
     */
    private readonly backpressureWarnings;
    private readonly ensureQueueWarnings;
    private readonly pollWarnings;
    private readonly handlerWarnings;
    private readonly deadLetterWarnings;
    private handlerFailures;
    private ensureQueueFailures;
    /** Times a polled queue answered 404 and was re-created in place. */
    private queueVanishedCount;
    private pollFailures;
    private deadLetteredTotal;
    private readonly log;
    constructor(config: DurableTransportConfig);
    /**
     * Probe `GET {url}/health` and mark the transport connected.
     *
     * Never throws, and marks itself connected **even when the probe fails**
     * — the warning names the URL so an operator can check
     * `MESSAGE_QUEUE_URL`, and publishes will surface the real error with
     * their own retries. Idempotent.
     */
    connect(): Promise<void>;
    /**
     * Abort every active poll loop and mark the transport disconnected.
     * Never throws. In-memory DLQ contents survive; in-flight messages are
     * left for the queue's visibility timeout to redeliver.
     */
    disconnect(): Promise<void>;
    /** Poll loops still running. Should be 0 after `disconnect()`. */
    getActivePollerCount(): number;
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
    getInFlightPublishCount(): {
        current: number;
        peak: number;
    };
    /**
     * Aggregates that survive per-key eviction and log suppression.
     *
     * `getMetrics()` and `getBackpressureCount()` hold at most
     * {@link MAX_TRACKED_QUEUES} entries each; these totals do not evict, so
     * they remain the truthful answer to "did anything fail?".
     */
    getOverflowStats(): {
        trackedQueues: number;
        evictedQueueMetrics: number;
        trackedMessageAttempts: number;
        evictedMessageAttempts: number;
        handlerFailures: number;
        ensureQueueFailures: number;
        pollFailures: number;
        queueVanished: number;
        deadLetteredTotal: number;
        suppressedWarnings: number;
    };
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
    ensureQueue(queueName: string, options?: EnsureQueueOptions): Promise<void>;
    private rememberEnsuredQueue;
    /**
     * `ensureQueue` runs on every publish until it succeeds, so a
     * message-queue outage puts these warnings on the per-publish path.
     * Count every failure; log a bounded sample.
     */
    private warnEnsureQueue;
    /**
     * Map an event-catalog declaration's queue-config fields to
     * message-queue's snake_case QueueConfiguration shape.
     */
    private buildQueueConfig;
    /**
     * Single PUT to /api/v1/queues/{name}. Returns true on 200/201, false on 409
     * (logs the conflict diff) or any other status / network error.
     */
    private putQueue;
    /**
     * Increment and return the module-level backpressure counter for a queue.
     * Exposed via `DurableTransport.getBackpressureCount()` for tests/metrics.
     */
    private recordBackpressure;
    /**
     * Return total backpressure events observed for a queue (or all queues).
     *
     * The no-argument map holds at most {@link MAX_TRACKED_QUEUES} queues;
     * `getBackpressureTotal()` is the number that never loses an observation.
     */
    static getBackpressureCount(queueName?: string): number | Map<string, number>;
    /** Lifetime backpressure observations, unaffected by per-queue eviction. */
    static getBackpressureTotal(): number;
    /** Reset backpressure counters (useful in tests). */
    static resetBackpressureCounters(): void;
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
    publish(queueName: string, envelope: EventEnvelope, queueOptions?: EnsureQueueOptions): Promise<void>;
    private publishInner;
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
    subscribe(queueName: string, handler: MessageHandler, options?: DurableSubscribeOptions): () => void;
    /**
     * Fetch a queue's attributes from message-queue. Never throws — returns
     * `null` on any non-2xx or network error, so `null` does not distinguish
     * "no such queue" from "message-queue is down".
     */
    getQueueAttributes(queueName: string): Promise<Record<string, unknown> | null>;
    /**
     * Per-queue sent/received/failed/in-flight counters. Process-local and
     * reset on restart; not a substitute for message-queue's own metrics.
     */
    getMetrics(queueName?: string): Map<string, QueueMetrics> | QueueMetrics | undefined;
    /** Same as `getMetrics()` with no argument, but narrowly typed to the map. */
    getAllMetrics(): Map<string, QueueMetrics>;
    /**
     * Snapshot of the in-memory dead-letter buffer (a copy — mutating it
     * does not affect the transport).
     *
     * This buffer is **not durable**: it is capped at `dlqCapacity`, evicts
     * oldest-first when full, and is lost on restart. Source messages are never
     * acknowledged on its strength. Configure broker redrive for durable DLQ
     * movement; onDeadLetter callbacks only observe failures.
     */
    getDLQ(): DeadLetteredMessage[];
    /** Return and clear the in-memory dead-letter buffer. */
    drainDLQ(): DeadLetteredMessage[];
    /**
     * Register a callback fired synchronously whenever a message is
     * recorded as poison. Callback exceptions are swallowed; callbacks do not
     * authorize source deletion. Returns an
     * unregister function.
     */
    onDeadLetter(callback: DeadLetterCallback): () => void;
    /**
     * True once `connect()` has run. Says nothing about whether
     * message-queue is actually reachable — use {@link healthCheck} for that.
     */
    isConnected(): boolean;
    /**
     * Probe `GET {url}/health` with a 2s timeout. Never throws.
     * `'degraded'` = timed out or non-2xx; `'disconnected'` = not connected
     * or the request errored.
     */
    healthCheck(): Promise<{
        status: 'connected' | 'degraded' | 'disconnected';
        latencyMs: number;
    }>;
    private pollLoop;
    private request;
    private acknowledge;
    /** Unconditional sleep without an abort signal (used in publish retry loop). */
    private sleepMs;
    private sleep;
    private incrementMetric;
    private decrementInFlight;
    /**
     * Default event-name → queue-name derivation: `:` and `.` become `-`,
     * runs of `-` collapse. `pipeline:run:started` → `pipeline-run-started`.
     *
     * Note the mapping is lossy — `a:b` and `a.b` derive the same queue. Set
     * `queue` on the declaration when you need them kept apart.
     */
    static eventNameToQueueName(eventName: string): string;
}
//# sourceMappingURL=durable.d.ts.map