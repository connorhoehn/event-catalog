import { RetryManager } from 'distributed-core/transport';
import type { EventEnvelope } from '../types/index';
import { BoundedCounter, LogThrottle, rememberBounded } from '../utils/bounded';
import { LogWriter, errorMessage, type CatalogLogger, type LogFields } from '../utils/logger';

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
 * Parse an RFC 7231 Retry-After header value.
 * Returns milliseconds to wait, or `undefined` if unparseable.
 *
 *   - Integer seconds: "30" → 30_000
 *   - HTTP-date: "Wed, 21 Oct 2015 07:28:00 GMT" → delta from Date.now()
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
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
const backpressureCounter = new BoundedCounter(MAX_TRACKED_QUEUES);

export interface DurableTransportConfig {
  /**
   * Base URL of the `message-queue` service (no trailing slash required).
   * Usually sourced from the `MESSAGE_QUEUE_URL` env var by the owning
   * service; the platform default is `http://localhost:3004`.
   */
  url: string;
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
  /** Max processing attempts before a message is dead-lettered. Default: 3 */
  maxProcessingAttempts?: number;
  /** Maximum number of dead-lettered messages to retain in memory. Default: 10000 */
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
 *     moves the message to the in-memory DLQ ({@link getDLQ}) and deletes
 *     it from the source queue.
 */
export class DurableTransport {
  private readonly url: string;
  /** message-queue's canonical versioned queue surface (Roadmap 4.1). */
  private readonly queuesBase: string;
  private readonly retryAttempts: number;
  private readonly retryBaseMs: number;
  /** Per-attempt ceiling on a publish POST. See the constructor note. */
  private readonly publishTimeoutMs: number;
  private readonly maxProcessingAttempts: number;
  private readonly dlqCapacity: number;
  private readonly pollRetryManager: RetryManager;
  private connected = false;
  /**
   * Keyed by a monotonic id, not by queue name: two `subscribe()` calls on
   * the same queue used to overwrite each other's AbortController, which
   * orphaned the first poll loop for the life of the process and made
   * `disconnect()` unable to stop it.
   */
  private activePollers = new Map<number, AbortController>();
  private nextPollerId = 1;
  private queueMetrics = new Map<string, QueueMetrics>();
  private evictedQueueMetrics = 0;
  private ensuredQueues = new Set<string>();
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
  private pollFailures = 0;
  private deadLetteredTotal = 0;
  private readonly log: LogWriter;

