import { computeBackoffDelay } from 'distributed-core';
import { createHash } from 'node:crypto';
import {
  HttpMessageQueue,
  MessageQueueError,
  type QueueConfiguration,
  type QueueMessage,
  type SendOptions,
  type RequestOptions,
} from '@connorhoehnslalom/message-queue/client';
import { DurableLease, type DurableHandlerContext } from './durable-lease';
export type { DurableHandlerContext } from './durable-lease';
import type { EventEnvelope } from '../types/index';
import { BoundedCounter, LogThrottle, rememberBounded } from '../utils/bounded';
import {
  LogWriter,
  errorMessage,
  type CatalogLogger,
  type LogFields,
} from '../utils/logger';

/** Re-exported so consumers can type a logger without reaching into a subpath. */
export type { CatalogLogger, LogFields } from '../utils/logger';

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
const backpressureCounter = new BoundedCounter(MAX_TRACKED_QUEUES);

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

type MessageHandler = (
  envelope: EventEnvelope,
  context: DurableHandlerContext,
) => Promise<void>;
export type DurablePublishOptions = SendOptions;
export type DurableSubscription = (() => void) & {
  readonly done: Promise<void>;
};
interface Poller {
  stop(): void;
  done: Promise<void>;
  stopped: boolean;
}

function integer(
  value: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  return value;
}

function deadLetterName(queue: string, fifo: boolean): string {
  const base = queue.endsWith('.fifo') ? queue.slice(0, -5) : queue;
  const suffix = fifo ? '-dlq.fifo' : '-dlq';
  if (base.length + suffix.length <= 80) return base + suffix;
  const hash = createHash('sha256').update(queue).digest('hex').slice(0, 12);
  return (
    base.slice(0, 80 - suffix.length - hash.length - 1) + '-' + hash + suffix
  );
}

export type DeadLetterCallback = (message: DeadLetteredMessage) => void;

/** Durable event policy over the MQ-owned wire client. Broker storage owns delivery. */
export class DurableTransport {
  private readonly client: HttpMessageQueue;
  private readonly drainTimeoutMs: number;
  private readonly url: string;
  private readonly retryAttempts: number;
  private readonly retryBaseMs: number;
  /** Per-attempt ceiling on a publish POST. See the constructor note. */
  private readonly publishTimeoutMs: number;
  private readonly acknowledgementTimeoutMs: number;
  private readonly maxProcessingAttempts: number;
  private readonly dlqCapacity: number;
  private connected = false;
  /**
   * Keyed by a monotonic id, not by queue name: two `subscribe()` calls on
   * the same queue used to overwrite each other's AbortController, which
   * orphaned the first poll loop for the life of the process and made
   * `disconnect()` unable to stop it.
   */
  private activePollers = new Map<number, Poller>();
  private nextPollerId = 1;
  private queueMetrics = new Map<string, QueueMetrics>();
  private evictedQueueMetrics = 0;
  private ensuredQueues = new Map<string, string>();
  private queuePolicies = new Map<string, EnsureQueueOptions>();
  private readonly deadLetterMessages: DeadLetteredMessage[] = [];
  private readonly messageAttempts = new Map<string, number>();
  private evictedMessageAttempts = 0;
  private deadLetterCallbacks: DeadLetterCallback[] = [];
  /** Publishes currently awaiting message-queue. See {@link getInFlightPublishCount}. */
  private inFlightPublishes = 0;
  private peakInFlightPublishes = 0;
  /**
   * Every log line below runs per-publish or per-message, which is exactly
   * the rate at which a dependency outage executes. Counted always,
   * logged at a bounded rate.
   */
  private readonly backpressureWarnings: LogThrottle;
  private readonly ensureQueueWarnings: LogThrottle;
  private readonly pollWarnings: LogThrottle;
  private readonly handlerWarnings: LogThrottle;
  private readonly deadLetterWarnings: LogThrottle;
  private handlerFailures = 0;
  private ensureQueueFailures = 0;
  /** Times a polled queue answered 404 and was re-created in place. */
  private queueVanishedCount = 0;
  private pollFailures = 0;
  private deadLetteredTotal = 0;
  private readonly log: LogWriter;

