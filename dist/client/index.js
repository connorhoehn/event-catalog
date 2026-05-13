"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventCatalog = void 0;
const ulid_1 = require("ulid");
const RetryManager_1 = require("distributed-core/dist/transport/RetryManager");
const index_1 = require("../registry/index");
const signal_1 = require("./signal");
const durable_1 = require("./durable");
class EventCatalog {
    config;
    registry;
    signal;
    durable;
    syncRetryManager;
    connected = false;
    resyncInterval = null;
    constructor(config) {
        this.config = config;
        this.registry = new index_1.Registry();
        this.signal = new signal_1.SignalTransport({ url: config.redis.url });
        this.durable = new durable_1.DurableTransport({ url: config.messageQueue.url });
        this.syncRetryManager = new RetryManager_1.RetryManager({
            maxRetries: 2,
            baseDelay: 1000,
            backoffFactor: 2,
            jitter: false,
            enableLogging: false,
            name: 'catalog-registry-sync',
        });
    }
    async connect() {
        if (this.connected)
            return;
        await Promise.all([
            this.signal.connect(),
            this.durable.connect(),
        ]);
        this.connected = true;
        if (this.config.registryUrl) {
            try {
                await this.syncRetryManager.execute(() => this.syncToRemoteRegistry());
            }
            catch {
                console.warn('[event-catalog] registry sync failed after retries, scheduling background retry');
                this.scheduleBackgroundSync();
            }
            this.resyncInterval = setInterval(() => {
                this.syncToRemoteRegistry().catch(err => {
                    console.warn('[event-catalog] periodic re-sync failed:', err.message);
                });
            }, 60_000);
        }
    }
    async disconnect() {
        if (!this.connected)
            return;
        if (this.resyncInterval) {
            clearInterval(this.resyncInterval);
            this.resyncInterval = null;
        }
        await Promise.all([
            this.signal.disconnect(),
            this.durable.disconnect(),
        ]);
        this.connected = false;
    }
    declare(event) {
        this.registry.declare(event);
    }
    async publish(eventName, payload, options) {
        const entry = this.registry.get(eventName);
        if (!entry) {
            throw new Error(`[event-catalog] event "${eventName}" is not declared. Call declare() first.`);
        }
        // Validate payload against schema
        const validation = this.registry.validate(eventName, payload);
        if (!validation.valid) {
            const msgs = validation.errors?.map(e => e.message).join(', ') ?? 'unknown error';
            throw new Error(`[event-catalog] payload validation failed for "${eventName}": ${msgs}`);
        }
        const metadata = {
            id: (0, ulid_1.ulid)(),
            producer: this.config.serviceName,
            timestamp: options?.timestamp ?? Date.now(),
            correlationId: options?.correlationId,
            headers: options?.headers,
        };
        const envelope = {
            eventName,
            payload,
            metadata,
        };
        try {
            if (entry.transport === 'signal') {
                await this.signal.publish(eventName, envelope);
            }
            else {
                const queueName = durable_1.DurableTransport.eventNameToQueueName(eventName);
                await this.durable.publish(queueName, envelope);
            }
            this.registry.updateStats(eventName, {
                lastPublishedAt: new Date().toISOString(),
                publishCount: (entry.metadata.publishCount ?? 0) + 1,
            });
        }
        catch (err) {
            this.registry.updateStats(eventName, {
                errorCount: (entry.metadata.errorCount ?? 0) + 1,
            });
            throw err;
        }
    }
    subscribe(eventName, handler, options) {
        const entry = this.registry.get(eventName);
        if (!entry) {
            throw new Error(`[event-catalog] event "${eventName}" is not declared. Call declare() first.`);
        }
        this.registry.addSubscriber(eventName, this.config.serviceName);
        // Notify remote catalog (non-blocking, fault-tolerant)
        this.registerSubscriberRemote(eventName).catch(err => {
            console.warn(`[event-catalog] failed to register subscriber with remote registry for "${eventName}":`, err.message);
        });
        if (entry.transport === 'signal') {
            let unsubFn = null;
            const setupPromise = this.signal.subscribe(eventName, (envelope) => {
                handler(envelope);
            }).then(unsub => {
                unsubFn = unsub;
            });
            return {
                unsubscribe: async () => {
                    await setupPromise;
                    if (unsubFn)
                        await unsubFn();
                    this.deregisterSubscriberRemote(eventName).catch(err => {
                        console.warn(`[event-catalog] failed to deregister subscriber from remote registry for "${eventName}":`, err.message);
                    });
                },
            };
        }
        else {
            const queueName = durable_1.DurableTransport.eventNameToQueueName(eventName);
            const cancel = this.durable.subscribe(queueName, async (envelope) => {
                await handler(envelope);
            }, {
                pollingInterval: options?.pollingInterval,
                batchSize: options?.batchSize,
                visibilityTimeout: options?.visibilityTimeout,
            });
            return {
                unsubscribe: async () => {
                    cancel();
                    this.deregisterSubscriberRemote(eventName).catch(err => {
                        console.warn(`[event-catalog] failed to deregister subscriber from remote registry for "${eventName}":`, err.message);
                    });
                },
            };
        }
    }
    getRegistry() {
        return this.registry;
    }
    getSignalTransport() {
        return this.signal;
    }
    getDurableTransport() {
        return this.durable;
    }
    isConnected() {
        return this.connected;
    }
    scheduleBackgroundSync() {
        const attempt = (delay) => {
            setTimeout(() => {
                if (!this.connected || !this.config.registryUrl)
                    return;
                this.syncToRemoteRegistry().catch(() => {
                    const nextDelay = Math.min(delay * 2, 60_000);
                    console.warn(`[event-catalog] background sync retry failed, next attempt in ${nextDelay}ms`);
                    attempt(nextDelay);
                });
            }, delay);
        };
        attempt(5_000);
    }
    async syncToRemoteRegistry() {
        const entries = this.registry.list();
        if (entries.length === 0)
            return;
        const url = `${this.config.registryUrl}/api/events/bulk`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serviceName: this.config.serviceName,
                events: entries.map(e => ({
                    name: e.name,
                    schema: e.schema,
                    transport: e.transport,
                    producer: e.producer,
                    description: e.description,
                    tags: e.tags,
                })),
            }),
        });
    }
    async registerSubscriberRemote(eventName) {
        if (!this.config.registryUrl)
            return;
        const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}/subscribers`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serviceName: this.config.serviceName }),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
    }
    async deregisterSubscriberRemote(eventName) {
        if (!this.config.registryUrl)
            return;
        const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}/subscribers/${encodeURIComponent(this.config.serviceName)}`;
        const res = await fetch(url, {
            method: 'DELETE',
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
    }
}
exports.EventCatalog = EventCatalog;
//# sourceMappingURL=index.js.map