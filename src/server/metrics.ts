import type { EventStats } from '../types/index.js';

interface InternalMetrics {
  publishCount: number;
  errorCount: number;
  subscriberCount: number;
  lastPublishedAt: string | null;
  publishTimestamps: number[];
  queueDepth?: number;
  messagesInFlight?: number;
  oldestMessageAge?: number;
}

export class MetricsCollector {
  private counters = new Map<string, InternalMetrics>();
  private readonly rateWindowMs: number;

  constructor(rateWindowSeconds = 60) {
    this.rateWindowMs = rateWindowSeconds * 1000;
  }

  recordPublish(eventName: string): void {
    const metrics = this.getOrCreate(eventName);
    metrics.publishCount++;
    metrics.lastPublishedAt = new Date().toISOString();
    metrics.publishTimestamps.push(Date.now());
    this.pruneTimestamps(metrics);
  }

  recordError(eventName: string): void {
    const metrics = this.getOrCreate(eventName);
    metrics.errorCount++;
  }

  setSubscriberCount(eventName: string, count: number): void {
    const metrics = this.getOrCreate(eventName);
    metrics.subscriberCount = count;
  }

  updateDurableStats(
    eventName: string,
    stats: { queueDepth?: number; messagesInFlight?: number; oldestMessageAge?: number },
  ): void {
    const metrics = this.getOrCreate(eventName);
    if (stats.queueDepth !== undefined) metrics.queueDepth = stats.queueDepth;
    if (stats.messagesInFlight !== undefined) metrics.messagesInFlight = stats.messagesInFlight;
    if (stats.oldestMessageAge !== undefined) metrics.oldestMessageAge = stats.oldestMessageAge;
  }

  getStats(eventName: string): EventStats | null {
    const metrics = this.counters.get(eventName);
    if (!metrics) return null;

    this.pruneTimestamps(metrics);

    return {
      publishCount: metrics.publishCount,
      publishRate: this.calculateRate(metrics),
      lastPublishedAt: metrics.lastPublishedAt,
      errorCount: metrics.errorCount,
      subscriberCount: metrics.subscriberCount,
      ...(metrics.queueDepth !== undefined ? { queueDepth: metrics.queueDepth } : {}),
      ...(metrics.messagesInFlight !== undefined ? { messagesInFlight: metrics.messagesInFlight } : {}),
      ...(metrics.oldestMessageAge !== undefined ? { oldestMessageAge: metrics.oldestMessageAge } : {}),
    };
  }

  snapshot(): Record<string, EventStats> {
    const result: Record<string, EventStats> = {};

    for (const [eventName] of this.counters) {
      const stats = this.getStats(eventName);
      if (stats) result[eventName] = stats;
    }

    return result;
  }

  reset(eventName?: string): void {
    if (eventName) {
      this.counters.delete(eventName);
    } else {
      this.counters.clear();
    }
  }

  private getOrCreate(eventName: string): InternalMetrics {
    let metrics = this.counters.get(eventName);
    if (!metrics) {
      metrics = {
        publishCount: 0,
        errorCount: 0,
        subscriberCount: 0,
        lastPublishedAt: null,
        publishTimestamps: [],
      };
      this.counters.set(eventName, metrics);
    }
    return metrics;
  }

  private pruneTimestamps(metrics: InternalMetrics): void {
    const cutoff = Date.now() - this.rateWindowMs;
    while (metrics.publishTimestamps.length > 0 && metrics.publishTimestamps[0] < cutoff) {
      metrics.publishTimestamps.shift();
    }
  }

  private calculateRate(metrics: InternalMetrics): number {
    if (metrics.publishTimestamps.length === 0) return 0;
    return metrics.publishTimestamps.length / (this.rateWindowMs / 1000);
  }
}
