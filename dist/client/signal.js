"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalTransport = void 0;
const redis_1 = require("redis");
const CircuitBreaker_1 = require("distributed-core/dist/transport/CircuitBreaker");
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
        this.circuitBreaker = new CircuitBreaker_1.CircuitBreaker({
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