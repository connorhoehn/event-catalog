import type { Registry } from '../registry/index.js';
import type { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import type { MetricsCollector } from './metrics.js';
import { tapEmitter } from './tap-emitter.js';
import type { ProducerAttributionStore } from './producer-attribution.js';
import type { PoisonEventDetector } from './poison-detector.js';
import { auditEmitter } from './audit-emitter.js';
import { LogThrottle } from '../utils/bounded.js';
import { LogWriter, type CatalogLogger, errorMessage } from '../utils/logger.js';

/**
 * Ceiling on how many synthetic publish/error observations one poll pass
 * will replay from a single queue's counter delta.
 */
const MAX_CATCHUP_PER_POLL = 10_000;

/**
 * Rate ceiling on the observer's two per-event warnings.
 *
 * `pollDurableStats` runs every 5s and `pruneRemovedSubscriptions` walks
 * every tracked channel on each pass, so a Redis that refuses
 * unsubscribe — or an event whose channel cannot be subscribed —
 * produces one line per event per 5s, i.e. 17k lines a day for a single
 * stuck event and far more for a registry-wide outage. Keyed by event
 * name so one bad event does not mask another; the window ceiling is
 * what holds when the whole registry is failing at once.
 */
const OBSERVER_LOG_WINDOW_MS = 60_000;
const OBSERVER_LOGS_PER_WINDOW = 5;

export class MetricsObserver {
  private readonly registry: Registry;
  private readonly signal: SignalTransport;
  private readonly durable: DurableTransport;
  private readonly metrics: MetricsCollector;
  private readonly attribution?: ProducerAttributionStore;
  private readonly poisonDetector?: PoisonEventDetector;
  private readonly signalUnsubscribes = new Map<string, () => Promise<void>>();
  private durablePollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly durablePollIntervalMs: number;
  // Track durable transport counters separately from MetricsCollector's
  // shared publishCount/errorCount. For transport:'both' events the
  // signal observation path also bumps those shared counters, so using
  // them as the "what we've attributed to durable so far" baseline
  // makes the delta go negative and silently drops durable observations.
  private readonly lastDurableSent = new Map<string, number>();
  private readonly lastDurableFailed = new Map<string, number>();
  /**
   * Re-entrancy guard for the durable poll.
   *
   * `setInterval` fires on a wall clock, not on completion, and
   * `pollDurableStats` awaits one `getQueueAttributes` round-trip per
   * durable event. Once the message-queue is slow enough that a pass
   * outlasts the 5s interval — precisely the incident you are looking at
   * the metrics during — two passes interleave: both read the same
   * `lastDurableSent` baseline before either writes it, so every publish
   * in the delta is counted twice and the publish rate reads roughly
   * double. Serialize instead.
   */
  private polling = false;

  private readonly log: LogWriter;
  private readonly warnings = new LogThrottle({
    keyIntervalMs: OBSERVER_LOG_WINDOW_MS,
    maxPerWindow: OBSERVER_LOGS_PER_WINDOW,
  });

  constructor(deps: {
    registry: Registry;
    signal: SignalTransport;
    durable: DurableTransport;
    metrics: MetricsCollector;
    attribution?: ProducerAttributionStore;
    poisonDetector?: PoisonEventDetector;
    durablePollIntervalMs?: number;
    /** Diagnostics sink. Defaults to `console.warn`. */
    logger?: CatalogLogger;
  }) {
    this.log = new LogWriter(deps.logger);
    this.registry = deps.registry;
    this.signal = deps.signal;
    this.durable = deps.durable;
    this.metrics = deps.metrics;
    this.attribution = deps.attribution;
    this.poisonDetector = deps.poisonDetector;
    this.durablePollIntervalMs = deps.durablePollIntervalMs ?? 5000;
  }

  async start(): Promise<void> {
    const entries = this.registry.list();

    for (const entry of entries) {
      await this.observe(entry.name, entry.transport);
    }
    // Durable-only events never reach `observeSignal`, so without this
    // their subscriber gauge sat at 0 for the process lifetime no matter
    // how many consumers had registered.
    this.syncSubscriberCounts();

    this.durablePollTimer = setInterval(() => {
      // Reconcile first and outside `pollDurableStats`'s re-entrancy
      // guard: this is synchronous and local, and it must not be skipped
      // because a message-queue round-trip is hung.
      this.syncSubscriberCounts();
      this.pollDurableStats();
    }, this.durablePollIntervalMs);
  }

  async observe(eventName: string, transport: 'signal' | 'durable' | 'both'): Promise<void> {
    if (transport === 'signal' || transport === 'both') {
      await this.observeSignal(eventName);
    }
    this.refreshSubscriberCount(eventName);
  }

  /**
   * Re-read one event's subscriber count from the registry.
   *
   * The gauge is push-only, so every path that mutates
   * `entry.subscribers` has to say so or the operator reads a number
   * from whenever the event was first observed. `routes/subscribers.ts`
   * calls this on add and remove; the periodic
   * {@link syncSubscriberCounts} catches the paths that cannot (the
   * stale-subscriber sweeper in `server/index.ts`, and replicated
   * mutations arriving via `RegistryCoordinator`).
   *
   * An event the registry no longer holds is left alone rather than
   * zeroed — `MetricsCollector.reset` owns teardown, and zeroing here
   * would mint handles for a name that no longer exists.
   */
  refreshSubscriberCount(eventName: string): void {
    const entry = this.registry.get(eventName);
    if (!entry) return;
    this.metrics.setSubscriberCount(eventName, entry.subscribers.length);
  }

  /** Reconcile every declared event's subscriber gauge with the registry. */
  syncSubscriberCounts(): void {
    for (const entry of this.registry.list()) {
      this.metrics.setSubscriberCount(entry.name, entry.subscribers.length);
    }
  }

  /**
   * Release signal subscriptions for events the registry has dropped.
   *
   * `DELETE /api/events/:name` removes the declaration but nothing told
   * the observer, so the Redis subscription stayed open for the process
   * lifetime and kept recording publishes against an event that no
   * longer exists — one retained handler and one map entry per deleted
   * name, and names arrive from HTTP (`POST /api/events/bulk` takes
   * 1000 per request).
   *
   * An event deleted and re-declared between two ticks keeps its
   * subscription: the registry lookup finds it again. A re-declare
   * racing this teardown is safe because `SignalTransport`'s unsubscribe
   * is per-handler and only drops the channel with its last handler.
   */
  private async pruneRemovedSubscriptions(): Promise<void> {
    for (const [name, unsub] of [...this.signalUnsubscribes]) {
      if (this.registry.get(name)) continue;
      this.signalUnsubscribes.delete(name);
      try {
        await unsub();
      } catch (err) {
        const suppressed = this.warnings.attempt(`release:${name}`);
        if (suppressed !== null) {
          this.log.warn(
            `[metrics-observer] failed to release channel "${name}"`
            + LogThrottle.suffix(suppressed) + ':',
            {
              component: 'metrics-observer',
              eventName: name,
              action: 'release-channel',
              error: errorMessage(err),
              suppressed,
            },
            (err as Error).message,
          );
        }
      }
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
    // Reset durable baselines so a restart against a fresh transport
    // (counters back to 0) doesn't compute a negative delta from a
    // stale high-water mark.
    this.lastDurableSent.clear();
    this.lastDurableFailed.clear();
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
      // The count is the registry's registered consumers, nothing else.
      // It used to be `length + 1`, which counted the observer's OWN
      // Redis subscription — an internal implementation detail — so the
      // admin UI reported one consumer more than exist, and an event
      // with none at all looked like it had one.
      this.refreshSubscriberCount(eventName);
    } catch (err) {
      this.metrics.recordError(eventName);
      this.maybePoison(eventName);
      const suppressed = this.warnings.attempt(`observe:${eventName}`);
      if (suppressed !== null) {
        this.log.warn(
          `[metrics-observer] failed to observe signal channel "${eventName}"`
          + LogThrottle.suffix(suppressed) + ':',
          {
            component: 'metrics-observer',
            eventName,
            action: 'observe-signal',
            error: errorMessage(err),
            suppressed,
          },
          (err as Error).message,
        );
      }
    }
  }

  private maybePoison(eventName: string): void {
    if (!this.poisonDetector) return;
    const becamePoison = this.poisonDetector.recordFailure(eventName);
    if (becamePoison) {
      const entry = this.registry.get(eventName);
      auditEmitter.publish({
        kind: 'event.poisoned',
        timestamp: new Date().toISOString(),
        eventName,
        namespace: entry?.namespace ?? 'unknown',
        version: entry?.version ?? 0,
      });
      // Latched by the detector: `recordFailure` returns true only on the
      // transition into the poisoned state, so this is once per event per
      // poisoning, not once per failure.
      this.log.warn(
        `[event-catalog] event "${eventName}" marked poisoned — exceeded failure threshold`,
        {
          component: 'metrics-observer',
          eventName,
          namespace: entry?.namespace ?? 'unknown',
          status: 'poisoned',
        },
      );
    }
  }

  private async pollDurableStats(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.pruneRemovedSubscriptions();
      await this.pollDurableStatsOnce();
    } finally {
      this.polling = false;
    }
  }

  private async pollDurableStatsOnce(): Promise<void> {
    // Include transport:'both' — its durable side has the same SQS-style
    // counters as a pure 'durable' event. The registry's transport filter
    // is strict equality, so we widen here rather than calling list()
    // twice.
    const durableEvents = this.registry
      .list()
      .filter(e => e.transport === 'durable' || e.transport === 'both');

    // Drop baselines for events the registry no longer holds (deleted,
    // or re-declared onto a signal-only transport). Nothing else ever
    // removes from these maps, so without this they retain an entry per
    // event name the service has ever seen — and event names arrive from
    // HTTP, where `POST /api/events/bulk` takes 1000 at a time.
    const live = new Set(durableEvents.map(e => e.name));
    for (const name of this.lastDurableSent.keys()) {
      if (!live.has(name)) this.lastDurableSent.delete(name);
    }
    for (const name of this.lastDurableFailed.keys()) {
      if (!live.has(name)) this.lastDurableFailed.delete(name);
    }

    for (const entry of durableEvents) {
      const queueName = entry.queue ?? DurableTransport.eventNameToQueueName(entry.name, entry.fifo);
      const attrs = await this.durable.getQueueAttributes(queueName);

      if (attrs) {
        this.metrics.updateDurableStats(entry.name, {
          queueDepth: queueCount(attrs['ApproximateNumberOfMessages']),
          messagesInFlight: queueCount(attrs['ApproximateNumberOfMessagesNotVisible']),
          // `oldestMessageAge` is declared on EventStats and gauged by
          // MetricsCollector but was never populated, so it read 0 —
          // i.e. "nothing is stuck" — for every queue forever. Depth
          // alone does not distinguish a busy queue from a wedged one;
          // the age of the head does.
          oldestMessageAge: queueCount(attrs['ApproximateAgeOfOldestMessage']),
        });
      }

      const transportMetrics = this.durable.getMetrics(queueName) as
        { sent: number; received: number; failed: number; inFlight: number } | undefined;

      if (transportMetrics) {
        // Counter-reset handling. The transport's `sent`/`failed` are
        // process-lifetime counters on the DurableTransport instance; a
        // reconnect or a swapped transport restarts them at 0. The old
        // code only advanced the baseline when the new value was HIGHER,
        // so after a reset every publish was silently dropped on the
        // floor until the counter climbed back past the stale high-water
        // mark — an outage-shaped gap in the publish rate caused by the
        // recovery, not by the incident. Treat a decrease as a reset and
        // re-baseline at the observed value.
        const rawSentBaseline = this.lastDurableSent.get(entry.name) ?? 0;
        const seenBefore = transportMetrics.sent < rawSentBaseline ? 0 : rawSentBaseline;
        // Bound the catch-up loop. A first poll against a long-running
        // transport, or a reset, can produce an enormous delta; each
        // iteration emits a tap frame to every SSE subscriber, so an
        // unbounded loop here is a self-inflicted stall.
        const newSends = Math.min(transportMetrics.sent - seenBefore, MAX_CATCHUP_PER_POLL);
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
        this.lastDurableSent.set(entry.name, transportMetrics.sent);

        const rawFailedBaseline = this.lastDurableFailed.get(entry.name) ?? 0;
        const prevErrors = transportMetrics.failed < rawFailedBaseline ? 0 : rawFailedBaseline;
        const newErrors = Math.min(transportMetrics.failed - prevErrors, MAX_CATCHUP_PER_POLL);
        for (let i = 0; i < newErrors; i++) {
          this.metrics.recordError(entry.name);
          this.maybePoison(entry.name);
        }
        this.lastDurableFailed.set(entry.name, transportMetrics.failed);
      }
    }
  }
}

/** MQ attributes are wire strings; missing/malformed values remain unknown. */
function queueCount(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}
