import { type SendOptions, type RequestOptions, type SubscriptionHandle } from '@connorhoehnslalom/message-queue/client';
export type { SubscriptionHandle } from '@connorhoehnslalom/message-queue/client';
import { type DurableHandlerContext } from './durable-lease';
export type { DurableHandlerContext } from './durable-lease';
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
    }) => Record<string, string> | Promise<Record<string, string>>;
    /** Maximum wait for accepted handlers during disconnect/unsubscribe. Default 30000. */
    drainTimeoutMs?: number;
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
    queueOptions?: EnsureQueueOptions;
    /** Pauses intake; acquired but unstarted messages are left for redelivery. */
    isPaused?: () => boolean;
    /**
     * Receive through an explicit queue-owned subscription (ID plus generation)
     * instead of the queue's default delivery scope. The host or an operator
     * provisions the queue and the subscription; in this mode the transport
     * never ensures, re-creates or deletes either. A stale or missing
     * subscription (or queue incarnation) ends intake with
     * {@link DurableSubscription.terminalError} set; it never falls back to the
     * default scope.
     */
    subscription?: SubscriptionHandle;
    /** Called once when intake ends because the selected subscription can no longer be used. */
    onTerminalError?: (error: Error) => void;
}
/** Raised when an explicit subscription handle is stale, removed or belongs to a replaced queue. */
export declare class DurableSubscriptionUnavailableError extends Error {
    readonly queue: string;
    readonly subscription: SubscriptionHandle;
    readonly code: string;
    readonly cause?: unknown;
    readonly name = "DurableSubscriptionUnavailableError";
    constructor(queue: string, subscription: SubscriptionHandle, code: string, cause?: unknown);
}
/** Validate and freeze a queue-owned subscription handle. */
export declare function parseSubscriptionHandle(value: unknown): SubscriptionHandle;
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
type MessageHandler = (envelope: EventEnvelope, context: DurableHandlerContext) => Promise<void>;
export type DurablePublishOptions = SendOptions;
export type DurableSubscription = (() => void) & {
    readonly done: Promise<void>;
    /** Set when intake ended because the explicit subscription became unusable. */
    readonly terminalError: Error | undefined;
};
export type DeadLetterCallback = (message: DeadLetteredMessage) => void;
/** Durable event policy over the MQ-owned wire client. Broker storage owns delivery. */
export declare class DurableTransport {
    private readonly client;
    private readonly drainTimeoutMs;
    private readonly url;
    private readonly retryAttempts;
    private readonly retryBaseMs;
    /** Per-attempt ceiling on a publish POST. See the constructor note. */
    private readonly publishTimeoutMs;
    private readonly acknowledgementTimeoutMs;
    private readonly maxProcessingAttempts;
    private readonly dlqCapacity;
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
    private queuePolicies;
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
    private unavailableSubscriptions;
    private deadLetteredTotal;
    private readonly log;
    constructor(config: DurableTransportConfig);
    /**
     * Probe `GET {url}/ready` and mark the transport connected.
     *
     * Never throws, and marks itself connected **even when the probe fails**
     * — the warning names the URL so an operator can check
     * `MESSAGE_QUEUE_URL`, and publishes will surface the real error with
     * their own retries. Idempotent.
     */
    connect(): Promise<void>;
    /**
     * Abort every active poll loop and mark the transport disconnected.
     * Waits for accepted handlers within the configured drain budget. Unfinished
     * deliveries are left for broker visibility expiry; diagnostics remain local.
     */
    disconnect(): Promise<void>;
    /** Active intake loops; draining handlers are awaited by disconnect/done. */
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
        unavailableSubscriptions: number;
        deadLetteredTotal: number;
        suppressedWarnings: number;
    };
    /** Strict full-policy ensure. No publish after a missing DLQ or configuration conflict. */
    ensureQueue(queueName: string, options?: EnsureQueueOptions, requestOptions?: RequestOptions): Promise<void>;
    /**
     * `ensureQueue` runs on every publish until it succeeds, so a
     * message-queue outage puts these warnings on the per-publish path.
     * Count every failure; log a bounded sample.
     */
    private warnEnsureQueue;
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
    /** Success means accepted. A failed/uncertain response can still redeliver. */
    publish(queueName: string, envelope: EventEnvelope, queueOptions?: EnsureQueueOptions, options?: DurablePublishOptions): Promise<void>;
    /** Stop intake synchronously; `done` includes bounded draining of accepted handlers. */
    subscribe(queueName: string, handler: MessageHandler, options?: DurableSubscribeOptions): DurableSubscription;
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
     * Probe `GET {url}/ready` with a 2s timeout. Never throws.
     * `'degraded'` = timed out or non-2xx; `'disconnected'` = not connected
     * or the request errored.
     */
    healthCheck(): Promise<{
        status: 'connected' | 'degraded' | 'disconnected';
        latencyMs: number;
    }>;
    private pollLoop;
    private recordHandlerFailure;
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
    static eventNameToQueueName(eventName: string, fifo?: boolean): string;
}
//# sourceMappingURL=durable.d.ts.map