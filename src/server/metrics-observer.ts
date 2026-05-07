import type { Registry } from '../registry/index.js';
import type { SignalTransport } from '../client/signal.js';
import type { DurableTransport } from '../client/durable.js';
import type { MetricsCollector } from './metrics.js';

export class MetricsObserver {
  private readonly registry: Registry;
  private readonly signal: SignalTransport;
  private readonly durable: DurableTransport;
  private readonly metrics: MetricsCollector;
  private readonly signalUnsubscribes = new Map<string, () => Promise<void>>();
  private durablePollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly durablePollIntervalMs: number;

  constructor(deps: {
    registry: Registry;
    signal: SignalTransport;
    durable: DurableTransport;
    metrics: MetricsCollector;
    durablePollIntervalMs?: number;
  }) {
    this.registry = deps.registry;
    this.signal = deps.signal;
    this.durable = deps.durable;
    this.metrics = deps.metrics;
    this.durablePollIntervalMs = deps.durablePollIntervalMs ?? 5000;
  }

  async start(): Promise<void> {
    const entries = this.registry.list();

    for (const entry of entries) {
      await this.observe(entry.name, entry.transport);
    }

    this.durablePollTimer = setInterval(() => {
      this.pollDurableStats();
    }, this.durablePollIntervalMs);
  }

  async observe(eventName: string, transport: 'signal' | 'durable'): Promise<void> {
    if (transport === 'signal') {
      await this.observeSignal(eventName);
    }
  }

  async stop(): Promise<void> {
    if (this.durablePollTimer) {
      clearInterval(this.durablePollTimer);
      this.durablePollTimer = null;
    }

    for (const [, unsub] of this.signalUnsubscribes) {
      await unsub();
    }
    this.signalUnsubscribes.clear();
  }

  private async observeSignal(eventName: string): Promise<void> {
    if (this.signalUnsubscribes.has(eventName)) return;
    if (!this.signal.isConnected()) return;

    try {
      const unsub = await this.signal.subscribe(eventName, (_envelope) => {
        this.metrics.recordPublish(eventName);
      });
      this.signalUnsubscribes.set(eventName, unsub);
      this.metrics.setSubscriberCount(
        eventName,
        (this.registry.get(eventName)?.subscribers.length ?? 0) + 1,
      );
    } catch (err) {
      this.metrics.recordError(eventName);
      console.warn(`[metrics-observer] failed to observe signal channel "${eventName}":`, (err as Error).message);
    }
  }

  private async pollDurableStats(): Promise<void> {
    const durableEvents = this.registry.list({ transport: 'durable' });

    for (const entry of durableEvents) {
      const queueName = DurableTransport.eventNameToQueueName(entry.name);
      const attrs = await this.durable.getQueueAttributes(queueName);

      if (attrs) {
        this.metrics.updateDurableStats(entry.name, {
          queueDepth: typeof attrs['ApproximateNumberOfMessages'] === 'number'
            ? attrs['ApproximateNumberOfMessages'] : undefined,
          messagesInFlight: typeof attrs['ApproximateNumberOfMessagesNotVisible'] === 'number'
            ? attrs['ApproximateNumberOfMessagesNotVisible'] : undefined,
        });
      }

      const transportMetrics = this.durable.getMetrics(queueName) as
        { sent: number; received: number; failed: number; inFlight: number } | undefined;

      if (transportMetrics) {
        for (let i = 0; i < transportMetrics.sent - (this.metrics.getStats(entry.name)?.publishCount ?? 0); i++) {
          this.metrics.recordPublish(entry.name);
        }
        for (let i = 0; i < transportMetrics.failed - (this.metrics.getStats(entry.name)?.errorCount ?? 0); i++) {
          this.metrics.recordError(entry.name);
        }
      }
    }
  }
}
