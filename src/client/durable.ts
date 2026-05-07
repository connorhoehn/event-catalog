import { RetryManager } from 'distributed-core/dist/transport/RetryManager';
import type { EventEnvelope } from '../types/index';

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
  private readonly retryAttempts: number;
  private readonly retryBaseMs: number;
  private readonly maxProcessingAttempts: number;
  private readonly dlqCapacity: number;
  private readonly retryManager: RetryManager;
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
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 100;
    this.maxProcessingAttempts = config.maxProcessingAttempts ?? 3;
    this.dlqCapacity = config.dlqCapacity ?? 10_000;
    this.retryManager = new RetryManager({
      maxRetries: this.retryAttempts - 1, // RetryManager does initial attempt + retries
      baseDelay: this.retryBaseMs,
      backoffFactor: 2,
      jitter: false,
      enableLogging: false,
      name: 'durable-transport',
    });
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

  async ensureQueue(queueName: string): Promise<void> {
    if (this.ensuredQueues.has(queueName)) return;

    try {
      const res = await fetch(`${this.url}/queues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_name: queueName }),
      });

      // 201 = created, 409 = already exists — both fine
      if (res.ok || res.status === 409) {
        this.ensuredQueues.add(queueName);
        return;
      }

      const body = await res.text().catch(() => 'unknown');
      console.warn(`[durable-transport] ensureQueue "${queueName}" failed: ${res.status} ${body}`);
    } catch (err) {
      console.warn(`[durable-transport] ensureQueue "${queueName}" error:`, (err as Error).message);
    }
  }

  async publish(queueName: string, envelope: EventEnvelope): Promise<void> {
    if (!this.connected) {
      throw new Error('[durable-transport] not connected');
    }

    await this.ensureQueue(queueName);

    const body = JSON.stringify({
      message_body: JSON.stringify(envelope),
    });

    try {
      await this.retryManager.execute(async () => {
        const res = await fetch(`${this.url}/queues/${encodeURIComponent(queueName)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (!res.ok) {
          throw new Error(`message-queue returned ${res.status}`);
        }
      });

      this.incrementMetric(queueName, 'sent');
    } catch (err) {
      this.incrementMetric(queueName, 'failed');
      throw new Error(`[durable-transport] publish to "${queueName}" failed after ${this.retryAttempts} attempts: ${(err as Error).message}`);
    }
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
      const res = await fetch(`${this.url}/queues/${encodeURIComponent(queueName)}/attributes`);
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
              `${this.url}/queues/${encodeURIComponent(queueName)}/messages?` +
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
              `${this.url}/queues/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`,
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
                `${this.url}/queues/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`,
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