  constructor(config: DurableTransportConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.log = new LogWriter(config.logger);
    this.queuesBase = `${this.url}/api/v1/queues`;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 100;
    // Without this, a message-queue that accepts the socket and never
    // answers leaves the publish promise pending forever — the caller
    // never resolves, never rejects, and nothing is metered. healthCheck
    // already bounded itself; publish did not.
    this.publishTimeoutMs = config.publishTimeoutMs ?? 10_000;
    this.maxProcessingAttempts = config.maxProcessingAttempts ?? 3;
    this.dlqCapacity = config.dlqCapacity ?? 10_000;
    // keyIntervalMs: a queue that is still failing an hour later deserves a
    // fresh line; what it must not do is emit one per publish.
    this.backpressureWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
    this.ensureQueueWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
    this.pollWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
    this.handlerWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
    this.deadLetterWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
    this.pollRetryManager = new RetryManager({
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
  async connect(): Promise<void> {
    if (this.connected) return;

    // Verify message-queue is reachable
    try {
      const res = await fetch(`${this.url}/health`);
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      this.log.warn(
        `[durable-transport] message-queue not reachable at ${this.url}/health `
        + `(check MESSAGE_QUEUE_URL): ${(err as Error).message}. Continuing in degraded mode — `
        + `durable publishes will retry and then throw until it recovers.`,
        { url: `${this.url}/health`, error: errorMessage(err) },
      );
    }

    this.connected = true;
  }

  /**
   * Abort every active poll loop and mark the transport disconnected.
   * Never throws. In-memory DLQ contents survive; in-flight messages are
   * left for the queue's visibility timeout to redeliver.
   */
  async disconnect(): Promise<void> {
    for (const [, controller] of this.activePollers) {
      controller.abort();
    }
    this.activePollers.clear();
    this.connected = false;
  }

  /** Poll loops still running. Should be 0 after `disconnect()`. */
  getActivePollerCount(): number {
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
  getInFlightPublishCount(): { current: number; peak: number } {
    return { current: this.inFlightPublishes, peak: this.peakInFlightPublishes };
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
      deadLetteredTotal: this.deadLetteredTotal,
      suppressedWarnings:
        this.backpressureWarnings.suppressedTotal
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
  async ensureQueue(queueName: string, options?: EnsureQueueOptions): Promise<void> {
    if (this.ensuredQueues.has(queueName)) return;

    // Step 1 — if dlqAfterAttempts is declared, ensure the paired DLQ
    // exists first. Auto-name is "{queueName}-dlq" unless the caller
    // overrides via options.dlqQueueName.
    let dlqArn: string | undefined;
    if (options?.dlqAfterAttempts && options.dlqAfterAttempts > 0) {
      const dlqName = options.dlqQueueName ?? `${queueName}-dlq`;
      const dlqOk = await this.putQueue(dlqName, {});
      if (dlqOk) {
        dlqArn = `arn:message-queue:queue:${dlqName}`;
      } else {
        this.warnEnsureQueue(
          `dlq:${dlqName}`,
          `[durable-transport] DLQ ensure for "${dlqName}" failed; main queue "${queueName}" will be created WITHOUT redrive_policy`,
          { queue: queueName, dlqQueue: dlqName },
        );
      }
    }

    // Step 2 — build the QueueConfiguration body from declared options.
    const configuration = this.buildQueueConfig(options, dlqArn);

    const ok = await this.putQueue(queueName, configuration);
    // Bounded: a caller publishing to an unbounded queue-name space would
    // otherwise grow this Set forever. Eviction only costs a redundant
    // (idempotent) PUT the next time that queue is published to.
    if (ok) this.rememberEnsuredQueue(queueName);
  }

  private rememberEnsuredQueue(queueName: string): void {
    if (this.ensuredQueues.has(queueName)) return;
    if (this.ensuredQueues.size >= MAX_TRACKED_QUEUES) {
      const oldest = this.ensuredQueues.values().next();
      if (!oldest.done) this.ensuredQueues.delete(oldest.value);
    }
    this.ensuredQueues.add(queueName);
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
   * Map an event-catalog declaration's queue-config fields to
   * message-queue's snake_case QueueConfiguration shape.
   */
  private buildQueueConfig(
    options: EnsureQueueOptions | undefined,
    dlqArn: string | undefined,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
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
  private async putQueue(
    queueName: string,
    configuration: Record<string, unknown>,
  ): Promise<boolean> {
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
        const body = await res.json().catch(() => ({})) as { conflicts?: unknown };
        // 409 still counts as ensured, so this fires once per queue — but
        // route it through the throttle anyway in case the queue-name space
        // is caller-controlled.
        const suppressed = this.ensureQueueWarnings.attempt(`conflict:${queueName}`);
        if (suppressed !== null) {
          const conflicts = JSON.stringify(body.conflicts ?? body);
          this.log.warn(
            `[durable-transport] queue "${queueName}" exists with differing config — accepting drift:`
            + LogThrottle.suffix(suppressed),
            { queue: queueName, status: res.status, conflicts, suppressed },
            conflicts,
          );
        }
        // Drift is not a fatal error; the queue exists and we can publish.
        return true;
      }
      const text = await res.text().catch(() => 'unknown');
      this.warnEnsureQueue(
        `status:${queueName}`,
        `[durable-transport] ensureQueue "${queueName}" failed: ${res.status} ${text}`,
        { queue: queueName, status: res.status, body: text },
      );
      return false;
    } catch (err) {
      this.warnEnsureQueue(
        `error:${queueName}`,
        `[durable-transport] ensureQueue "${queueName}" error:`,
        { queue: queueName, error: errorMessage(err) },
        (err as Error).message,
      );
      return false;
    }
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
  static getBackpressureCount(queueName?: string): number | Map<string, number> {
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
  async publish(
    queueName: string,
    envelope: EventEnvelope,
    queueOptions?: EnsureQueueOptions,
  ): Promise<void> {
    if (!this.connected) {
      throw new Error(
        `[durable-transport] not connected — cannot publish to queue "${queueName}". `
        + 'Call connect() (or EventCatalog.connect()) and await it before publishing.',
      );
    }

    this.inFlightPublishes++;
    if (this.inFlightPublishes > this.peakInFlightPublishes) {
      this.peakInFlightPublishes = this.inFlightPublishes;
    }
    try {
      await this.publishInner(queueName, envelope, queueOptions);
    } finally {
      this.inFlightPublishes--;
    }
  }

  private async publishInner(
    queueName: string,
    envelope: EventEnvelope,
    queueOptions?: EnsureQueueOptions,
  ): Promise<void> {
    await this.ensureQueue(queueName, queueOptions);

    const body = JSON.stringify({
      message_body: JSON.stringify(envelope),
    });

    const maxAttempts = this.retryAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.publishTimeoutMs);
      try {
        res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        // An abort lands here too, and is treated as a network error: a hung
        // queue is retried with back-off like any other transport failure.
        // Network error — hand off to retry logic
        if (attempt >= maxAttempts) {
          this.incrementMetric(queueName, 'failed');
          throw new Error(`[durable-transport] publish to "${queueName}" failed after ${maxAttempts} attempts: ${(err as Error).message}`);
        }
        // Exponential back-off for network errors (mirrors RetryManager defaults)
        const backoff = Math.min(this.retryBaseMs * Math.pow(2, attempt - 1), 30_000);
        await this.sleepMs(backoff);
        continue;
      } finally {
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
            this.log.warn(
              `[durable-transport] backpressure on "${queueName}": Retry-After ${waitMs}ms exceeds cap ${BACKPRESSURE_MAX_WAIT_MS}ms; clamping`
              + LogThrottle.suffix(clampSuppressed),
              {
                queue: queueName,
                retryAfterMs: waitMs,
                capMs: BACKPRESSURE_MAX_WAIT_MS,
                attempt,
                suppressed: clampSuppressed,
              },
            );
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
          this.log.warn(
            `[durable-transport] mq_backpressure_observed_total{queue="${queueName}"} ${count} — ` +
            `retry-after ${Math.round(waitMs / 1000)}s jittered=${jittered}ms attempt=${attempt}/${maxAttempts}`
            + LogThrottle.suffix(suppressed),
            {
              queue: queueName,
              backpressureCount: count,
              status: res.status,
              retryAfterMs: waitMs,
              jitteredMs: jittered,
              attempt,
              maxAttempts,
              suppressed,
            },
          );
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
   * rejections for the same message it is dead-lettered (see
   * {@link getDLQ} / {@link onDeadLetter}) and deleted from the queue.
   * Attempt counts are process-local, so a restart resets them.
   *
   * @returns a cancel function that aborts the poll loop. It does not wait
   *   for an in-flight handler to finish.
   */
  subscribe(
    queueName: string,
    handler: MessageHandler,
    options: DurableSubscribeOptions = {},
  ): () => void {
    const {
      pollingInterval = 1000,
      batchSize = 10,
      visibilityTimeout = 30,
    } = options;

    const controller = new AbortController();
    const pollerId = this.nextPollerId++;
    this.activePollers.set(pollerId, controller);

    // `.catch` matters: ensureQueue never rejects today, but an unhandled
    // rejection here would take the process down instead of leaving the
    // poller unstarted.
    void this.ensureQueue(queueName).then(() => {
      if (controller.signal.aborted) return;
      void this.pollLoop(queueName, handler, {
        pollingInterval,
        batchSize,
        visibilityTimeout,
        signal: controller.signal,
      });
    }).catch(() => { /* ensureQueue already logged */ });

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
  async getQueueAttributes(queueName: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/attributes`);
      if (!res.ok) return null;
      return await res.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Per-queue sent/received/failed/in-flight counters. Process-local and
   * reset on restart; not a substitute for message-queue's own metrics.
   */
  getMetrics(queueName?: string): Map<string, QueueMetrics> | QueueMetrics | undefined {
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
   * oldest-first when full, and is lost on restart. Use `onDeadLetter` to
   * forward records somewhere persistent if you need them to survive.
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
   * dead-lettered. Callback exceptions are swallowed. Returns an
   * unregister function.
   */
  onDeadLetter(callback: DeadLetterCallback): () => void {
    this.deadLetterCallbacks.push(callback);
    return () => {
      this.deadLetterCallbacks = this.deadLetterCallbacks.filter(cb => cb !== callback);
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
   * Probe `GET {url}/health` with a 2s timeout. Never throws.
   * `'degraded'` = timed out or non-2xx; `'disconnected'` = not connected
   * or the request errored.
   */
  async healthCheck(): Promise<{ status: 'connected' | 'degraded' | 'disconnected'; latencyMs: number }> {
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
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      if ((err as Error).name === 'AbortError') {
        return { status: 'degraded', latencyMs };
      }
      return { status: 'disconnected', latencyMs };
    }
  }

  private async pollLoop(
    queueName: string,
    handler: MessageHandler,
    opts: {
      pollingInterval: number;
      batchSize: number;
      visibilityTimeout: number;
      signal: AbortSignal;
    },
  ): Promise<void> {
    const { pollingInterval, batchSize, visibilityTimeout, signal } = opts;

    while (!signal.aborted) {
      try {
        // Wrap the poll fetch in RetryManager for backoff on transient failures
        let data: { messages?: Array<{ message_id: string; body: string; receipt_handle: string }> };
        try {
          data = await this.pollRetryManager.execute(async () => {
            const res = await fetch(
              `${this.queuesBase}/${encodeURIComponent(queueName)}/messages?` +
              `max_messages=${batchSize}&visibility_timeout=${visibilityTimeout}`,
              { signal },
            );

            if (!res.ok) {
              throw new Error(`message-queue returned ${res.status}`);
            }

            return await res.json() as { messages?: Array<{ message_id: string; body: string; receipt_handle: string }> };
          });
        } catch (pollErr) {
          if (signal.aborted) return;
          // A down message-queue fails this every `pollingInterval` (1s by
          // default) for as long as the outage lasts — ~86k lines a day
          // per queue if left unthrottled.
          this.pollFailures++;
          const suppressed = this.pollWarnings.attempt(`poll:${queueName}`);
          if (suppressed !== null) {
            this.log.error(
              `[durable-transport] poll failed for "${queueName}" after retries `
              + `(${this.pollFailures} failures this process)`
              + LogThrottle.suffix(suppressed) + ':',
              {
                queue: queueName,
                error: errorMessage(pollErr),
                pollFailures: this.pollFailures,
                suppressed,
              },
              (pollErr as Error).message,
            );
          }
          await this.sleep(pollingInterval, signal);
          continue;
        }

        const messages = data.messages ?? [];

        for (const msg of messages) {
          this.incrementMetric(queueName, 'inFlight');

          try {
            const envelope = JSON.parse(msg.body) as EventEnvelope;
            await handler(envelope);

            // Delete on success — processing succeeded
            await fetch(
              `${this.queuesBase}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`,
              { method: 'DELETE' },
            );

            this.incrementMetric(queueName, 'received');
            this.decrementInFlight(queueName);
            // Clear attempt counter on success
            this.messageAttempts.delete(msg.message_id);
          } catch (err) {
            this.handlerFailures++;
            const attemptCount = (this.messageAttempts.get(msg.message_id) ?? 0) + 1;
            // Bounded: message ids are chosen by the queue, and an entry is
            // only removed on success or dead-letter. A message that fails
            // once and is never redelivered would otherwise leak its counter.
            // Eviction only means the message gets a fresh attempt budget.
            if (rememberBounded(
              this.messageAttempts,
              msg.message_id,
              attemptCount,
              MAX_TRACKED_MESSAGE_ATTEMPTS,
            ) !== undefined) {
              this.evictedMessageAttempts++;
            }

            if (attemptCount >= this.maxProcessingAttempts) {
              // Dead-letter this message
              let envelope: EventEnvelope | undefined;
              try { envelope = JSON.parse(msg.body) as EventEnvelope; } catch { /* use undefined */ }
              if (this.deadLetterMessages.length >= this.dlqCapacity) {
                this.deadLetterMessages.splice(0, this.deadLetterMessages.length - this.dlqCapacity + 1);
              }
              const dlqMessage: DeadLetteredMessage = {
                messageId: msg.message_id,
                queueName,
                envelope: envelope ?? { eventName: 'unknown', payload: msg.body, metadata: { id: msg.message_id, producer: 'unknown', timestamp: Date.now() } },
                error: (err as Error).message,
                attempts: attemptCount,
                deadLetteredAt: new Date().toISOString(),
              };
              this.deadLetterMessages.push(dlqMessage);
              for (const cb of this.deadLetterCallbacks) {
                try { cb(dlqMessage); } catch { /* ignore callback errors */ }
              }
              // Delete from source queue so it's not redelivered
              await fetch(
                `${this.queuesBase}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`,
                { method: 'DELETE' },
              ).catch(() => { /* best-effort cleanup */ });
              this.messageAttempts.delete(msg.message_id);
              this.deadLetteredTotal++;
              // Keyed by queue, not message id: a poison batch dead-letters
              // at the drain rate, and the useful signal is "this queue is
              // dead-lettering", not each id.
              const dlSuppressed = this.deadLetterWarnings.attempt(`dlq:${queueName}`);
              if (dlSuppressed !== null) {
                this.log.error(
                  `[durable-transport] message ${msg.message_id} dead-lettered after ${attemptCount} attempts in "${queueName}" `
                  + `(${this.deadLetteredTotal} dead-lettered this process)`
                  + LogThrottle.suffix(dlSuppressed),
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
                  `[durable-transport] handler error for "${queueName}" (attempt ${attemptCount}/${this.maxProcessingAttempts}) `
                  + `(${this.handlerFailures} handler failures this process)`
                  + LogThrottle.suffix(hSuppressed) + ':',
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

            this.decrementInFlight(queueName);
            this.incrementMetric(queueName, 'failed');
          }
        }

        if (messages.length === 0) {
          await this.sleep(pollingInterval, signal);
        }
      } catch (err) {
        if (signal.aborted) return;
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
          this.log.error(
            `[durable-transport] poll error for "${queueName}"` + LogThrottle.suffix(suppressed) + ':',
            {
              queue: queueName,
              error: errorMessage(err),
              pollFailures: this.pollFailures,
              suppressed,
            },
            (err as Error).message,
          );
        }
        await this.sleep(pollingInterval, signal);
      }
    }
  }

  /** Unconditional sleep without an abort signal (used in publish retry loop). */
  private sleepMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(); return; }
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

  private incrementMetric(queueName: string, field: keyof QueueMetrics): void {
    let metrics = this.queueMetrics.get(queueName);
    if (!metrics) {
      metrics = { sent: 0, received: 0, failed: 0, inFlight: 0 };
      // Bounded, because `publish()` is public and its queue name is
      // derived from a caller-supplied event name.
      if (rememberBounded(this.queueMetrics, queueName, metrics, MAX_TRACKED_QUEUES) !== undefined) {
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
  static eventNameToQueueName(eventName: string): string {
    return eventName.replace(/[:.]/g, '-').replace(/--+/g, '-');
  }
}
