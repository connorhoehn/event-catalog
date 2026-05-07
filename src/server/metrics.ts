import { RateTracker, MetricsRegistry, Counter, Gauge } from 'distributed-core';
import type { RedisClientType } from 'redis';
import type { EventStats } from '../types/index.js';

const SNAPSHOT_KEY = 'event-catalog:metrics:snapshot';

interface PersistedEventMetrics {
  publishCount: number;
  errorCount: number;
  lastPublishedAt: string | null;
}

interface EventMetricHandles {
  publishCounter: Counter;
  errorCounter: Counter;
  subscriberGauge: Gauge;
  queueDepthGauge: Gauge;
  messagesInFlightGauge: Gauge;
  oldestMessageAgeGauge: Gauge;
  rateTracker: RateTracker;
  lastPublishedAt: string | null;
}

export class MetricsCollector {
  private events = new Map<string, EventMetricHandles>();
  private readonly registry: MetricsRegistry;
  private readonly rateWindowSeconds: number;

  constructor(rateWindowSeconds = 60) {
    this.rateWindowSeconds = rateWindowSeconds;
    this.registry = new MetricsRegistry('event-catalog', { namespace: 'event_catalog' });
  }

  recordPublish(eventName: string): void {
    const handles = this.getOrCreate(eventName);
    handles.publishCounter.inc();
    handles.lastPublishedAt = new Date().toISOString();
    handles.rateTracker.record();
  }

  recordError(eventName: string): void {
    const handles = this.getOrCreate(eventName);
    handles.errorCounter.inc();
  }

  setSubscriberCount(eventName: string, count: number): void {
    const handles = this.getOrCreate(eventName);
    handles.subscriberGauge.set(count);
  }

  updateDurableStats(
    eventName: string,
    stats: { queueDepth?: number; messagesInFlight?: number; oldestMessageAge?: number },
  ): void {
    const handles = this.getOrCreate(eventName);
    if (stats.queueDepth !== undefined) handles.queueDepthGauge.set(stats.queueDepth);
    if (stats.messagesInFlight !== undefined) handles.messagesInFlightGauge.set(stats.messagesInFlight);
    if (stats.oldestMessageAge !== undefined) handles.oldestMessageAgeGauge.set(stats.oldestMessageAge);
  }

  getStats(eventName: string): EventStats | null {
    const handles = this.events.get(eventName);
    if (!handles) return null;

    const queueDepth = handles.queueDepthGauge.get();
    const messagesInFlight = handles.messagesInFlightGauge.get();
    const oldestMessageAge = handles.oldestMessageAgeGauge.get();

    return {
      publishCount: handles.publishCounter.get(),
      publishRate: handles.rateTracker.rate(),
      lastPublishedAt: handles.lastPublishedAt,
      errorCount: handles.errorCounter.get(),
      subscriberCount: handles.subscriberGauge.get(),
      ...(queueDepth !== 0 ? { queueDepth } : {}),
      ...(messagesInFlight !== 0 ? { messagesInFlight } : {}),
      ...(oldestMessageAge !== 0 ? { oldestMessageAge } : {}),
    };
  }

  snapshot(): Record<string, EventStats> {
    const result: Record<string, EventStats> = {};

    for (const [eventName] of this.events) {
      const stats = this.getStats(eventName);
      if (stats) result[eventName] = stats;
    }

    return result;
  }

  reset(eventName?: string): void {
    if (eventName) {
      this.events.delete(eventName);
    } else {
      this.events.clear();
    }
  }

  async snapshotToRedis(redis: RedisClientType): Promise<void> {
    const data: Record<string, PersistedEventMetrics> = {};
    for (const [eventName, handles] of this.events) {
      data[eventName] = {
        publishCount: handles.publishCounter.get(),
        errorCount: handles.errorCounter.get(),
        lastPublishedAt: handles.lastPublishedAt,
      };
    }
    await redis.set(SNAPSHOT_KEY, JSON.stringify(data));
  }

  async restoreFromRedis(redis: RedisClientType): Promise<void> {
    const raw = await redis.get(SNAPSHOT_KEY);
    if (!raw) return;

    const data = JSON.parse(raw) as Record<string, PersistedEventMetrics>;
    for (const [eventName, persisted] of Object.entries(data)) {
      const handles = this.getOrCreate(eventName);
      handles.publishCounter.reset();
      handles.publishCounter.inc(persisted.publishCount);
      handles.errorCounter.reset();
      handles.errorCounter.inc(persisted.errorCount);
      handles.lastPublishedAt = persisted.lastPublishedAt;
    }
  }

  private getOrCreate(eventName: string): EventMetricHandles {
    let handles = this.events.get(eventName);
    if (!handles) {
      const labels = { event: eventName };
      handles = {
        publishCounter: this.registry.counter('publish_total', labels),
        errorCounter: this.registry.counter('error_total', labels),
        subscriberGauge: this.registry.gauge('subscriber_count', labels),
        queueDepthGauge: this.registry.gauge('queue_depth', labels),
        messagesInFlightGauge: this.registry.gauge('messages_in_flight', labels),
        oldestMessageAgeGauge: this.registry.gauge('oldest_message_age', labels),
        rateTracker: new RateTracker(this.rateWindowSeconds),
        lastPublishedAt: null,
      };
      this.events.set(eventName, handles);
    }
    return handles;
  }
}
