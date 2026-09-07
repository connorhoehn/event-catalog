import { RateTracker, MetricsRegistry } from 'distributed-core';
import { Counter, Gauge } from 'distributed-core/monitoring';
import type { RedisClientType } from 'redis';
import type { EventStats } from '../types/index.js';

const SNAPSHOT_KEY = 'event-catalog:metrics:snapshot';

/**
 * Ceiling on distinct events this collector will track.
 *
 * Each tracked event costs six distributed-core metric handles, a
 * RateTracker and a 60-slot rate-history ring buffer, and every entry is
 * walked on each 15s health tick (`snapshot()` + `tickRateHistory()`).
 * `POST /api/events/bulk` accepts 1000 declarations per request with no
 * ceiling on requests, and the observer tracks whatever the registry
 * holds, so "however many events exist" is not a bound the service
 * controls. 5000 is ~25x the committed registry (194 events); past it
 * new events are refused a handle and counted in `droppedEvents` rather
 * than growing the process without limit.
 */
export const DEFAULT_MAX_TRACKED_EVENTS = 5000;

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
  private readonly maxTrackedEvents: number;
  private droppedEvents = 0;
  private warnedAboutCap = false;

  constructor(rateWindowSeconds = 60, maxTrackedEvents = DEFAULT_MAX_TRACKED_EVENTS) {
    this.rateWindowSeconds = rateWindowSeconds;
    this.maxTrackedEvents = maxTrackedEvents;
    this.registry = new MetricsRegistry('event-catalog', { namespace: 'event_catalog' });
  }

  recordPublish(eventName: string): void {
    const handles = this.getOrCreate(eventName);
    if (!handles) return;
    handles.publishCounter.inc();
    handles.lastPublishedAt = new Date().toISOString();
    handles.rateTracker.record();
  }

  recordError(eventName: string): void {
    const handles = this.getOrCreate(eventName);
    if (!handles) return;
    handles.errorCounter.inc();
  }

  setSubscriberCount(eventName: string, count: number): void {
    const handles = this.getOrCreate(eventName);
    if (!handles) return;
    handles.subscriberGauge.set(count);
  }

  /** Events refused a metric handle because the tracking cap was hit. */
  get droppedEventCount(): number {
    return this.droppedEvents;
  }

  /** Number of events currently holding metric handles. */
  size(): number {
    return this.events.size;
  }

  updateDurableStats(
    eventName: string,
    stats: { queueDepth?: number; messagesInFlight?: number; oldestMessageAge?: number },
  ): void {
    const handles = this.getOrCreate(eventName);
    if (!handles) return;
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

  /**
   * Drop tracking for one event (or all of them).
   *
   * The handles must be zeroed before they are dropped. `MetricsRegistry`
   * keys its store by `(name, labels)` and hands back the EXISTING
   * instance when the same key is requested again, so deleting from
   * `this.events` alone left the counter alive in the registry: the next
   * `recordPublish` for that name re-fetched the old handle and
   * `publishCount` resumed from its pre-reset value instead of 1. That
   * made `POST /api/metrics/reset` look like it worked (getStats went
   * null) and then silently un-reset itself on the next publish.
   */
  reset(eventName?: string): void {
    const drop = (handles: EventMetricHandles): void => {
      handles.publishCounter.reset();
      handles.errorCounter.reset();
      handles.subscriberGauge.set(0);
      handles.queueDepthGauge.set(0);
      handles.messagesInFlightGauge.set(0);
      handles.oldestMessageAgeGauge.set(0);
    };

    if (eventName) {
      const handles = this.events.get(eventName);
      if (handles) drop(handles);
      this.events.delete(eventName);
      this.rateHistory.delete(eventName);
      return;
    }
    for (const handles of this.events.values()) drop(handles);
    this.events.clear();
    this.rateHistory.clear();
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
      if (!handles) continue;
      // Never move a counter backwards. Restore is a boot-time rehydrate,
      // but a stale snapshot (or a second restore after traffic has
      // started) would otherwise rewrite a live counter to a lower value
      // and make `rate()` read the drop as a counter reset — a phantom
      // spike on every dashboard that queries it.
      restoreCounter(handles.publishCounter, persisted.publishCount);
      restoreCounter(handles.errorCounter, persisted.errorCount);
      if (handles.lastPublishedAt === null) {
        handles.lastPublishedAt = persisted.lastPublishedAt;
      }
    }
  }

  private getOrCreate(eventName: string): EventMetricHandles | null {
    let handles = this.events.get(eventName);
    if (!handles) {
      if (this.events.size >= this.maxTrackedEvents) {
        this.droppedEvents++;
        if (!this.warnedAboutCap) {
          this.warnedAboutCap = true;
          console.warn(
            `[metrics] tracking cap of ${this.maxTrackedEvents} events reached — ` +
            'further events are not measured. Registry is larger than this service expects.',
          );
        }
        return null;
      }
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

/**
 * Rehydrate a counter to `target` without ever decreasing it.
 * A counter that goes down is read by Prometheus as a process restart,
 * so a stale snapshot must be ignored rather than applied.
 */
function restoreCounter(counter: Counter, target: number): void {
  if (!Number.isFinite(target) || target <= 0) return;
  const current = counter.get();
  if (target <= current) return;
  counter.inc(target - current);
}
