import { createClient, type RedisClientType } from 'redis';
import { CircuitBreaker } from 'distributed-core/transport';
import type { EventEnvelope } from '../types/index';
import {
  createBootBoundedReconnectStrategy,
  formatRedisError,
} from '../utils/redis-boot-strategy';
import {
  channelMessageRedisChannel,
  channelNodesRedisKey,
  type ChannelMessageEnvelope,
} from '../types/envelopes';
import { BoundedCounter, LogThrottle, rememberBounded } from '../utils/bounded';
import { LogWriter, errorMessage, type CatalogLogger, type LogFields } from '../utils/logger';

/** Re-exported so consumers can type a logger without reaching into a subpath. */
export type { CatalogLogger, LogFields } from '../utils/logger';

/**
 * Cap on per-channel bookkeeping (metrics, drop counts).
 *
 * Channels are caller-controlled: a declaration may carry
 * `channel: p => \`document:${p.documentId}\``, and `publishChannelMessage`
 * takes a raw channel id from the gateway. Both key spaces are effectively
 * unbounded over a process lifetime, so per-channel detail is capped and
 * evicted oldest-first while the aggregate totals stay exact.
 */
const MAX_TRACKED_CHANNELS = 1000;

export interface SignalTransportConfig {
  /**
   * Redis connection string (`redis://host:port`). Usually sourced from
   * the `REDIS_URL` env var by the owning service.
   */
  url: string;
  /** Per-channel history ring-buffer depth (Redis Stream MAXLEN). Default 100. */
  ringBufferSize?: number;
  /**
   * Cap on how many distinct channels keep per-channel metrics and drop
   * counters. Oldest-first eviction past this; aggregate totals are never
   * evicted. Default 1000.
   */
  maxTrackedChannels?: number;
  /**
   * Sink for this transport's diagnostics. Defaults to `console.warn` /
   * `console.error` — byte-identical to the pre-logger behaviour.
   */
  logger?: CatalogLogger;
}

interface ChannelMetrics {
  publishCount: number;
  lastPublishedAt: string | null;
  subscriberCount: number;
}

type MessageHandler = (envelope: EventEnvelope) => void;

/**
 * Redis pub/sub transport for `transport: 'signal'` events.
 *
 * Failure semantics (read this before relying on a publish):
 *   - **Not connected → the publish is DROPPED, not thrown.** `publish()`
 *     and `publishChannelMessage()` return normally. The drop is counted
 *     (`getDroppedCount()`) and warned once per channel. `EventCatalog`
 *     surfaces the same drop through its `onPublishDropped` callback.
 *   - **Connected but Redis is failing → the publish REJECTS.** The
 *     circuit breaker propagates the error (and trips open after 5
 *     consecutive failures, rejecting fast for 30s).
 *   - **Ring-buffer (history) write failures are swallowed and warned** —
 *     the pub/sub delivery already succeeded at that point.
 *
 * Signal delivery is fire-and-forget by design: there is no ack, no
 * retry and no persistence. A subscriber that is not connected at
 * publish time never sees the message.
 */
export class SignalTransport {
  private publishClient: RedisClientType | null = null;
  private subscribeClient: RedisClientType | null = null;
  private readonly url: string;
  private readonly ringBufferSize: number;
  private connected = false;
  /** Shared by concurrent `connect()` callers so a race opens one pair of clients. */
  private connectInFlight: Promise<void> | null = null;
  private subscriptions = new Map<string, Set<MessageHandler>>();
  private channelMetrics = new Map<string, ChannelMetrics>();
  private readonly maxTrackedChannels: number;
  /** Channels whose metrics were evicted for capacity. */
  private evictedChannelMetrics = 0;
  private readonly circuitBreaker: CircuitBreaker;
  /**
   * Publishes discarded because the transport was not connected. Keyed by
   * channel. A dropped publish is otherwise invisible — it neither throws
   * nor increments publishCount — so this counter is the only durable
   * evidence it happened. Bounded: per-channel detail evicts, the total
   * does not.
   */
  private readonly droppedCounts: BoundedCounter;
  /**
   * Rate limit for the disconnected-publish warning. Warn-once-per-channel
   * on its own does not bound anything when channels are per-document: the
   * window ceiling does.
   */
  private readonly dropWarnings: LogThrottle;
  /** Ring-buffer write failures: counted always, logged at most once a minute. */
  private readonly ringBufferWarnings: LogThrottle;
  private ringBufferFailures = 0;
  /**
   * node-redis emits `error` on every reconnect attempt, so a Redis outage
   * emits these at the reconnect cadence for as long as it lasts.
   */
  private readonly clientErrorWarnings: LogThrottle;
  private clientErrors = 0;
  private readonly log: LogWriter;

