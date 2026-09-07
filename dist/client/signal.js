"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalTransport = void 0;
const redis_1 = require("redis");
const transport_1 = require("distributed-core/transport");
const redis_boot_strategy_1 = require("../utils/redis-boot-strategy");
const envelopes_1 = require("../types/envelopes");
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
class SignalTransport {
    publishClient = null;
    subscribeClient = null;
    url;
    ringBufferSize;
    connected = false;
    subscriptions = new Map();
    channelMetrics = new Map();
    circuitBreaker;
    /**
     * Publishes discarded because the transport was not connected. Keyed by
     * channel. A dropped publish is otherwise invisible — it neither throws
     * nor increments publishCount — so this counter is the only durable
     * evidence it happened.
     */
    droppedCounts = new Map();
    /** Channels we've already warned about, so a hot path can't flood logs. */
    warnedDisconnectedChannels = new Set();
    constructor(config) {
        this.url = config.url;
        this.ringBufferSize = config.ringBufferSize ?? 100;
        this.circuitBreaker = new transport_1.CircuitBreaker({
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
    async connect() {
        if (this.connected)
            return;
        // A fresh outage deserves a fresh warning, so re-arm the one-shot
        // disconnected-publish warnings each time we come back up.
        this.warnedDisconnectedChannels.clear();
        await this.circuitBreaker.execute(async () => {
            // Boot-bounded reconnect — node-redis retries the FIRST connect()
            // forever by default, which would hang this await (and any server
            // booting on top of it) instead of surfacing a rejection the caller
            // can degrade on. Post-connect reconnects stay infinite.
            const publishBootStrategy = (0, redis_boot_strategy_1.createBootBoundedReconnectStrategy)({
                label: 'signal publish',
            });
            const subscribeBootStrategy = (0, redis_boot_strategy_1.createBootBoundedReconnectStrategy)({
                label: 'signal subscribe',
            });
            this.publishClient = (0, redis_1.createClient)({
                url: this.url,
                socket: { reconnectStrategy: publishBootStrategy.reconnectStrategy },
            });
            this.subscribeClient = (0, redis_1.createClient)({
                url: this.url,
                socket: { reconnectStrategy: subscribeBootStrategy.reconnectStrategy },
            });
            this.publishClient.on('error', (err) => {
                console.warn('[signal-transport] publish client error:', (0, redis_boot_strategy_1.formatRedisError)(err));
            });
            this.subscribeClient.on('error', (err) => {
                console.warn('[signal-transport] subscribe client error:', (0, redis_boot_strategy_1.formatRedisError)(err));
            });
            await Promise.all([
                this.publishClient.connect().then(() => publishBootStrategy.markConnected()),
                this.subscribeClient.connect().then(() => subscribeBootStrategy.markConnected()),
            ]);
        });
        this.connected = true;
    }
    /**
     * Unsubscribe every channel and quit both Redis clients. Idempotent and
     * best-effort: errors during teardown are swallowed so shutdown always
     * completes. After this, publishes are dropped rather than thrown.
     */
    async disconnect() {
        if (!this.connected)
            return;
        for (const channel of this.subscriptions.keys()) {
            try {
                await this.subscribeClient.unsubscribe(channel);
            }
            catch {
                // ignore during shutdown
            }
        }
        this.subscriptions.clear();
        await Promise.all([
            this.publishClient?.quit().catch(() => { }),
            this.subscribeClient?.quit().catch(() => { }),
        ]);
        this.publishClient = null;
        this.subscribeClient = null;
        this.connected = false;
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
    async publish(channel, envelope) {
        if (!this.connected || !this.publishClient) {
            this.recordDrop(channel, `[signal-transport] not connected, skipping publish to ${channel} — `
                + `the event is LOST. Call connect() (or EventCatalog.connect()) and wait for it `
                + `to resolve before publishing.`);
            return;
        }
        await this.circuitBreaker.execute(async () => {
            const serialized = JSON.stringify(envelope);
            await this.publishClient.publish(channel, serialized);
            // Write to ring buffer (Redis Stream) for history inspection
            await this.publishClient.xAdd(`${channel}:history`, '*', { payload: serialized }, { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: this.ringBufferSize } }).catch((err) => {
                console.warn(`[signal-transport] ring buffer write failed for ${channel}:`, err.message);
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
    async publishChannelMessage(channelId, envelope) {
        if (!this.connected || !this.publishClient) {
            this.recordDrop(channelId, `[signal-transport] not connected, skipping channel-message publish to ${channelId} — `
                + `the message is LOST. Call connect() (or EventCatalog.connect()) and wait for it `
                + `to resolve before publishing.`);
            return 0;
        }
        return this.circuitBreaker.execute(async () => {
            const targetNodes = await this.publishClient.sMembers((0, envelopes_1.channelNodesRedisKey)(channelId));
            if (targetNodes.length === 0)
                return 0;
            // Populate targetNodes on the envelope if the caller didn't already.
            const finalEnvelope = envelope.targetNodes && envelope.targetNodes.length > 0
                ? envelope
                : { ...envelope, targetNodes };
            await this.publishClient.publish((0, envelopes_1.channelMessageRedisChannel)(channelId), JSON.stringify(finalEnvelope));
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
    async subscribe(channel, handler) {
        if (!this.connected || !this.subscribeClient) {
            throw new Error('[signal-transport] not connected — call connect() (or EventCatalog.connect()) '
                + `and await it before subscribing to "${channel}".`);
        }
        let handlers = this.subscriptions.get(channel);
        const isNewChannel = !handlers;
        if (!handlers) {
            handlers = new Set();
            this.subscriptions.set(channel, handlers);
        }
        handlers.add(handler);
        if (isNewChannel) {
            await this.subscribeClient.subscribe(channel, (message) => {
                try {
                    const envelope = JSON.parse(message);
                    const currentHandlers = this.subscriptions.get(channel);
                    if (currentHandlers) {
                        for (const h of currentHandlers) {
                            try {
                                h(envelope);
                            }
                            catch (err) {
                                console.error(`[signal-transport] handler error on ${channel}:`, err);
                            }
                        }
                    }
                }
                catch (err) {
                    console.error(`[signal-transport] deserialize error on ${channel}:`, err);
                }
            });
        }
        this.updateSubscriberCount(channel);
        return async () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.subscriptions.delete(channel);
                await this.subscribeClient?.unsubscribe(channel).catch(() => { });
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
    async getHistory(channel, count = 50) {
        if (!this.connected || !this.publishClient)
            return [];
        try {
            const entries = await this.publishClient.xRange(`${channel}:history`, '-', '+');
            const recent = entries.slice(-count);
            return recent.map(entry => {
                try {
                    return JSON.parse(entry.message.payload);
                }
                catch {
                    return null;
                }
            }).filter((e) => e !== null);
        }
        catch (err) {
            // An empty array reads as "this event has no recent messages", which is
            // a different fact from "Redis did not answer". Propagate so the caller
            // can say which one it is.
            throw new Error(`[signal-transport] history unavailable for "${channel}": `
                + (err instanceof Error ? err.message : String(err)), { cause: err });
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
    getMetrics(channel) {
        if (channel)
            return this.channelMetrics.get(channel);
        return new Map(this.channelMetrics);
    }
    /** Same as `getMetrics()` with no argument, but narrowly typed to the map. */
    getAllMetrics() {
        return new Map(this.channelMetrics);
    }
    getDroppedCount(channel) {
        if (channel !== undefined)
            return this.droppedCounts.get(channel) ?? 0;
        return new Map(this.droppedCounts);
    }
    /** True once `connect()` has resolved and before `disconnect()` is called. */
    isConnected() {
        return this.connected;
    }
    /**
     * PING the publish client. Never throws.
     *
     * `'disconnected'` = not connected or the ping errored; `'degraded'` =
     * the ping timed out after 2s or returned something other than PONG.
     */
    async healthCheck() {
        if (!this.connected || !this.publishClient) {
            return { status: 'disconnected', latencyMs: 0 };
        }
        const start = performance.now();
        try {
            const result = await Promise.race([
                this.publishClient.ping(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
            ]);
            const latencyMs = Math.round(performance.now() - start);
            if (result === 'PONG') {
                return { status: 'connected', latencyMs };
            }
            return { status: 'degraded', latencyMs };
        }
        catch (err) {
            const latencyMs = Math.round(performance.now() - start);
            if (err.message === 'timeout') {
                return { status: 'degraded', latencyMs };
            }
            return { status: 'disconnected', latencyMs };
        }
    }
    /**
     * Count a dropped publish and warn once per channel. The one-shot warn
     * keeps a hot broadcast path from flooding logs while a reconnect is in
     * flight; the counter keeps the drop visible for the whole process life.
     */
    recordDrop(channel, message) {
        this.droppedCounts.set(channel, (this.droppedCounts.get(channel) ?? 0) + 1);
        if (!this.warnedDisconnectedChannels.has(channel)) {
            this.warnedDisconnectedChannels.add(channel);
            console.warn(message);
        }
    }
    incrementMetrics(channel) {
        let metrics = this.channelMetrics.get(channel);
        if (!metrics) {
            metrics = { publishCount: 0, lastPublishedAt: null, subscriberCount: 0 };
            this.channelMetrics.set(channel, metrics);
        }
        metrics.publishCount++;
        metrics.lastPublishedAt = new Date().toISOString();
    }
    updateSubscriberCount(channel) {
        let metrics = this.channelMetrics.get(channel);
        if (!metrics) {
            metrics = { publishCount: 0, lastPublishedAt: null, subscriberCount: 0 };
            this.channelMetrics.set(channel, metrics);
        }
        metrics.subscriberCount = this.subscriptions.get(channel)?.size ?? 0;
    }
}
exports.SignalTransport = SignalTransport;
//# sourceMappingURL=signal.js.map