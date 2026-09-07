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
 * Correctness properties (see tests/replica-convergence.test.ts):
 *
 *  1. **Convergence.** Every mutation carries a Lamport-ish stamp
 *     `(ts, replicaId)` scoped to the thing it mutates (the event, its
 *     deprecation flag, or one subscriber edge). A replica applies an
 *     incoming mutation only when its stamp is strictly greater than the
 *     stamp it last applied to that key, comparing `ts` first and
 *     breaking ties on `replicaId`. Because the comparison is total and
 *     identical on every replica, concurrent writes to the same key
 *     settle on the same winner everywhere instead of each replica
 *     ending up holding the *other's* value.
 *
 *  2. **Ordering.** The same stamp rule makes re-ordered pairs
 *     (subscriber remove-before-add, undeprecate-before-deprecate)
 *     commutative. A mutation for an event this replica has never seen
 *     is parked in a small bounded buffer and replayed when that
 *     event's declare arrives, rather than being silently dropped.
 *
 *  3. **The compat gate.** A replicated declare runs the same
 *     schema-evolution check the HTTP route runs. Under strict
 *     enforcement a breaking replicated declare is refused and recorded
 *     as a conflict — replication can no longer install a schema the
 *     HTTP path would have rejected.
 *
 *  4. **Missed broadcasts.** Each replica numbers its own broadcasts.
 *     A gap in a peer's sequence means pub/sub dropped something (no
 *     replay, no delivery guarantee), so the replica marks itself stale
 *     and reloads the full registry from the shared Redis hash. `stale`
 *     stays set if that reload is impossible, so health can surface it
 *     instead of the replica serving a truncated registry as healthy.
 *
 * Fire-and-forget: broadcast failures are logged but never propagate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistryCoordinator = exports.MUTATIONS_CHANNEL = void 0;
const redis_1 = require("redis");
const redis_boot_strategy_js_1 = require("../utils/redis-boot-strategy.js");
exports.MUTATIONS_CHANNEL = 'event-catalog:mutations';
/** Cap on stamps retained. Bounded so a churning registry can't leak. */
const MAX_STAMPS = 20_000;
/** Cap on mutations parked waiting for their declare. */
const MAX_PENDING = 500;
/** How long a parked mutation waits for its declare before being dropped. */
const PENDING_TTL_MS = 60_000;
/** Ring size for the operator-visible conflict log. */
const MAX_CONFLICTS = 50;
/**
 * Total order over stamps: later `ts` wins, ties break on `replicaId`.
 * Identical on every replica, which is what makes concurrent writes
 * converge rather than mirror.
 */
function compareStamps(a, b) {
    if (a.ts !== b.ts)
        return a.ts < b.ts ? -1 : 1;
    if (a.replicaId === b.replicaId)
        return 0;
    return a.replicaId < b.replicaId ? -1 : 1;
}
/**
 * The conflict domain a mutation belongs to. Mutations sharing a key
 * are ordered against each other; mutations on different keys are
 * independent and never block one another.
 *
 * `declare` and `remove` share the event key (a remove must be able to
 * beat a stale declare). Deprecation and each subscriber edge get their
 * own key so an unrelated schema update never masks them.
 */
