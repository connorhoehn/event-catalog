"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalTransport = void 0;
const redis_1 = require("redis");
const transport_1 = require("distributed-core/transport");
const envelopes_1 = require("../types/envelopes");
class SignalTransport {
    publishClient = null;
    subscribeClient = null;
    url;
    ringBufferSize;
    connected = false;
    subscriptions = new Map();
    channelMetrics = new Map();
    circuitBreaker;
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
    async connect() {
        if (this.connected)
            return;
        await this.circuitBreaker.execute(async () => {
            this.publishClient = (0, redis_1.createClient)({ url: this.url });
            this.subscribeClient = (0, redis_1.createClient)({ url: this.url });
            this.publishClient.on('error', (err) => {
                console.warn('[signal-transport] publish client error:', err.message);
            });
            this.subscribeClient.on('error', (err) => {
                console.warn('[signal-transport] subscribe client error:', err.message);
            });
            await Promise.all([
                this.publishClient.connect(),
                this.subscribeClient.connect(),
            ]);
        });
        this.connected = true;
    }
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
    async publish(channel, envelope) {
        if (!this.connected || !this.publishClient) {
            console.warn(`[signal-transport] not connected, skipping publish to ${channel}`);
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
     * Returns the number of target nodes the envelope was addressed to.
     */
    async publishChannelMessage(channelId, envelope) {
        if (!this.connected || !this.publishClient) {
            console.warn(`[signal-transport] not connected, skipping channel-message publish to ${channelId}`);
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
    async subscribe(channel, handler) {
        if (!this.connected || !this.subscribeClient) {
            throw new Error('[signal-transport] not connected');
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
        catch {
            return [];
        }
    }
    getMetrics(channel) {
        if (channel)
            return this.channelMetrics.get(channel);
        return new Map(this.channelMetrics);
    }
    getAllMetrics() {
        return new Map(this.channelMetrics);
    }
    isConnected() {
        return this.connected;
    }
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