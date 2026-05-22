import { RetryManager } from 'distributed-core/transport';
import type { EventEnvelope } from '../types/index';

/** Max wait enforced on a server-driven Retry-After (5 minutes). */
const BACKPRESSURE_MAX_WAIT_MS = 300_000;

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

/** Simple in-memory counter for backpressure observations. */
const backpressureCounter: Map<string, number> = new Map();

export interface DurableTransportConfig {
  url: string;
  retryAttempts?: number;
  retryBaseMs?: number;
  /** Max processing attempts before a message is dead-lettered. Default: 3 */
  maxProcessingAttempts?: number;
  /** Maximum number of dead-lettered messages to retain in memory. Default: 10000 */
  dlqCapacity?: number;
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

export class DurableTransport {
  private readonly url: string;
  /** message-queue's canonical versioned queue surface (Roadmap 4.1). */
  private readonly queuesBase: string;
  private readonly retryAttempts: number;
  private readonly retryBaseMs: number;
  private readonly maxProcessingAttempts: number;
  private readonly dlqCapacity: number;
  private readonly pollRetryManager: RetryManager;
  private connected = false;
  private activePollers = new Map<string, AbortController>();
  private queueMetrics = new Map<string, QueueMetrics>();
  private ensuredQueues = new Set<string>();
  private readonly deadLetterMessages: DeadLetteredMessage[] = [];
  private readonly messageAttempts = new Map<string, number>();
  private deadLetterCallbacks: DeadLetterCallback[] = [];

  constructor(config: DurableTransportConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.queuesBase = `${this.url}/api/v1/queues`;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 100;
    this.maxProcessingAttempts = config.maxProcessingAttempts ?? 3;
    this.dlqCapacity = config.dlqCapacity ?? 10_000;
    this.pollRetryManager = new RetryManager({
      maxRetries: 2, // 3 total attempts (1 initial + 2 retries)
      baseDelay: 1000,
      backoffFactor: 2,
      jitter: false,
      enableLogging: false,
      name: 'durable-poll',
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Verify message-queue is reachable
    try {
      const res = await fetch(`${this.url}/health`);
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      console.warn(`[durable-transport] message-queue not reachable at ${this.url}:`, (err as Error).message);
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
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
        console.warn(
          `[durable-transport] DLQ ensure for "${dlqName}" failed; main queue "${queueName}" will be created WITHOUT redrive_policy`,
        );
      }
    }

    // Step 2 — build the QueueConfiguration body from declared options.
    const configuration = this.buildQueueConfig(options, dlqArn);

    const ok = await this.putQueue(queueName, configuration);
    if (ok) this.ensuredQueues.add(queueName);
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
        console.warn(
          `[durable-transport] queue "${queueName}" exists with differing config — accepting drift:`,
          JSON.stringify(body.conflicts ?? body),
        );
        // Drift is not a fatal error; the queue exists and we can publish.
        return true;
      }
      const text = await res.text().catch(() => 'unknown');
      console.warn(`[durable-transport] ensureQueue "${queueName}" failed: ${res.status} ${text}`);
      return false;
    } catch (err) {
      console.warn(`[durable-transport] ensureQueue "${queueName}" error:`, (err as Error).message);
      return false;
    }
  }

  /**
   * Increment and return the module-level backpressure counter for a queue.
   * Exposed via `DurableTransport.getBackpressureCount()` for tests/metrics.
   */
  private recordBackpressure(queueName: string): number {
    const prev = backpressureCounter.get(queueName) ?? 0;
    backpressureCounter.set(queueName, prev + 1);
    return prev + 1;
  }

  /** Return total backpressure events observed for a queue (or all queues). */
  static getBackpressureCount(queueName?: string): number | Map<string, number> {
    if (queueName !== undefined) {
      return backpressureCounter.get(queueName) ?? 0;
    }
    return new Map(backpressureCounter);
  }

  /** Reset backpressure counters (useful in tests). */
  static resetBackpressureCounters(): void {
    backpressureCounter.clear();
  }

