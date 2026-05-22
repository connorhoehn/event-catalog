"use strict";
/**
 * RegistryCoordinator — multi-replica convergence via Redis pub/sub.
 *
 * Every catalog server instance broadcasts mutations (declare, deprecate,
 * subscriber-add, etc.) to the `event-catalog:mutations` channel. All
 * other replicas receive the message and apply it to their in-process
 * registry, converging within the Redis pub/sub latency (~1ms LAN).
 *
 * Reads are always served from the local in-process map — no Redis hop.
 * A replica ignores its own broadcasts via the per-process replicaId.
 *
 * Fire-and-forget: broadcast failures are logged but never propagate.
 * If a replica misses a message it will re-sync on the next declare from
 * any service (which is idempotent).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistryCoordinator = exports.MUTATIONS_CHANNEL = void 0;
const redis_1 = require("redis");
exports.MUTATIONS_CHANNEL = 'event-catalog:mutations';
class RegistryCoordinator {
    replicaId = crypto.randomUUID();
    pubClient = null;
    subClient = null;
    _started = false;
    get started() { return this._started; }
    async start(redisUrl, registry) {
        if (this._started)
            return;
        this._started = true;
        this.pubClient = (0, redis_1.createClient)({ url: redisUrl });
        this.subClient = (0, redis_1.createClient)({ url: redisUrl });
        this.pubClient.on('error', (err) => console.warn('[registry-coordinator] pub client error:', err.message));
        this.subClient.on('error', (err) => console.warn('[registry-coordinator] sub client error:', err.message));
        await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
        await this.subClient.subscribe(exports.MUTATIONS_CHANNEL, (message) => {
            let mutation;
            try {
                mutation = JSON.parse(message);
            }
            catch {
                return;
            }
            // Skip our own broadcasts — already applied locally.
            if (mutation.replicaId === this.replicaId)
                return;
            this.applyMutation(mutation, registry);
        });
        console.log(`[registry-coordinator] replica ${this.replicaId.slice(0, 8)} subscribed to ${exports.MUTATIONS_CHANNEL}`);
    }
    async stop() {
        await Promise.allSettled([
            this.subClient?.quit(),
            this.pubClient?.quit(),
        ]);
        this.pubClient = null;
        this.subClient = null;
        this._started = false;
    }
    /** Publish a mutation to all peer replicas. Never throws. */
    async broadcast(kind, payload) {
        if (!this.pubClient)
            return;
        const msg = { replicaId: this.replicaId, kind, payload };
        try {
            await this.pubClient.publish(exports.MUTATIONS_CHANNEL, JSON.stringify(msg));
        }
        catch (err) {
            console.warn('[registry-coordinator] broadcast failed:', err.message);
        }
    }
    applyMutation(mutation, registry) {
        try {
            switch (mutation.kind) {
                case 'declare':
                    registry.declare(mutation.payload);
                    break;
                case 'deprecate': {
                    const { name, opts } = mutation.payload;
                    registry.deprecate(name, opts);
                    break;
                }
                case 'undeprecate':
                    registry.undeprecate(mutation.payload.name);
                    break;
                case 'subscriber.add': {
                    const { eventName, serviceName } = mutation.payload;
                    registry.addSubscriber(eventName, serviceName);
                    break;
                }
                case 'subscriber.remove': {
                    const { eventName, serviceName } = mutation.payload;
                    registry.removeSubscriber(eventName, serviceName);
                    break;
                }
                case 'remove':
                    registry.remove(mutation.payload.name);
                    break;
                default:
                    console.warn('[registry-coordinator] unknown mutation kind:', mutation.kind);
            }
        }
        catch (err) {
            console.warn('[registry-coordinator] failed to apply remote mutation:', err.message, mutation.kind);
        }
    }
}
exports.RegistryCoordinator = RegistryCoordinator;
//# sourceMappingURL=registry-coordinator.js.map