  constructor(config: DurableTransportConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.log = new LogWriter(config.logger);

    this.retryAttempts = integer(
      config.retryAttempts ?? 3,
      1,
      100,
      'retryAttempts',
    );
    this.retryBaseMs = integer(
      config.retryBaseMs ?? 100,
      0,
      300000,
      'retryBaseMs',
    );
    // Without this, a message-queue that accepts the socket and never
    // answers leaves the publish promise pending forever — the caller
    // never resolves, never rejects, and nothing is metered. healthCheck
    // already bounded itself; publish did not.
    this.publishTimeoutMs = config.publishTimeoutMs ?? 10_000;
    this.acknowledgementTimeoutMs = config.acknowledgementTimeoutMs ?? 10_000;
    this.maxProcessingAttempts = integer(
      config.maxProcessingAttempts ?? 3,
      1,
      1000,
      'maxProcessingAttempts',
    );
    this.dlqCapacity = integer(
      config.dlqCapacity ?? 10_000,
      1,
      1000000,
      'dlqCapacity',
    );
    // keyIntervalMs: a queue that is still failing an hour later deserves a
    // fresh line; what it must not do is emit one per publish.
    this.backpressureWarnings = new LogThrottle({
      keyIntervalMs: 60_000,
      maxPerWindow: 5,
    });
    this.ensureQueueWarnings = new LogThrottle({
      keyIntervalMs: 60_000,
      maxPerWindow: 5,
    });
    this.pollWarnings = new LogThrottle({
      keyIntervalMs: 60_000,
      maxPerWindow: 5,
    });
    this.handlerWarnings = new LogThrottle({
      keyIntervalMs: 60_000,
      maxPerWindow: 5,
    });
    this.deadLetterWarnings = new LogThrottle({
      keyIntervalMs: 60_000,
      maxPerWindow: 5,
    });
    this.drainTimeoutMs = integer(
      config.drainTimeoutMs ?? 30000,
      0,
      2147483647,
      'drainTimeoutMs',
    );
    integer(
      this.acknowledgementTimeoutMs,
      1,
      2147483647,
      'acknowledgementTimeoutMs',
    );
    this.client = new HttpMessageQueue({
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
  async connect(): Promise<void> {
    if (this.connected) return;

    // Verify message-queue is reachable
    try {
      await this.client.ready({ timeoutMs: 2000 });
    } catch (err) {
      this.log.warn(
        `[durable-transport] message-queue not reachable at ${this.url}/ready ` +
          `(check MESSAGE_QUEUE_URL): ${(err as Error).message}. Continuing in degraded mode — ` +
          `durable publishes will retry and then throw until it recovers.`,
        { url: `${this.url}/ready`, error: errorMessage(err) },
      );
    }

    this.connected = true;
  }

  /**
   * Abort every active poll loop and mark the transport disconnected.
   * Waits for accepted handlers within the configured drain budget. Unfinished
   * deliveries are left for broker visibility expiry; diagnostics remain local.
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    const pollers = [...this.activePollers.values()];
    for (const poller of pollers) poller.stop();
    await Promise.all(pollers.map((poller) => poller.done));
    this.ensuredQueues.clear();
  }

  /** Active intake loops; draining handlers are awaited by disconnect/done. */
  getActivePollerCount(): number {
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
  getInFlightPublishCount(): { current: number; peak: number } {
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
  } {
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
      suppressedWarnings:
        this.backpressureWarnings.suppressedTotal +
        this.ensureQueueWarnings.suppressedTotal +
        this.pollWarnings.suppressedTotal +
        this.handlerWarnings.suppressedTotal +
        this.deadLetterWarnings.suppressedTotal,
    };
  }

  /** Strict full-policy ensure. No publish after a missing DLQ or configuration conflict. */
  async ensureQueue(
    queueName: string,
    options: EnsureQueueOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<void> {
    const dlq =
      options.dlqAfterAttempts === undefined
        ? undefined
        : (options.dlqQueueName ??
          deadLetterName(queueName, options.fifo ?? false));
    const configuration: Partial<QueueConfiguration> = {
      ...(options.retention === undefined
        ? {}
        : { message_retention_period_seconds: options.retention }),
      ...(options.fifo === undefined ? {} : { fifo_queue: options.fifo }),
      ...(dlq === undefined
        ? {}
        : {
            redrive_policy: {
              dead_letter_target_arn: `arn:message-queue:queue:${dlq}`,
              max_receive_count: integer(
                options.dlqAfterAttempts!,
                1,
                1000,
                'dlqAfterAttempts',
              ),
            },
          }),
    };
    const fingerprint = JSON.stringify(configuration);
    if (this.ensuredQueues.get(queueName) === fingerprint) return;
    try {
      if (dlq !== undefined)
        await this.client.ensure(
          dlq,
          { fifo_queue: options.fifo ?? false },
          requestOptions,
        );
      await this.client.ensure(queueName, configuration, requestOptions);
      rememberBounded(
        this.ensuredQueues,
        queueName,
        fingerprint,
        MAX_TRACKED_QUEUES,
      );
      rememberBounded(
        this.queuePolicies,
        queueName,
        { ...options },
        MAX_TRACKED_QUEUES,
      );
    } catch (error) {
      this.warnEnsureQueue(
        queueName,
        `[durable-transport] ensureQueue "${queueName}" failed; required policy was not accepted`,
        { queue: queueName, error: errorMessage(error) },
      );
      throw error;
    }
  }

  /**
   * `ensureQueue` runs on every publish until it succeeds, so a
   * message-queue outage puts these warnings on the per-publish path.
   * Count every failure; log a bounded sample.
   */
  private warnEnsureQueue(
    key: string,
    message: string,
    fields: LogFields,
    ...rest: unknown[]
  ): void {
    this.ensureQueueFailures++;
    const suppressed = this.ensureQueueWarnings.attempt(key);
    if (suppressed === null) return;
    this.log.warn(
      message + LogThrottle.suffix(suppressed),
      { ...fields, ensureQueueFailures: this.ensureQueueFailures, suppressed },
      ...rest,
    );
  }

  /**
   * Increment and return the module-level backpressure counter for a queue.
   * Exposed via `DurableTransport.getBackpressureCount()` for tests/metrics.
   */
  private recordBackpressure(queueName: string): number {
    return backpressureCounter.increment(queueName);
  }

  /**
   * Return total backpressure events observed for a queue (or all queues).
   *
   * The no-argument map holds at most {@link MAX_TRACKED_QUEUES} queues;
   * `getBackpressureTotal()` is the number that never loses an observation.
   */
  static getBackpressureCount(
    queueName?: string,
  ): number | Map<string, number> {
    if (queueName !== undefined) {
      return backpressureCounter.get(queueName);
    }
    return backpressureCounter.snapshot();
  }

  /** Lifetime backpressure observations, unaffected by per-queue eviction. */
  static getBackpressureTotal(): number {
    return backpressureCounter.total;
  }

  /** Reset backpressure counters (useful in tests). */
  static resetBackpressureCounters(): void {
    backpressureCounter.reset();
  }

  /** Success means accepted. A failed/uncertain response can still redeliver. */
  async publish(
    queueName: string,
    envelope: EventEnvelope,
    queueOptions?: EnsureQueueOptions,
    options: DurablePublishOptions = {},
  ): Promise<void> {
    if (!this.connected)
      throw new Error(
        `[durable-transport] not connected — cannot publish to queue "${queueName}". Call connect() first.`,
      );
    this.inFlightPublishes++;
    this.peakInFlightPublishes = Math.max(
      this.peakInFlightPublishes,
      this.inFlightPublishes,
    );
    try {
      const policy = queueOptions ?? this.queuePolicies.get(queueName);
      await this.ensureQueue(queueName, policy, options);
      if (policy?.fifo && !options.groupId)
        throw new Error(
          'FIFO publish requires a groupId or declared partitionKey',
        );
      const sendOptions: SendOptions = {
        ...options,
        eventName: envelope.eventName,
        ...(policy?.fifo
          ? { deduplicationId: options.deduplicationId ?? envelope.metadata.id }
          : {}),
      };
      for (let attempt = 1; ; attempt++) {
        try {
          await this.client.send(
            queueName,
            JSON.stringify(envelope),
            sendOptions,
          );
          this.incrementMetric(queueName, 'sent');
          return;
        } catch (error) {
          const failure =
            error instanceof MessageQueueError ? error : undefined;
          let delay = computeBackoffDelay(attempt, {
            initialDelayMs: this.retryBaseMs,
            maxDelayMs: 30000,
          });
          if (failure?.status === 429) {
            const count = this.recordBackpressure(queueName);
            delay = Math.min(
              BACKPRESSURE_MAX_WAIT_MS,
              failure.retryAfterMs ?? delay,
            );
            const suppressed = this.backpressureWarnings.attempt(queueName);
            if (suppressed !== null)
              this.log.warn(
                `[durable-transport] mq_backpressure_observed_total{queue="${queueName}"} ${count} — retry-after ${delay}ms` +
                  LogThrottle.suffix(suppressed),
                {
                  queue: queueName,
                  backpressureCount: count,
                  retryAfterMs: delay,
                  attempt,
                  suppressed,
                },
              );
          }
          if (
            options.signal?.aborted ||
            attempt >= this.retryAttempts ||
            (failure &&
              failure.status > 0 &&
              failure.status < 500 &&
              failure.status !== 429 &&
              failure.status !== 404)
          ) {
            throw new Error(
              `[durable-transport] publish to "${queueName}" failed after ${attempt} attempts: ${errorMessage(error)}`,
              { cause: error },
            );
          }
          if (failure?.status === 404 && failure.code === 'QueueDoesNotExist') {
            this.ensuredQueues.delete(queueName);
            await this.ensureQueue(queueName, policy, options);
          }
          await this.sleep(delay, options.signal);
        }
      }
    } catch (error) {
      this.incrementMetric(queueName, 'failed');
      throw error;
    } finally {
      this.inFlightPublishes--;
    }
  }

  /** Stop intake synchronously; `done` includes bounded draining of accepted handlers. */
  subscribe(
    queueName: string,
    handler: MessageHandler,
    options: DurableSubscribeOptions = {},
  ): DurableSubscription {
    const pollingInterval = integer(
      options.pollingInterval ?? 1000,
      0,
      300000,
      'pollingInterval',
    );
    const batchSize = integer(options.batchSize ?? 10, 1, 10, 'batchSize');
    const visibilityTimeout = integer(
      options.visibilityTimeout ?? 30,
      1,
      43200,
      'visibilityTimeout',
    );
    const intake = new AbortController();
    const leases = new Set<DurableLease>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = this.nextPollerId++;
    const poller: Poller = {
      stopped: false,
      done: Promise.resolve(),
      stop: () => {
        if (poller.stopped) return;
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
    poller.done = this.pollLoop(
      queueName,
      handler,
      { ...options, pollingInterval, batchSize, visibilityTimeout },
      intake.signal,
      leases,
    ).finally(() => {
      clearTimeout(timer);
      for (const lease of leases) lease.abandon();
      this.activePollers.delete(id);
    });
    const cancel = Object.assign(() => poller.stop(), { done: poller.done });
    return cancel;
  }

  /**
   * Fetch a queue's attributes from message-queue. Never throws — returns
   * `null` on any non-2xx or network error, so `null` does not distinguish
   * "no such queue" from "message-queue is down".
   */
  async getQueueAttributes(
    queueName: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.client.attributes(queueName);
    } catch {
      return null;
    }
  }

  /**
   * Per-queue sent/received/failed/in-flight counters. Process-local and
   * reset on restart; not a substitute for message-queue's own metrics.
   */
  getMetrics(
    queueName?: string,
  ): Map<string, QueueMetrics> | QueueMetrics | undefined {
    if (queueName) return this.queueMetrics.get(queueName);
    return new Map(this.queueMetrics);
  }

  /** Same as `getMetrics()` with no argument, but narrowly typed to the map. */
  getAllMetrics(): Map<string, QueueMetrics> {
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
  getDLQ(): DeadLetteredMessage[] {
    return [...this.deadLetterMessages];
  }

  /** Return and clear the in-memory dead-letter buffer. */
  drainDLQ(): DeadLetteredMessage[] {
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
  onDeadLetter(callback: DeadLetterCallback): () => void {
    this.deadLetterCallbacks.push(callback);
    return () => {
      this.deadLetterCallbacks = this.deadLetterCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /**
   * True once `connect()` has run. Says nothing about whether
   * message-queue is actually reachable — use {@link healthCheck} for that.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Probe `GET {url}/ready` with a 2s timeout. Never throws.
   * `'degraded'` = timed out or non-2xx; `'disconnected'` = not connected
   * or the request errored.
   */
  async healthCheck(): Promise<{
    status: 'connected' | 'degraded' | 'disconnected';
    latencyMs: number;
  }> {
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
    } catch (error) {
      const degraded =
        error instanceof MessageQueueError &&
        (error.status > 0 || error.code === 'Timeout');
      return {
        status: degraded ? 'degraded' : 'disconnected',
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  private async pollLoop(
    queueName: string,
    handler: MessageHandler,
    options: DurableSubscribeOptions & {
      pollingInterval: number;
      batchSize: number;
      visibilityTimeout: number;
    },
    signal: AbortSignal,
    leases: Set<DurableLease>,
  ): Promise<void> {
    let failures = 0;
    const policy = options.queueOptions ?? this.queuePolicies.get(queueName);
    while (!signal.aborted) {
      try {
        if (options.isPaused?.()) {
          await this.sleep(options.pollingInterval, signal);
          continue;
        }
        await this.ensureQueue(queueName, policy, { signal });
        const started = performance.now();
        const messages = await this.client.receive(queueName, {
          max: options.batchSize,
          visibilityTimeoutSeconds: options.visibilityTimeout,
          waitSeconds: 0,
          signal,
        });
        failures = 0;
        // Renew every acquired receipt, including queued members of a slow batch.
        const batch = messages.map((message) => {
          const lease = new DurableLease(
            this.client,
            queueName,
            message,
            options.visibilityTimeout * 1000,
            started,
            this.acknowledgementTimeoutMs,
          );
          leases.add(lease);
          this.incrementMetric(queueName, 'inFlight');
          return { message, lease };
        });
        try {
          for (const { message, lease } of batch) {
            if (signal.aborted || options.isPaused?.()) break;
            let processed = false;
            try {
              await lease.run(async () => {
                await handler(
                  JSON.parse(message.body) as EventEnvelope,
                  lease.context,
                );
              });
              processed = true;
              this.messageAttempts.delete(message.message_id);
              await lease.acknowledge();
              this.incrementMetric(queueName, 'received');
            } catch (error) {
              if (!processed && lease.active)
                this.recordHandlerFailure(queueName, message, error);
              else {
                const suppressed = this.pollWarnings.attempt(
                  `ack:${queueName}`,
                );
                if (suppressed !== null)
                  this.log.warn(
                    `[durable-transport] delivery ownership or acknowledgement failed for "${queueName}"; message may be redelivered`,
                    {
                      queue: queueName,
                      messageId: message.message_id,
                      error: errorMessage(error),
                      suppressed,
                    },
                  );
              }
              this.incrementMetric(queueName, 'failed');
            } finally {
              lease.abandon();
              leases.delete(lease);
              this.decrementInFlight(queueName);
            }
          }
        } finally {
          for (const { lease } of batch)
            if (leases.delete(lease)) {
              lease.abandon();
              this.decrementInFlight(queueName);
            }
        }
        if (!messages.length) await this.sleep(options.pollingInterval, signal);
      } catch (error) {
        if (signal.aborted) return;
        if (
          error instanceof MessageQueueError &&
          error.status === 404 &&
          error.code === 'QueueDoesNotExist'
        ) {
          this.ensuredQueues.delete(queueName);
          this.queueVanishedCount++;
        }
        this.pollFailures++;
        const suppressed = this.pollWarnings.attempt(`poll:${queueName}`);
        if (suppressed !== null)
          this.log.error(
            `[durable-transport] poll failed for "${queueName}"` +
              LogThrottle.suffix(suppressed),
            {
              queue: queueName,
              error: errorMessage(error),
              pollFailures: this.pollFailures,
              suppressed,
            },
          );
        await this.sleep(
          computeBackoffDelay(++failures, {
            initialDelayMs: options.pollingInterval,
            maxDelayMs: 30000,
          }),
          signal,
        );
      }
    }
  }

  private recordHandlerFailure(
    queueName: string,
    msg: QueueMessage,
    err: unknown,
  ): void {
    this.handlerFailures++;
    const attemptCount = (this.messageAttempts.get(msg.message_id) ?? 0) + 1;
    // Bounded: message ids are chosen by the queue, and an entry is
    // only removed on success or dead-letter. A message that fails
    // once and is never redelivered would otherwise leak its counter.
    // Eviction only means the message gets a fresh attempt budget.
    if (
      rememberBounded(
        this.messageAttempts,
        msg.message_id,
        attemptCount,
        MAX_TRACKED_MESSAGE_ATTEMPTS,
      ) !== undefined
    ) {
      this.evictedMessageAttempts++;
    }

    if (attemptCount >= this.maxProcessingAttempts) {
      // Dead-letter this message
      let envelope: EventEnvelope | undefined;
      try {
        envelope = JSON.parse(msg.body) as EventEnvelope;
      } catch {
        /* use undefined */
      }
      if (this.deadLetterMessages.length >= this.dlqCapacity) {
        this.deadLetterMessages.splice(
          0,
          this.deadLetterMessages.length - this.dlqCapacity + 1,
        );
      }
      const dlqMessage: DeadLetteredMessage = {
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
        error: (err as Error).message,
        attempts: attemptCount,
        deadLetteredAt: new Date().toISOString(),
      };
      this.deadLetterMessages.push(dlqMessage);
      for (const cb of this.deadLetterCallbacks) {
        try {
          cb(dlqMessage);
        } catch {
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
        this.log.error(
          `[durable-transport] message ${msg.message_id} retained at source after ${attemptCount} failed attempts in "${queueName}" ` +
            `(${this.deadLetteredTotal} poison observations this process)` +
            LogThrottle.suffix(dlSuppressed),
          {
            queue: queueName,
            messageId: msg.message_id,
            eventName: envelope?.eventName,
            attempt: attemptCount,
            error: errorMessage(err),
            deadLetteredTotal: this.deadLetteredTotal,
            suppressed: dlSuppressed,
          },
        );
      }
    } else {
      const hSuppressed = this.handlerWarnings.attempt(`handler:${queueName}`);
      if (hSuppressed !== null) {
        this.log.warn(
          `[durable-transport] handler error for "${queueName}" (attempt ${attemptCount}/${this.maxProcessingAttempts}) ` +
            `(${this.handlerFailures} handler failures this process)` +
            LogThrottle.suffix(hSuppressed) +
            ':',
          {
            queue: queueName,
            messageId: msg.message_id,
            attempt: attemptCount,
            maxAttempts: this.maxProcessingAttempts,
            error: errorMessage(err),
            handlerFailures: this.handlerFailures,
            suppressed: hSuppressed,
          },
          (err as Error).message,
        );
      }
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

  private incrementMetric(queueName: string, field: keyof QueueMetrics): void {
    let metrics = this.queueMetrics.get(queueName);
    if (!metrics) {
      metrics = { sent: 0, received: 0, failed: 0, inFlight: 0 };
      // Bounded, because `publish()` is public and its queue name is
      // derived from a caller-supplied event name.
      if (
        rememberBounded(
          this.queueMetrics,
          queueName,
          metrics,
          MAX_TRACKED_QUEUES,
        ) !== undefined
      ) {
        this.evictedQueueMetrics++;
      }
    }
    metrics[field]++;
  }

  private decrementInFlight(queueName: string): void {
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
  static eventNameToQueueName(eventName: string, fifo = false): string {
    const name = eventName.replace(/[:.]/g, '-').replace(/--+/g, '-');
    return fifo ? `${name}.fifo` : name;
  }
}