  async publish(
    queueName: string,
    envelope: EventEnvelope,
    queueOptions?: EnsureQueueOptions,
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('[durable-transport] not connected');
    }

    await this.ensureQueue(queueName, queueOptions);

    const body = JSON.stringify({
      message_body: JSON.stringify(envelope),
    });

    const maxAttempts = this.retryAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      } catch (err) {
        // Network error — hand off to retry logic
        if (attempt >= maxAttempts) {
          this.incrementMetric(queueName, 'failed');
          throw new Error(`[durable-transport] publish to "${queueName}" failed after ${maxAttempts} attempts: ${(err as Error).message}`);
        }
        // Exponential back-off for network errors (mirrors RetryManager defaults)
        const backoff = Math.min(this.retryBaseMs * Math.pow(2, attempt - 1), 30_000);
        await this.sleepMs(backoff);
        continue;
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
          console.warn(
            `[durable-transport] backpressure on "${queueName}": Retry-After ${waitMs}ms exceeds cap ${BACKPRESSURE_MAX_WAIT_MS}ms; clamping`,
          );
          waitMs = BACKPRESSURE_MAX_WAIT_MS;
        }
        // Apply jitter: multiply by random in [0.5, 1.0)
        const jittered = Math.round(waitMs * (0.5 + Math.random() * 0.5));
        console.warn(
          `[durable-transport] mq_backpressure_observed_total{queue="${queueName}"} ${count} — ` +
          `retry-after ${Math.round(waitMs / 1000)}s jittered=${jittered}ms attempt=${attempt}/${maxAttempts}`,
        );
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

  async getQueueAttributes(queueName: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${this.queuesBase}/${encodeURIComponent(queueName)}/attributes`);
      if (!res.ok) return null;
      return await res.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  getMetrics(queueName?: string): Map<string, QueueMetrics> | QueueMetrics | undefined {
    if (queueName) return this.queueMetrics.get(queueName);
    return new Map(this.queueMetrics);
  }

  getAllMetrics(): Map<string, QueueMetrics> {
    return new Map(this.queueMetrics);
  }

  getDLQ(): DeadLetteredMessage[] {
    return [...this.deadLetterMessages];
  }

  drainDLQ(): DeadLetteredMessage[] {
    const messages = [...this.deadLetterMessages];
    this.deadLetterMessages.length = 0;
    return messages;
  }

  onDeadLetter(callback: DeadLetterCallback): () => void {
    this.deadLetterCallbacks.push(callback);
    return () => {
      this.deadLetterCallbacks = this.deadLetterCallbacks.filter(cb => cb !== callback);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

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
          console.error(`[durable-transport] poll failed for "${queueName}" after retries:`, (pollErr as Error).message);
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
            const attemptCount = (this.messageAttempts.get(msg.message_id) ?? 0) + 1;
            this.messageAttempts.set(msg.message_id, attemptCount);

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
              console.error(`[durable-transport] message ${msg.message_id} dead-lettered after ${attemptCount} attempts in "${queueName}"`);
            } else {
              console.warn(`[durable-transport] handler error for "${queueName}" (attempt ${attemptCount}/${this.maxProcessingAttempts}):`, (err as Error).message);
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
        console.warn(`[durable-transport] poll error for "${queueName}":`, (err as Error).message);
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
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  private incrementMetric(queueName: string, field: keyof QueueMetrics): void {
    let metrics = this.queueMetrics.get(queueName);
    if (!metrics) {
      metrics = { sent: 0, received: 0, failed: 0, inFlight: 0 };
      this.queueMetrics.set(queueName, metrics);
    }
    metrics[field]++;
  }

  private decrementInFlight(queueName: string): void {
    const metrics = this.queueMetrics.get(queueName);
    if (metrics && metrics.inFlight > 0) {
      metrics.inFlight--;
    }
  }

  static eventNameToQueueName(eventName: string): string {
    return eventName.replace(/[:.]/g, '-').replace(/--+/g, '-');
  }
}
