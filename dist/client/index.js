"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventCatalog = void 0;
const ulid_1 = require("ulid");
const RetryManager_1 = require("distributed-core/dist/transport/RetryManager");
const index_1 = require("../registry/index");
const signal_1 = require("./signal");
const durable_1 = require("./durable");
const envelopes_1 = require("../types/envelopes");
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
    /**
     * Register an event with the local registry. In strict mode
     * (`config.strict === true` or `EVENT_CATALOG_STRICT=true`), throws
     * when the new schema breaks compatibility against the registered
     * history. Otherwise the violation is non-fatal — callers may inspect
     * the catalog's logs or the server's `GET /api/events/:name/schema/check`
     * endpoint.
     */
    declare(event) {
        const result = this.registry.declare(event);
        if (this.isStrict() && !result.compatible) {
            const violations = result.violations?.join('; ') ?? 'unknown';
            throw new Error(`[event-catalog] declare("${event.name}") rejected by strict mode: ${violations}`);
        }
    }
    isStrict() {
        if (typeof this.config.strict === 'boolean')
            return this.config.strict;
        return process.env.EVENT_CATALOG_STRICT === 'true';
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
        // Discriminator validation (Phase E3.6) — when a declaration carries
        // `discriminator: { field, values }`, the payload's value at `field`
        // must be one of the declared values. Catches sub-type drift at
        // publish time, e.g. ingest:progress carries 10 sub-shapes via
        // payload.type.
        if (entry.discriminator) {
            const { field, values } = entry.discriminator;
            const actual = payload?.[field];
            if (typeof actual !== 'string' || !values.includes(actual)) {
                throw new Error(`[event-catalog] discriminator validation failed for "${eventName}": `
                    + `payload.${field}=${JSON.stringify(actual)} is not in declared values [${values.join(', ')}]`);
            }
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
            // Phase E3.4 — 'both' fan-out: publish to signal AND durable in
            // parallel. Failure of either propagates after both are attempted so
            // partial deliveries are not silently masked.
            const queueName = entry.queue ?? durable_1.DurableTransport.eventNameToQueueName(eventName);
            // Phase 4.2 — thread the declared durable-side config so
            // DurableTransport.ensureQueue can PUT the right shape on first publish.
            const queueOptions = {
                retention: entry.retention,
                fifo: entry.fifo,
                dlqAfterAttempts: entry.dlqAfterAttempts,
            };
            const sends = [];
            if (entry.transport === 'signal' || entry.transport === 'both') {
                sends.push(this.signal.publish(eventName, envelope));
            }
            if (entry.transport === 'durable' || entry.transport === 'both') {
                sends.push(this.durable.publish(queueName, envelope, queueOptions));
            }
            const results = await Promise.allSettled(sends);
            const rejection = results.find((r) => r.status === 'rejected');
            if (rejection && rejection.status === 'rejected') {
                throw rejection.reason;
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
    /**
     * Channel-scoped signal publish for the websocket-gateway broadcast path
     * (wave1-ec-3).
     *
     * Differs from `publish(eventName, payload)` in two ways:
     *   1. Targets a specific channel (room/document/etc.) rather than the
     *      bare event-name as a pub/sub channel. The envelope is published
     *      to `websocket:route:{channelId}` and addressed to the gateway
     *      nodes registered in `websocket:channel:{channelId}:nodes`.
     *   2. Wraps the payload in the gateway's `ChannelMessageEnvelope` /
     *      `SignalMessage` shape so the gateway's MessageRouter can fan it
     *      out to local WebSocket subscribers without reshaping.
     *
     * Schema enforcement (wave1-ec-3 P0):
     *   - If the event IS declared, payload is validated against the
     *     declared JSON schema. Validation failures throw — same as
     *     `publish()`. This is the whole point of routing through the
     *     catalog instead of writing directly to Redis.
     *   - If the event is NOT declared, a warning is logged but the
     *     publish proceeds. Strict-mode rejection of undeclared events is
     *     deferred to a later wave (MQ-7 / EC-7 strict mode).
     *
     * @returns number of gateway nodes the envelope was addressed to (0
     *   when no listeners are registered).
     */
    async publishSignal(channelId, eventName, payload, options) {
        const entry = this.registry.get(eventName);
        if (entry) {
            const validation = this.registry.validate(eventName, payload);
            if (!validation.valid) {
                const msgs = validation.errors?.map((e) => e.message).join(', ') ?? 'unknown error';
                throw new Error(`[event-catalog] publishSignal payload validation failed for "${eventName}": ${msgs}`);
            }
            if (entry.discriminator) {
                const { field, values } = entry.discriminator;
                const actual = payload?.[field];
                if (typeof actual !== 'string' || !values.includes(actual)) {
                    throw new Error(`[event-catalog] publishSignal discriminator validation failed for "${eventName}": `
                        + `payload.${field}=${JSON.stringify(actual)} is not in declared values [${values.join(', ')}]`);
                }
            }
        }
        else {
            console.warn(`[event-catalog] publishSignal called with undeclared event "${eventName}" — `
                + `emitting without schema validation. Declare it via catalog.declare() to enforce schema.`);
        }
        const timestamp = options?.timestamp !== undefined
            ? new Date(options.timestamp).toISOString()
            : new Date().toISOString();
        const envelope = (0, envelopes_1.buildChannelMessageEnvelope)({
            channel: channelId,
            message: (0, envelopes_1.buildSignalMessage)({
                eventName,
                channel: channelId,
                payload,
                timestamp,
            }),
            fromNode: this.config.serviceName,
            timestamp,
        });
        const delivered = await this.signal.publishChannelMessage(channelId, envelope);
        if (entry) {
            this.registry.updateStats(eventName, {
                lastPublishedAt: new Date().toISOString(),
                publishCount: (entry.metadata.publishCount ?? 0) + 1,
            });
        }
        return delivered;
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