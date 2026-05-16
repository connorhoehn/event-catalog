import type { Registry } from '../registry/index.js';
import type { SignalTransport } from '../client/signal.js';
import type { DurableTransport } from '../client/durable.js';
import type { MetricsCollector } from './metrics.js';
import { tapEmitter } from './tap-emitter.js';
import type { ProducerAttributionStore } from './producer-attribution.js';

export class MetricsObserver {
  private readonly registry: Registry;
  private readonly signal: SignalTransport;
  private readonly durable: DurableTransport;
  private readonly metrics: MetricsCollector;
  private readonly attribution?: ProducerAttributionStore;
  private readonly signalUnsubscribes = new Map<string, () => Promise<void>>();
  private durablePollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly durablePollIntervalMs: number;

  constructor(deps: {
    registry: Registry;
    signal: SignalTransport;
    durable: DurableTransport;
    metrics: MetricsCollector;
    attribution?: ProducerAttributionStore;
    durablePollIntervalMs?: number;
  }) {
    this.registry = deps.registry;
    this.signal = deps.signal;
    this.durable = deps.durable;
    this.metrics = deps.metrics;
    this.attribution = deps.attribution;
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
      const unsub = await this.signal.subscribe(eventName, (envelope) => {
        this.metrics.recordPublish(eventName);
        // wave26-c — record the actual publisher for attribution tracking.
        const actualProducer = (envelope.metadata as { producer?: string }).producer;
        if (actualProducer && this.attribution) {
          this.attribution.record(eventName, actualProducer);
        }
        // Phase E8 — also surface the observation on the live-flow tap.
        const entry = this.registry.get(eventName);
        if (entry) {
          tapEmitter.publish({
            eventName,
            namespace: entry.namespace,
            producer: actualProducer ?? (Array.isArray(entry.producer) ? entry.producer[0]! : entry.producer),
            transport: 'signal',
            timestamp: new Date().toISOString(),
            channel: typeof entry.channel === 'string' ? entry.channel : eventName,
            envelope,
          });
        }
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
        const seenBefore = this.metrics.getStats(entry.name)?.publishCount ?? 0;
        const newSends = transportMetrics.sent - seenBefore;
        for (let i = 0; i < newSends; i++) {
          this.metrics.recordPublish(entry.name);
          // Phase E8 — durable taps are coarse: one tap event per
          // observed publish delta. No envelope visibility on this
          // path (we only see the queue's sent counter rise).
          tapEmitter.publish({
            eventName: entry.name,
            namespace: entry.namespace,
            producer: Array.isArray(entry.producer) ? entry.producer[0]! : entry.producer,
            transport: 'durable',
            timestamp: new Date().toISOString(),
            queue: queueName,
          });
        }
        for (let i = 0; i < transportMetrics.failed - (this.metrics.getStats(entry.name)?.errorCount ?? 0); i++) {
          this.metrics.recordError(entry.name);
        }
      }
    }
  }
}
