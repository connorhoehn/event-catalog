import type { EventEnvelope } from '../types/index';
import { type ChannelMessageEnvelope } from '../types/envelopes';
import { type CatalogLogger } from '../utils/logger';
/** Re-exported so consumers can type a logger without reaching into a subpath. */
export type { CatalogLogger, LogFields } from '../utils/logger';
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
export declare class SignalTransport {
    private publishClient;
    private subscribeClient;
    private readonly url;
    private readonly ringBufferSize;
    private connected;
    /** Shared by concurrent `connect()` callers so a race opens one pair of clients. */
    private connectInFlight;
    private subscriptions;
    private channelMetrics;
    private readonly maxTrackedChannels;
    /** Channels whose metrics were evicted for capacity. */
    private evictedChannelMetrics;
    private readonly circuitBreaker;
    /**
     * Publishes discarded because the transport was not connected. Keyed by
     * channel. A dropped publish is otherwise invisible — it neither throws
     * nor increments publishCount — so this counter is the only durable
     * evidence it happened. Bounded: per-channel detail evicts, the total
     * does not.
     */
    private readonly droppedCounts;
    /**
     * Rate limit for the disconnected-publish warning. Warn-once-per-channel
     * on its own does not bound anything when channels are per-document: the
     * window ceiling does.
     */
    private readonly dropWarnings;
    /** Ring-buffer write failures: counted always, logged at most once a minute. */
    private readonly ringBufferWarnings;
    private ringBufferFailures;
    /**
     * node-redis emits `error` on every reconnect attempt, so a Redis outage
     * emits these at the reconnect cadence for as long as it lasts.
     */
    private readonly clientErrorWarnings;
    private clientErrors;
    private readonly log;
    constructor(config: SignalTransportConfig);
    /**
     * Open the publish + subscribe Redis clients. Idempotent — a second call
     * while already connected is a no-op.
     *
     * @throws when Redis cannot be reached. The first connect is
     *   boot-bounded (it gives up rather than retrying forever) so a caller
     *   can degrade instead of hanging; reconnects after a successful
     *   connect retry indefinitely.
     */
    connect(): Promise<void>;
    private openClients;
    /**
     * Warn about a Redis client error at most once a minute per client role.
     * node-redis fires this on every reconnect attempt, so an outage would
     * otherwise emit one line per attempt for the whole outage.
     */
    private warnClientError;
    /**
     * Tear both clients down without regard for `connected`. Never throws.
     *
     * `graceful` picks the teardown: `quit()` drains pending commands and is
     * right for a live client, but on a client that never finished
     * connecting it *queues* the QUIT and waits — which is why a failed
     * connect must use the forced `disconnect()` instead of hanging boot.
     */
    private destroyClients;
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
    disconnect(): Promise<void>;
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
    publish(channel: string, envelope: EventEnvelope): Promise<void>;
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
    publishChannelMessage(channelId: string, envelope: ChannelMessageEnvelope): Promise<number>;
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
    subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>>;
    /**
     * Read recent envelopes from a channel's history ring buffer.
     *
     * Never throws: returns `[]` when disconnected, when the stream does not
     * exist, or on any Redis error. Entries that fail to parse are skipped,
     * so a short result does not mean the buffer was short.
     */
    getHistory(channel: string, count?: number): Promise<EventEnvelope[]>;
    /**
     * Per-channel publish/subscriber counters. With `channel`, returns that
     * channel's metrics (or `undefined` if it has never been published to or
     * subscribed on); without, a copy of the whole map.
     *
     * Counts only *successful* publishes — dropped publishes are in
     * {@link getDroppedCount}. Process-local; resets on restart.
     */
    getMetrics(channel?: string): Map<string, ChannelMetrics> | ChannelMetrics | undefined;
    /** Same as `getMetrics()` with no argument, but narrowly typed to the map. */
    getAllMetrics(): Map<string, ChannelMetrics>;
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
    };
    /** True once `connect()` has resolved and before `disconnect()` is called. */
    isConnected(): boolean;
    /**
     * PING the publish client. Never throws.
     *
     * `'disconnected'` = not connected or the ping errored; `'degraded'` =
     * the ping timed out after 2s or returned something other than PONG.
     */
    healthCheck(): Promise<{
        status: 'connected' | 'degraded' | 'disconnected';
        latencyMs: number;
    }>;
    /**
     * Count a dropped publish and warn once per channel. The one-shot warn
     * keeps a hot broadcast path from flooding logs while a reconnect is in
     * flight; the counter keeps the drop visible for the whole process life.
     */
    private recordDrop;
    /**
     * Fetch (or create) a channel's metrics row, evicting the oldest row when
     * the tracked-channel cap is reached. Publishing to a hostile or
     * per-document channel space therefore costs a bounded amount of memory.
     */
    private metricsFor;
    private incrementMetrics;
    private updateSubscriberCount;
}
//# sourceMappingURL=signal.d.ts.map