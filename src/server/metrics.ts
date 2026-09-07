import { RateTracker, MetricsRegistry } from 'distributed-core';
import { Counter, Gauge } from 'distributed-core/monitoring';
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
  /** wave26-a — ring buffer: eventName → last N rate snapshots. */
  private readonly rateHistory = new Map<string, number[]>();
  private readonly HISTORY_BUCKETS = 60;

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

  /**
   * wave26-a — snapshot current rate for every tracked event into the
   * ring buffer. Called from the server's periodic health interval so
   * the sparkline data stays fresh without a dedicated timer.
   */
  tickRateHistory(): void {
    for (const [name, handles] of this.events) {
      const buf = this.rateHistory.get(name) ?? [];
      buf.push(handles.rateTracker.rate());
      if (buf.length > this.HISTORY_BUCKETS) buf.shift();
      this.rateHistory.set(name, buf);
    }
  }

  /**
   * wave26-a — return rate history for one event or all events.
   * When `eventName` is provided returns `{ [eventName]: number[] }`.
   * When omitted returns the full `{ [eventName]: number[] }` map.
   */
  getHistory(eventName?: string): Record<string, number[]> {
    // Null-prototype so an event name of `__proto__` becomes an own
    // property instead of hitting Object.prototype's setter — a plain
    // `{}` there re-parents the map and the event disappears from
    // GET /api/metrics/history entirely.
    const out = Object.create(null) as Record<string, number[]>;
    if (eventName) {
      out[eventName] = this.rateHistory.get(eventName) ?? [];
      return out;
    }
    for (const [name, buf] of this.rateHistory) {
      out[name] = buf;
    }
    return out;
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

    let data: Record<string, PersistedEventMetrics>;
    try {
      data = JSON.parse(raw) as Record<string, PersistedEventMetrics>;
    } catch {
      return;
    }
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