function conflictKey(kind, payload) {
    const p = payload;
    if (!p || typeof p !== 'object')
        return null;
    switch (kind) {
        case 'declare':
        case 'remove':
            return typeof p.name === 'string' ? `evt\x00${p.name}` : null;
        case 'deprecate':
        case 'undeprecate':
            return typeof p.name === 'string' ? `dep\x00${p.name}` : null;
        case 'subscriber.add':
        case 'subscriber.remove':
            return typeof p.eventName === 'string' && typeof p.serviceName === 'string'
                ? `sub\x00${p.eventName}\x00${p.serviceName}`
                : null;
        default:
            return null;
    }
}
/** The event name a mutation targets, for the parked-mutation buffer. */
function targetEvent(kind, payload) {
    const p = payload;
    if (!p || typeof p !== 'object')
        return null;
    if (kind === 'subscriber.add' || kind === 'subscriber.remove') {
        return typeof p.eventName === 'string' ? p.eventName : null;
    }
    return typeof p.name === 'string' ? p.name : null;
}
class RegistryCoordinator {
    replicaId = crypto.randomUUID();
    pubClient = null;
    subClient = null;
    _started = false;
    /** Our own broadcast counter, so peers can spot a gap. */
    seq = 0;
    /** Strictly-increasing stamp clock — never repeats within a replica. */
    lastTs = 0;
    /** Last seq observed per peer replica; a jump means messages were lost. */
    peerSeq = new Map();
    /** Last applied stamp per conflict key. */
    stamps = new Map();
    /** Mutations waiting for the declare of an event we haven't seen yet. */
    pending = [];
    conflicts = [];
    _stale = false;
    _resyncs = 0;
    /** True once a full-state read from shared storage has succeeded. */
    bootSynced = false;
    registry = null;
    get started() { return this._started; }
    /**
     * True when this replica is known to have missed at least one
     * broadcast and has not been able to repair itself from shared
     * state. A stale replica is serving a registry that may be missing
     * or holding outdated declarations.
     */
    isStale() { return this._stale; }
    /** Recent replication conflicts, newest last. For health/admin surfaces. */
    getConflicts() { return [...this.conflicts]; }
    getStats() {
        return {
            replicaId: this.replicaId,
            stale: this._stale,
            resyncs: this._resyncs,
            pending: this.pending.length,
            conflicts: this.conflicts.length,
        };
    }
    async start(redisUrl, registry) {
        if (this._started)
            return;
        this._started = true;
        this.registry = registry;
        // Boot-bounded reconnect — start() is fire-and-forget from createServer(),
        // so an unbounded first-connect retry would spin forever in the background
        // logging noise instead of failing once into the caller's catch.
        const pubBootStrategy = (0, redis_boot_strategy_js_1.createBootBoundedReconnectStrategy)({ label: 'coordinator pub' });
        const subBootStrategy = (0, redis_boot_strategy_js_1.createBootBoundedReconnectStrategy)({ label: 'coordinator sub' });
        this.pubClient = (0, redis_1.createClient)({
            url: redisUrl,
            socket: { reconnectStrategy: pubBootStrategy.reconnectStrategy },
        });
        this.subClient = (0, redis_1.createClient)({
            url: redisUrl,
            socket: { reconnectStrategy: subBootStrategy.reconnectStrategy },
        });
        this.pubClient.on('error', (err) => console.warn('[registry-coordinator] pub client error:', (0, redis_boot_strategy_js_1.formatRedisError)(err)));
        this.subClient.on('error', (err) => console.warn('[registry-coordinator] sub client error:', (0, redis_boot_strategy_js_1.formatRedisError)(err)));
        // A reconnect means the subscription was down for some interval and
        // pub/sub has no replay, so anything published in that window is
        // gone. Treat it exactly like a detected sequence gap.
        this.subClient.on('ready', () => {
            if (this.peerSeq.size > 0 || this._resyncs > 0) {
                this.markStale('sub client reconnected — messages during the outage are unrecoverable');
            }
        });
        await Promise.all([
            this.pubClient.connect().then(() => pubBootStrategy.markConnected()),
            this.subClient.connect().then(() => subBootStrategy.markConnected()),
        ]);
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
            this.observeTs(mutation.ts);
            this.trackSequence(mutation);
            this.receive(mutation, registry);
        });
        // Boot into an existing cluster: the subscription is live *before*
        // the full-state read, so nothing published during the read is
        // missed — it either lands in the snapshot or arrives as a
        // broadcast we apply on top of it.
        await this.resync('boot');
        console.log(`[registry-coordinator] replica ${this.replicaId.slice(0, 8)} subscribed to ${exports.MUTATIONS_CHANNEL}`);
    }
    async stop() {
        await Promise.allSettled([
            this.subClient?.quit(),
            this.pubClient?.quit(),
        ]);
        this.pubClient = null;
        this.subClient = null;
        this.registry = null;
        this._started = false;
    }
    /** Publish a mutation to all peer replicas. Never throws. */
    async broadcast(kind, payload) {
        if (!this.pubClient)
            return;
        // Stamp our own write first. The local registry has already applied
        // it, so recording the stamp here is what lets us reject a peer's
        // concurrent write that loses the tie-break.
        const ts = this.nextTs();
        const key = conflictKey(kind, payload);
        if (key)
            this.setStamp(key, { ts, replicaId: this.replicaId });
        const msg = {
            replicaId: this.replicaId,
            kind,
            payload,
            seq: ++this.seq,
            ts,
        };
        try {
            await this.pubClient.publish(exports.MUTATIONS_CHANNEL, JSON.stringify(msg));
        }
        catch (err) {
            console.warn('[registry-coordinator] broadcast failed:', err.message);
        }
    }
    /**
     * Reload the whole registry from the shared Redis hash. This is the
     * only repair path for a replica that missed broadcasts — pub/sub
     * itself offers no replay. Returns false when the registry has no
     * Redis backing, in which case the replica stays marked stale.
     */
    async resync(cause) {
        const registry = this.registry;
        if (!registry)
            return false;
        try {
            const ok = await registry.reload();
            if (!ok)
                return false;
            this.bootSynced = true;
            this._resyncs++;
            this._stale = false;
            // Applied state came wholesale from shared storage; the stamps we
            // were holding describe a history that snapshot supersedes.
            this.stamps.clear();
            this.pending = [];
            if (cause !== 'boot') {
                console.warn(`[registry-coordinator] resynced from shared registry (${cause})`);
            }
            return true;
        }
        catch (err) {
            console.warn('[registry-coordinator] resync failed:', err.message);
            return false;
        }
    }
    // ---------------------------------------------------------------
    // receive path
    // ---------------------------------------------------------------
    /**
     * Lamport clock. Wall time alone is not enough: two replicas writing
     * in the same millisecond would tie and fall through to the replicaId
     * tie-break, which can hand the win to a write that *causally
     * preceded* the other. Advancing our clock past every stamp we
     * observe means a write made after seeing a peer's write always
     * carries a strictly greater stamp.
     */
    nextTs() {
        const now = Date.now();
        this.lastTs = now > this.lastTs ? now : this.lastTs + 1;
        return this.lastTs;
    }
    observeTs(ts) {
        if (typeof ts === 'number' && ts > this.lastTs)
            this.lastTs = ts;
    }
    setStamp(key, stamp) {
        if (this.stamps.size >= MAX_STAMPS && !this.stamps.has(key)) {
            // Map preserves insertion order — drop the oldest entries. Losing
            // a stamp is safe (it degrades to last-write-wins for that key),
            // so a hard bound is preferable to unbounded growth.
            const oldest = this.stamps.keys().next();
            if (!oldest.done)
                this.stamps.delete(oldest.value);
        }
        this.stamps.set(key, stamp);
    }
    /**
     * Detect dropped messages. Redis pub/sub has no delivery guarantee
     * and no replay, so a gap in a peer's monotonic seq is the only
     * evidence we get that our registry is now incomplete.
     */
    trackSequence(mutation) {
        if (typeof mutation.seq !== 'number')
            return;
        const prev = this.peerSeq.get(mutation.replicaId);
        this.peerSeq.set(mutation.replicaId, mutation.seq);
        if (prev === undefined) {
            // First contact with this peer. seq is 1-based, so anything above
            // 1 means the peer published before we started listening. That is
            // only benign if our boot read of the shared registry covered it —
            // without shared storage there is nothing that could have.
            if (mutation.seq > 1 && !this.bootSynced) {
                this.markStale(`first message from replica ${mutation.replicaId.slice(0, 8)} is seq ${mutation.seq}`
                    + ' — earlier broadcasts were never received and there is no shared state to read');
            }
            return;
        }
        if (mutation.seq === prev + 1)
            return; // in order
        if (mutation.seq <= prev)
            return; // duplicate/reorder — stamps handle it
        this.markStale(`missed ${mutation.seq - prev - 1} broadcast(s) from replica ${mutation.replicaId.slice(0, 8)}`);
    }
    markStale(detail) {
        if (!this._stale)
            console.warn(`[registry-coordinator] stale: ${detail}`);
        this._stale = true;
        // Best-effort self-repair from the shared registry hash.
        void this.resync(detail);
    }
    recordConflict(c) {
        this.conflicts.push({ at: new Date().toISOString(), ...c });
        if (this.conflicts.length > MAX_CONFLICTS) {
            this.conflicts = this.conflicts.slice(-MAX_CONFLICTS);
        }
    }
    /** Full receive pipeline: order → gate → apply → drain parked. */
    receive(mutation, registry) {
        const key = conflictKey(mutation.kind, mutation.payload);
        if (key === null) {
            // Unknown kind, or a payload missing the fields that identify what
            // it mutates. Nothing safe to do with it.
            if (!isKnownKind(mutation.kind)) {
                console.warn('[registry-coordinator] unknown mutation kind:', mutation.kind);
            }
            else {
                console.warn('[registry-coordinator] malformed mutation payload:', mutation.kind);
            }
            return;
        }
        // A peer running a build that predates stamping sends no `ts`. Its
        // messages cannot be ordered against ours, and dropping them would
        // be worse than the arrival-order behaviour they were written for,
        // so apply them as-is and leave the stamp untouched. Only relevant
        // during a rolling upgrade.
        const incoming = typeof mutation.ts === 'number'
            ? { ts: mutation.ts, replicaId: mutation.replicaId }
            : null;
        const held = incoming && this.stamps.get(key);
        if (incoming && held && compareStamps(incoming, held) <= 0) {
            // We already applied a write that wins the total order. Dropping
            // is what makes concurrent writes converge — but if the loser
            // carried a different schema, two replicas genuinely disagreed
            // about a contract and an operator should see it.
            this.recordConflict({
                reason: 'stale-write',
                kind: mutation.kind,
                key,
                fromReplica: mutation.replicaId,
                detail: 'lost the (ts, replicaId) tie-break against the locally applied write',
            });
            return;
        }
        // A mutation for an event we've never seen can't be applied yet:
        // Redis pub/sub does not order across publishers, so its declare
        // may still be in flight. Park it rather than dropping it.
        if (mutation.kind !== 'declare' && mutation.kind !== 'remove') {
            const name = targetEvent(mutation.kind, mutation.payload);
            if (name && !registry.get(name)) {
                this.park(mutation);
                return;
            }
        }
        if (!this.applyMutation(mutation, registry))
            return;
        if (incoming)
            this.setStamp(key, incoming);
        if (mutation.kind === 'declare') {
            const name = targetEvent('declare', mutation.payload);
            if (name)
                this.drainPending(name, registry);
        }
    }
    park(mutation) {
        this.pending.push({ mutation, parkedAt: Date.now() });
        if (this.pending.length > MAX_PENDING) {
            const dropped = this.pending.shift();
            if (dropped) {
                this.recordConflict({
                    reason: 'pending-expired',
                    kind: dropped.mutation.kind,
                    key: conflictKey(dropped.mutation.kind, dropped.mutation.payload) ?? '?',
                    fromReplica: dropped.mutation.replicaId,
                    detail: 'parked-mutation buffer overflowed before the declare arrived',
                });
            }
        }
    }
    /** Replay parked mutations whose event just showed up, in arrival order. */
    drainPending(name, registry) {
        if (this.pending.length === 0)
            return;
        const now = Date.now();
        const keep = [];
        const ready = [];
        for (const p of this.pending) {
            if (now - p.parkedAt > PENDING_TTL_MS) {
                this.recordConflict({
                    reason: 'pending-expired',
                    kind: p.mutation.kind,
                    key: conflictKey(p.mutation.kind, p.mutation.payload) ?? '?',
                    fromReplica: p.mutation.replicaId,
                    detail: 'declare never arrived within the parking window',
                });
                continue;
            }
            if (targetEvent(p.mutation.kind, p.mutation.payload) === name)
                ready.push(p.mutation);
            else
                keep.push(p);
        }
        this.pending = keep;
        for (const m of ready)
            this.receive(m, registry);
    }
    /**
     * Run the same schema-evolution gate the HTTP declare route runs.
     * Without this, replication is a way around the one guarantee this
     * service exists to provide: a breaking schema refused with a 409 on
     * replica A could still be installed on replica B by broadcast.
     */
    passesCompatGate(entry, registry, fromReplica) {
        const existing = registry.get(entry.name);
        if (!existing)
            return true;
        const schema = entry.schema;
        if (!schema || Object.keys(schema).length === 0)
            return true;
        if (JSON.stringify(existing.schema) === JSON.stringify(schema))
            return true;
        const strict = existing.compatMode === 'strict'
            || (existing.compatMode !== 'off' && process.env.EVENT_CATALOG_STRICT === 'true');
        if (!strict)
            return true;
        const compat = registry.checkSchemaCompat(entry.name, schema);
        if (compat.compatible)
            return true;
        this.recordConflict({
            reason: 'compat-violation',
            kind: 'declare',
            key: `evt\x00${entry.name}`,
            fromReplica,
            detail: compat.violations.join('; '),
        });
        console.warn(`[registry-coordinator] refused replicated declare for "${entry.name}" — `
            + `strict compat violation: ${compat.violations.join('; ')}`);
        return false;
    }
    /** Returns true when the mutation was actually applied. */
    applyMutation(mutation, registry) {
        try {
            switch (mutation.kind) {
                case 'declare': {
                    const entry = mutation.payload;
                    if (!this.passesCompatGate(entry, registry, mutation.replicaId))
                        return false;
                    const known = registry.get(entry.name);
                    registry.declare(entry);
                    // Registry.declare builds a *fresh* entry when the event is
                    // new, deliberately resetting subscribers/history/metadata.
                    // On the replication path the payload is an already-populated
                    // peer entry, so that reset would silently drop the peer's
                    // subscriber list. Re-apply it.
                    if (!known)
                        this.adoptReplicatedFields(entry, registry);
                    return true;
                }
                case 'deprecate': {
                    const { name, opts } = mutation.payload;
                    return registry.deprecate(name, opts);
                }
                case 'undeprecate':
                    registry.undeprecate(mutation.payload.name);
                    return true;
                case 'subscriber.add': {
                    const { eventName, serviceName } = mutation.payload;
                    registry.addSubscriber(eventName, serviceName);
                    return true;
                }
                case 'subscriber.remove': {
                    const { eventName, serviceName } = mutation.payload;
                    registry.removeSubscriber(eventName, serviceName);
                    return true;
                }
                case 'remove':
                    registry.remove(mutation.payload.name);
                    return true;
                default:
                    console.warn('[registry-coordinator] unknown mutation kind:', mutation.kind);
                    return false;
            }
        }
        catch (err) {
            console.warn('[registry-coordinator] failed to apply remote mutation:', err.message, mutation.kind);
            return false;
        }
    }
    /**
     * Carry over the fields Registry.declare resets for a brand-new
     * event. Only for first-sight replicated entries — never for a local
     * declare, where the reset is the intended behaviour.
     */
    adoptReplicatedFields(source, registry) {
        const created = registry.get(source.name);
        if (!created)
            return;
        if (Array.isArray(source.subscribers)) {
            for (const s of source.subscribers)
                registry.addSubscriber(source.name, s);
        }
        if (Array.isArray(source.schemaHistory) && source.schemaHistory.length > 0) {
            created.schemaHistory = source.schemaHistory;
        }
        if (typeof source.version === 'number')
            created.version = source.version;
        if (source.deprecation)
            created.deprecation = source.deprecation;
    }
}
exports.RegistryCoordinator = RegistryCoordinator;
function isKnownKind(kind) {
    return kind === 'declare' || kind === 'deprecate' || kind === 'undeprecate'
        || kind === 'subscriber.add' || kind === 'subscriber.remove' || kind === 'remove';
}
//# sourceMappingURL=registry-coordinator.js.map