  constructor(config: SignalTransportConfig) {
    this.url = config.url;
    this.log = new LogWriter(config.logger);
    this.ringBufferSize = config.ringBufferSize ?? 100;
    this.maxTrackedChannels = Math.max(1, config.maxTrackedChannels ?? MAX_TRACKED_CHANNELS);
    this.droppedCounts = new BoundedCounter(this.maxTrackedChannels);
    this.dropWarnings = new LogThrottle({ maxKeys: 512, maxPerWindow: 10 });
    this.ringBufferWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxKeys: 8, maxPerWindow: 2 });
    this.clientErrorWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxKeys: 8, maxPerWindow: 4 });
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000,
      timeout: 10000,
      enableLogging: false,
      name: 'signal-redis',
    });
  }

  /**
   * Open the publish + subscribe Redis clients. Idempotent — a second call
   * while already connected is a no-op.
   *
   * @throws when Redis cannot be reached. The first connect is
   *   boot-bounded (it gives up rather than retrying forever) so a caller
   *   can degrade instead of hanging; reconnects after a successful
   *   connect retry indefinitely.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    // Two callers racing connect() previously opened two pairs of Redis
    // clients and leaked the losing pair (with its reconnect timers and
    // error listeners). Share the in-flight attempt instead.
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = this.openClients()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.connectInFlight = null;
      });

    return this.connectInFlight;
  }

  private async openClients(): Promise<void> {
    // A fresh outage deserves a fresh warning, so re-arm the one-shot
    // disconnected-publish warnings each time we come back up.
    this.dropWarnings.clear();

    await this.circuitBreaker.execute(async () => {
      // Boot-bounded reconnect — node-redis retries the FIRST connect()
      // forever by default, which would hang this await (and any server
      // booting on top of it) instead of surfacing a rejection the caller
      // can degrade on. Post-connect reconnects stay infinite.
      const publishBootStrategy = createBootBoundedReconnectStrategy({
        label: 'signal publish',
      });
      const subscribeBootStrategy = createBootBoundedReconnectStrategy({
        label: 'signal subscribe',
      });

      this.publishClient = createClient({
        url: this.url,
        socket: { reconnectStrategy: publishBootStrategy.reconnectStrategy },
      }) as RedisClientType;
      this.subscribeClient = createClient({
        url: this.url,
        socket: { reconnectStrategy: subscribeBootStrategy.reconnectStrategy },
      }) as RedisClientType;

      this.publishClient.on('error', (err: Error) => {
        this.warnClientError('publish', err);
      });

      this.subscribeClient.on('error', (err: Error) => {
        this.warnClientError('subscribe', err);
      });

      try {
        await Promise.all([
          this.publishClient.connect().then(() => publishBootStrategy.markConnected()),
          this.subscribeClient.connect().then(() => subscribeBootStrategy.markConnected()),
        ]);
      } catch (err) {
        // A failed connect used to leave both clients referenced and
        // reconnecting forever — a rejected connect() that keeps the
        // process alive is the classic "container will not stop".
        await this.destroyClients(false);
        throw err;
      }
    });
  }

  /**
   * Warn about a Redis client error at most once a minute per client role.
   * node-redis fires this on every reconnect attempt, so an outage would
   * otherwise emit one line per attempt for the whole outage.
   */
  private warnClientError(role: 'publish' | 'subscribe', err: Error): void {
    this.clientErrors++;
    const suppressed = this.clientErrorWarnings.attempt(role);
    if (suppressed === null) return;
    const detail = formatRedisError(err);
    this.log.warn(
      `[signal-transport] ${role} client error:` + LogThrottle.suffix(suppressed),
      { role, error: detail, clientErrors: this.clientErrors, suppressed },
      detail,
    );
  }

  /**
   * Tear both clients down without regard for `connected`. Never throws.
   *
   * `graceful` picks the teardown: `quit()` drains pending commands and is
   * right for a live client, but on a client that never finished
   * connecting it *queues* the QUIT and waits — which is why a failed
   * connect must use the forced `disconnect()` instead of hanging boot.
   */
  private async destroyClients(graceful: boolean): Promise<void> {
    const clients = [this.publishClient, this.subscribeClient];
    this.publishClient = null;
    this.subscribeClient = null;
    await Promise.all(clients.map(async (client) => {
      if (!client) return;
      const raw = client as unknown as {
        removeAllListeners?: (event?: string) => unknown;
        quit?: () => Promise<unknown>;
        disconnect?: () => Promise<unknown> | unknown;
      };
      try { raw.removeAllListeners?.('error'); } catch { /* not an emitter */ }
      if (graceful) {
        try {
          await raw.quit?.();
          return;
        } catch { /* fall through to a forced close */ }
      }
      // Forced close: stops the reconnect timer that would otherwise hold
      // the event loop open long after connect() rejected.
      try { await raw.disconnect?.(); } catch { /* already gone */ }
    }));
  }

  /**
   * Unsubscribe every channel and quit both Redis clients. Idempotent and
   * best-effort: errors during teardown are swallowed so shutdown always
   * completes. After this, publishes are dropped rather than thrown.
   *
   * Safe to call twice, and safe to call after a *failed* `connect()` —
   * it tears down whatever clients exist rather than checking `connected`,
   * so a half-open connect cannot leave a reconnect timer holding the
   * process open past SIGTERM.
   */
  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.subscribeClient) {
      for (const channel of this.subscriptions.keys()) {
        try {
          await this.subscribeClient.unsubscribe(channel);
        } catch {
          // ignore during shutdown
        }
      }
    }
    this.subscriptions.clear();

    await this.destroyClients(true);
  }

  /**
   * Publish an envelope on a Redis pub/sub channel and append it to that
   * channel's history ring buffer.
   *
   * @throws when the transport is connected but Redis rejects the publish,
   *   or when the circuit breaker is open.
   * @remarks Resolves *without publishing* when the transport is not
   *   connected — see {@link getDroppedCount}. Does not guarantee delivery:
   *   Redis pub/sub has no ack and no replay for absent subscribers.
   */
  async publish(channel: string, envelope: EventEnvelope): Promise<void> {
    if (!this.connected || !this.publishClient) {
      this.recordDrop(
        channel,
        `[signal-transport] not connected, skipping publish to ${channel} — `
        + `the event is LOST. Call connect() (or EventCatalog.connect()) and wait for it `
        + `to resolve before publishing.`,
        { eventName: envelope.eventName, kind: 'publish' },
      );
      return;
    }

    await this.circuitBreaker.execute(async () => {
      const serialized = JSON.stringify(envelope);

      await this.publishClient!.publish(channel, serialized);

      // Write to ring buffer (Redis Stream) for history inspection
      await this.publishClient!.xAdd(
        `${channel}:history`,
        '*',
        { payload: serialized },
        { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: this.ringBufferSize } },
      ).catch((err: Error) => {
        // Redis rejecting XADD (OOM, a wrong-type key, a replica) rejects it
        // for *every* publish. Count them all; log at most one a minute.
        this.ringBufferFailures++;
        const suppressed = this.ringBufferWarnings.attempt('ring-buffer');
        if (suppressed === null) return;
        this.log.warn(
          `[signal-transport] ring buffer write failed for ${channel} `
          + `(${this.ringBufferFailures} total this process)`
          + LogThrottle.suffix(suppressed) + ':',
          {
            channel,
            error: err.message,
            ringBufferFailures: this.ringBufferFailures,
            suppressed,
          },
          err.message,
        );
      });
    });

    this.incrementMetrics(channel);
  }

  /**
   * Gateway-compatible channel-message publish (wave1-ec-3).
   *
   * Unlike `publish(channel, EventEnvelope)`, which is the generic
   * pub/sub primitive and writes to a per-channel history ring buffer,
   * this method publishes the websocket-gateway's `ChannelMessageEnvelope`
   * shape on `websocket:route:{channelId}` and looks up the target gateway
   * nodes from `websocket:channel:{channelId}:nodes` (set populated by
   * the gateway's NodeManager).
   *
   * Skips the publish when no nodes are subscribed (returns 0).
   * Does NOT write to ring buffer — the gateway has its own history.
   *
   * @returns the number of gateway nodes the envelope was addressed to.
   *   **`0` is ambiguous**: it means either "no gateway node is registered
   *   for this channel" (normal — nobody is listening) or "the transport
   *   is not connected, so the message was dropped". Use
   *   {@link getDroppedCount} to tell the two apart.
   * @throws when connected but Redis rejects the publish, or when the
   *   circuit breaker is open.
   */
  async publishChannelMessage(
    channelId: string,
    envelope: ChannelMessageEnvelope,
  ): Promise<number> {
    if (!this.connected || !this.publishClient) {
      this.recordDrop(
        channelId,
        `[signal-transport] not connected, skipping channel-message publish to ${channelId} — `
        + `the message is LOST. Call connect() (or EventCatalog.connect()) and wait for it `
        + `to resolve before publishing.`,
        { channelId, kind: 'channel-message' },
      );
      return 0;
    }

    return this.circuitBreaker.execute(async () => {
      const targetNodes = await this.publishClient!.sMembers(channelNodesRedisKey(channelId));
      if (targetNodes.length === 0) return 0;

      // Populate targetNodes on the envelope if the caller didn't already.
      const finalEnvelope: ChannelMessageEnvelope =
        envelope.targetNodes && envelope.targetNodes.length > 0
          ? envelope
          : { ...envelope, targetNodes };

      await this.publishClient!.publish(
        channelMessageRedisChannel(channelId),
        JSON.stringify(finalEnvelope),
      );
      return targetNodes.length;
    });
  }

  /**
   * Attach a handler to a Redis pub/sub channel. Multiple handlers may
   * share a channel; the Redis subscription is created once and torn down
   * when the last handler unsubscribes.
   *
   * Unlike `publish()`, this **throws** when the transport is not
   * connected — a silently-inert subscription is worse than a loud failure.
   *
   * Handler exceptions and undeserializable messages are caught and logged;
   * they never tear down the subscription.
   *
   * @returns an idempotent unsubscribe function.
   * @throws when the transport is not connected.
   */
  async subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>> {
    if (!this.connected || !this.subscribeClient) {
      throw new Error(
        '[signal-transport] not connected — call connect() (or EventCatalog.connect()) '
        + `and await it before subscribing to "${channel}".`,
      );
    }

    let handlers = this.subscriptions.get(channel);
    const isNewChannel = !handlers;

    if (!handlers) {
      handlers = new Set();
      this.subscriptions.set(channel, handlers);
    }

    handlers.add(handler);

    if (isNewChannel) {
      await this.subscribeClient.subscribe(channel, (message: string) => {
        try {
          const envelope = JSON.parse(message) as EventEnvelope;
          const currentHandlers = this.subscriptions.get(channel);
          if (currentHandlers) {
            for (const h of currentHandlers) {
              try {
                h(envelope);
              } catch (err) {
                this.log.error(
                  `[signal-transport] handler error on ${channel}:`,
                  { channel, error: errorMessage(err) },
                  err,
                );
              }
            }
          }
        } catch (err) {
          this.log.error(
            `[signal-transport] deserialize error on ${channel}:`,
            { channel, error: errorMessage(err) },
            err,
          );
        }
      });
    }

    this.updateSubscriberCount(channel);

    return async () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.subscriptions.delete(channel);
        await this.subscribeClient?.unsubscribe(channel).catch(() => {});
      }
      this.updateSubscriberCount(channel);
    };
  }

  /**
   * Read recent envelopes from a channel's history ring buffer.
   *
   * Never throws: returns `[]` when disconnected, when the stream does not
   * exist, or on any Redis error. Entries that fail to parse are skipped,
   * so a short result does not mean the buffer was short.
   */
  async getHistory(channel: string, count = 50): Promise<EventEnvelope[]> {
    if (!this.connected || !this.publishClient) return [];

    try {
      const entries = await this.publishClient.xRange(
        `${channel}:history`,
        '-',
        '+',
      );

      const recent = entries.slice(-count);
      return recent.map(entry => {
        try {
          return JSON.parse(entry.message.payload) as EventEnvelope;
        } catch {
          return null;
        }
      }).filter((e): e is EventEnvelope => e !== null);
    } catch (err) {
      // An empty array reads as "this event has no recent messages", which is
      // a different fact from "Redis did not answer". Propagate so the caller
      // can say which one it is.
      throw new Error(
        `[signal-transport] history unavailable for "${channel}": `
        + (err instanceof Error ? err.message : String(err)),
        { cause: err },
      );
    }
  }

  /**
   * Per-channel publish/subscriber counters. With `channel`, returns that
   * channel's metrics (or `undefined` if it has never been published to or
   * subscribed on); without, a copy of the whole map.
   *
   * Counts only *successful* publishes — dropped publishes are in
   * {@link getDroppedCount}. Process-local; resets on restart.
   */
  getMetrics(channel?: string): Map<string, ChannelMetrics> | ChannelMetrics | undefined {
    if (channel) return this.channelMetrics.get(channel);
    return new Map(this.channelMetrics);
  }

  /** Same as `getMetrics()` with no argument, but narrowly typed to the map. */
  getAllMetrics(): Map<string, ChannelMetrics> {
    return new Map(this.channelMetrics);
  }

  /**
   * Publishes discarded because the transport was not connected — with
   * `channel`, that channel's count; without, a copy of the whole map.
   *
   * A non-zero value means events were lost. Wire this into a gauge, or
   * use `EventCatalog`'s `onPublishDropped` callback for a per-drop hook.
   * Process-local; resets on restart.
   */
  getDroppedCount(channel: string): number;
  getDroppedCount(): Map<string, number>;
  getDroppedCount(channel?: string): number | Map<string, number> {
    if (channel !== undefined) return this.droppedCounts.get(channel);
    return this.droppedCounts.snapshot();
  }

  /**
   * Aggregates that survive eviction and log suppression.
   *
   * `getDroppedCount()`'s map holds at most `maxTrackedChannels` entries,
   * so on a per-document channel scheme the map is a *sample*, not the
   * total. `droppedTotal` here is exact for the life of the process, and
   * `suppressedWarnings` says how many log lines were withheld. Read these
   * before concluding from the map that nothing was lost.
   */
  getOverflowStats(): {
    droppedTotal: number;
    droppedEvictedChannels: number;
    droppedEvictedTotal: number;
    trackedChannels: number;
    evictedChannelMetrics: number;
    ringBufferFailures: number;
    clientErrors: number;
    suppressedWarnings: number;
  } {
    return {
      droppedTotal: this.droppedCounts.total,
      droppedEvictedChannels: this.droppedCounts.evictedKeys,
      droppedEvictedTotal: this.droppedCounts.evictedTotal,
      trackedChannels: this.channelMetrics.size,
      evictedChannelMetrics: this.evictedChannelMetrics,
      ringBufferFailures: this.ringBufferFailures,
      clientErrors: this.clientErrors,
      suppressedWarnings:
        this.dropWarnings.suppressedTotal
        + this.ringBufferWarnings.suppressedTotal
        + this.clientErrorWarnings.suppressedTotal,
    };
  }

  /** True once `connect()` has resolved and before `disconnect()` is called. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * PING the publish client. Never throws.
   *
   * `'disconnected'` = not connected or the ping errored; `'degraded'` =
   * the ping timed out after 2s or returned something other than PONG.
   */
  async healthCheck(): Promise<{ status: 'connected' | 'degraded' | 'disconnected'; latencyMs: number }> {
    if (!this.connected || !this.publishClient) {
      return { status: 'disconnected', latencyMs: 0 };
    }

    const start = performance.now();
    // The timer has to be cleared even when the ping wins the race: a
    // health endpoint polled every second otherwise keeps 2s of timers
    // permanently pending, and holds the event loop open at shutdown.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.publishClient.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 2000);
        }),
      ]);
      const latencyMs = Math.round(performance.now() - start);
      if (result === 'PONG') {
        return { status: 'connected', latencyMs };
      }
      return { status: 'degraded', latencyMs };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      if ((err as Error).message === 'timeout') {
        return { status: 'degraded', latencyMs };
      }
      return { status: 'disconnected', latencyMs };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Count a dropped publish and warn once per channel. The one-shot warn
   * keeps a hot broadcast path from flooding logs while a reconnect is in
   * flight; the counter keeps the drop visible for the whole process life.
   */
  private recordDrop(channel: string, message: string, fields: LogFields): void {
    this.droppedCounts.increment(channel);
    const suppressed = this.dropWarnings.attempt(channel);
    if (suppressed === null) return;
    this.log.warn(message + LogThrottle.suffix(suppressed), {
      ...fields,
      channel,
      dropped: this.droppedCounts.get(channel),
      suppressed,
    });
  }

  /**
   * Fetch (or create) a channel's metrics row, evicting the oldest row when
   * the tracked-channel cap is reached. Publishing to a hostile or
   * per-document channel space therefore costs a bounded amount of memory.
   */
  private metricsFor(channel: string): ChannelMetrics {
    const existing = this.channelMetrics.get(channel);
    if (existing) return existing;
    const metrics: ChannelMetrics = {
      publishCount: 0,
      lastPublishedAt: null,
      subscriberCount: 0,
    };
    const evicted = rememberBounded(
      this.channelMetrics,
      channel,
      metrics,
      this.maxTrackedChannels,
    );
    if (evicted !== undefined) this.evictedChannelMetrics++;
    return metrics;
  }

  private incrementMetrics(channel: string): void {
    const metrics = this.metricsFor(channel);
    metrics.publishCount++;
    metrics.lastPublishedAt = new Date().toISOString();
  }

  private updateSubscriberCount(channel: string): void {
    const metrics = this.metricsFor(channel);
    metrics.subscriberCount = this.subscriptions.get(channel)?.size ?? 0;
  }
}
