import { RetryManager } from 'distributed-core/dist/transport/RetryManager';
import type { EventEnvelope } from '../types/index';

export interface DurableTransportConfig {
  url: string;
  retryAttempts?: number;
  retryBaseMs?: number;
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

export class DurableTransport {
  private readonly url: string;
  private readonly retryAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryManager: RetryManager;
  private connected = false;
  private activePollers = new Map<string, AbortController>();
  private queueMetrics = new Map<string, QueueMetrics>();
  private ensuredQueues = new Set<string>();

  constructor(config: DurableTransportConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 100;
    this.retryManager = new RetryManager({
      maxRetries: this.retryAttempts - 1, // RetryManager does initial attempt + retries
      baseDelay: this.retryBaseMs,
      backoffFactor: 2,
      jitter: false,
      enableLogging: false,
      name: 'durable-transport',
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

  isConnected(): boolean {
    return this.connected;
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
        const res = await fetch(
          `${this.url}/queues/${encodeURIComponent(queueName)}/messages?` +
          `max_messages=${batchSize}&visibility_timeout=${visibilityTimeout}`,
          { signal },
        );

        if (!res.ok) {
          await this.sleep(pollingInterval, signal);
          continue;
        }

        const data = await res.json() as { messages?: Array<{ message_id: string; body: string; receipt_handle: string }> };
        const messages = data.messages ?? [];

        for (const msg of messages) {
          this.incrementMetric(queueName, 'inFlight');

          try {
            const envelope = JSON.parse(msg.body) as EventEnvelope;
            await handler(envelope);

            // Delete on success
            await fetch(
              `${this.url}/queues/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(msg.receipt_handle)}`,
              { method: 'DELETE' },
            );

            this.incrementMetric(queueName, 'received');
            this.decrementInFlight(queueName);
          } catch (err) {
            console.error(`[durable-transport] handler error for "${queueName}":`, (err as Error).message);
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
