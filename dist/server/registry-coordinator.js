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
 *     What is tracked is a *high-water mark*, not the last seq seen: a
 *     redelivery carries a lower number and must not look like a gap.
 *     Repair is coalesced and backed off (`requestResync`) — one reload
 *     at a time, spacing that doubles under repeated gaps — because the
 *     reload clears every stamp and every parked mutation, so doing it
 *     per missed message degrades convergence to last-write-wins.
 *
 *  5. **Bounded on hostile input.** Every field of a broadcast is chosen
 *     by the publisher, and anything that can reach the same Redis can
 *     publish. So each structure keyed off that input has a ceiling: the
 *     message itself (`MAX_MUTATION_BYTES`, matching the HTTP body
 *     limit), the stamp map (`MAX_STAMPS`), the parked buffer (bounded
 *     in *both* entries and bytes, and swept on a timer rather than only
 *     when a declare happens to arrive), and the peer sequence table
 *     (`MAX_PEERS`, aged out least-recently-seen first). Every one of
 *     them reports what it dropped rather than dropping it silently.
 *
 * Fire-and-forget: broadcast failures are logged but never propagate.
 *
 * Known limits (see tests/fuzz-replica-convergence.test.ts, which
 * generates the interleavings rather than enumerating them):
 *
 *  - **Deletes do not fully converge.** `remove` destroys the whole
 *    entry, and a `subscriber.add` made concurrently with it carries a
 *    *higher* wall-clock stamp while being causally unrelated. A scalar
 *    (ts, replicaId) clock cannot tell that apart from an add that
 *    genuinely followed the delete, so a replica that applied the add
 *    first and one that applied the delete first can end up disagreeing
 *    about that event's subscriber list. The tombstone below contains
 *    it: the disagreement stays inside the deleted event and never
 *    spreads to events that were never removed. Closing it properly
 *    needs causality metadata (a version vector) this design does not
 *    carry.
 *
 *  - **A gap on first contact with a peer is invisible.** A replica's
 *    first sight of a peer at seq > 1 looks identical whether messages
 *    were dropped or the peer was simply already running when we
 *    joined. Once the boot read of the shared hash has succeeded the
 *    benign reading is assumed, because the alternative is every new
 *    replica reloading the registry the instant it hears a busy peer.
 *    The one exception is when the peer table has evicted a peer that
 *    was still talking: that is the case where "first contact" might be
 *    our own forgetting, so `forgotLivePeer` turns the assumption off
 *    until the next successful reload.
 *
 *  - **Timestamps are per-replica.** `metadata.createdAt`,
 *    `deprecation.deprecatedAt` and `schemaHistory[].updatedAt` are
 *    stamped by whichever replica applied the mutation. The broadcast
 *    payload carries no authoritative value for the first two, so they
 *    differ between replicas by construction. The semantic content does
 *    not.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistryCoordinator = exports.MAX_MUTATION_BYTES = exports.MUTATIONS_CHANNEL = void 0;
const redis_1 = require("redis");
const redis_boot_strategy_js_1 = require("../utils/redis-boot-strategy.js");
const bounded_js_1 = require("../utils/bounded.js");
const logger_js_1 = require("../utils/logger.js");
exports.MUTATIONS_CHANNEL = 'event-catalog:mutations';
/** Cap on stamps retained. Bounded so a churning registry can't leak. */
const MAX_STAMPS = 20_000;
/** Cap on mutations parked waiting for their declare. */
const MAX_PENDING = 500;
/**
 * Byte ceiling on the parked buffer.
 *
 * `MAX_PENDING` bounds *slots*, and a slot retains the peer's payload
 * verbatim — a `deprecate.reason`, a schema, a service name — none of
 * which the replication path length-checks. 500 slots is a memory bound
 * only if the payload is bounded, so the buffer is bounded twice: by
 * entries and by the bytes those entries actually hold.
 */
const MAX_PENDING_BYTES = 2 * 1024 * 1024;
/**
 * Largest single broadcast this replica will parse.
 *
 * The HTTP path reads bodies under `MAX_REQUEST_BODY_BYTES` (1 MiB); the
 * broadcast path had no equivalent, so a peer — or anything else able to
 * reach the same Redis — could hand every replica an arbitrarily large
 * string to parse and retain. Same number, same reason.
 */
exports.MAX_MUTATION_BYTES = 1_048_576;
/** How long a parked mutation waits for its declare before being dropped. */
const PENDING_TTL_MS = 60_000;
/**
 * How often the parked buffer is swept while it holds anything. The TTL
 * has to be enforced by something that runs on its own — see
 * `ensurePendingSweep`.
 */
const PENDING_SWEEP_MS = 10_000;
/** Ring size for the operator-visible conflict log. */
const MAX_CONFLICTS = 50;
/**
 * Cap on the per-peer sequence table. A real cluster has one entry per
 * live pod; anything approaching this is a peer minting a fresh
 * `replicaId` per message.
 */
const MAX_PEERS = 512;
/**
 * How long a peer's high-water mark is kept after its last message.
 * Pub/sub delivery is milliseconds, so a sequence number this old cannot
 * be used to detect a gap in anything still in flight — forgetting it
 * loses nothing.
 */
const PEER_IDLE_TTL_MS = 15 * 60_000;
/** Floor on the interval between self-repair reloads, and its ceiling. */
const RESYNC_MIN_INTERVAL_MS = 1_000;
const RESYNC_MAX_INTERVAL_MS = 60_000;
/** Quiet period after which the resync backoff decays back to immediate. */
const RESYNC_BACKOFF_RESET_MS = 5 * 60_000;
/**
 * Retained size of a parked payload, in JSON characters.
 *
 * Only ever called on the park path, which is rare, so the extra
 * `stringify` costs nothing on the hot path. A throw (a payload with a
 * cycle cannot come off `JSON.parse`, but the type says `unknown`) is
 * charged the whole budget so the entry is dropped rather than retained
 * unmeasured.
 */
function payloadBytes(payload) {
    try {
        return JSON.stringify(payload)?.length ?? 0;
    }
    catch {
        return MAX_PENDING_BYTES;
    }
}
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
/**
 * Rate ceiling on the coordinator's diagnostics.
 *
 * Everything below the `start()` banner is on a message path: a Redis
 * client error re-fires on every reconnect attempt, and `receive` /
 * `applyMutation` run once per broadcast from every peer — which for a
 * peer running a build that emits malformed payloads is one line per
 * mutation, cluster-wide, forever. Keyed by failure shape so a broken
 * `declare` and a broken `subscriber.add` are both visible.
 */
const COORDINATOR_LOG_WINDOW_MS = 60_000;
const COORDINATOR_LOGS_PER_WINDOW = 8;
/**
 * Close a Redis client without being able to hang.
 *
 * `quit()` is graceful: it waits for the connection to be usable so it can
 * send QUIT. `start()` is fire-and-forget, so when Redis was never reachable
 * the client is still mid-connect and `quit()` never resolves — which hung
 * `stop()`, and through it the whole server `shutdown()`, at roughly one boot
 * in two. `disconnect()` tears the socket down immediately and is the correct
 * call for a connection that never came up; we try the graceful path first and
 * fall back on timeout or error.
 */
async function closeRedis(client) {
    if (!client)
        return;
    let timer;
    try {
        await Promise.race([
            client.quit(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('quit timed out')), REDIS_QUIT_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
    }
    catch {
        // Graceful close was impossible — force it. Already-closed throws here too,
        // which is fine: the goal is "no live handle", not "closed politely".
        await client.disconnect().catch(() => { });
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/** Ceiling on the graceful half of {@link closeRedis}. */
const REDIS_QUIT_TIMEOUT_MS = 2_000;
class RegistryCoordinator {
    replicaId = crypto.randomUUID();
    log;
    warnings = new bounded_js_1.LogThrottle({
        keyIntervalMs: COORDINATOR_LOG_WINDOW_MS,
        maxPerWindow: COORDINATOR_LOGS_PER_WINDOW,
        maxKeys: 128,
    });
    /**
     * @param logger diagnostics sink; omitted, every line below goes to
     *   `console.warn` / `console.log` exactly as before.
     */
    constructor(logger) {
        this.log = new logger_js_1.LogWriter(logger);
    }
    /**
     * Emit one throttled warning, tagged with this replica's id.
     *
     * The suppressed-count suffix is inserted *before* a trailing colon so
     * a line whose detail is passed as a second console argument still
     * reads `… failed (+3 similar suppressed): detail`. With nothing
     * suppressed the suffix is empty and the message is byte-identical to
     * what the call site emitted before it was throttled.
     */
    warn(key, message, fields, ...tail) {
        const suppressed = this.warnings.attempt(key);
        if (suppressed === null)
            return;
        const suffix = bounded_js_1.LogThrottle.suffix(suppressed);
        const text = message.endsWith(':')
            ? message.slice(0, -1) + suffix + ':'
            : message + suffix;
        this.log.warn(text, { component: 'registry-coordinator', replicaId: this.replicaId, ...fields, suppressed }, ...tail);
    }
    pubClient = null;
    subClient = null;
    _started = false;
    /** Our own broadcast counter, so peers can spot a gap. */
    seq = 0;
    /** Strictly-increasing stamp clock — never repeats within a replica. */
    lastTs = 0;
    /**
     * Last seq observed per peer replica; a jump means messages were lost.
     * Bounded by `MAX_PEERS` and aged out at `PEER_IDLE_TTL_MS`, in
     * least-recently-seen order — see `rememberPeer`.
     */
    peerSeq = new Map();
    /** Peers dropped under capacity pressure, not because they went idle. */
    _peersForgotten = 0;
    /**
     * Set when a *live* peer was evicted for capacity. While it is set, a
     * first-contact message at seq > 1 is no longer assumed benign — the
     * peer may be one we forgot. Cleared by the resync that repairs it.
     */
    forgotLivePeer = false;
    /** Last applied stamp per conflict key. */
    stamps = new Map();
    /** Mutations waiting for the declare of an event we haven't seen yet. */
    pending = [];
    /** Running sum of `pending[].bytes`, kept in step by `setPending`/`park`. */
    pendingBytes = 0;
    /** Sweeps the parked buffer's TTL; only alive while something is parked. */
    pendingSweep = null;
    conflicts = [];
    _stale = false;
    _resyncs = 0;
    /** Repair requests folded into a reload that was already happening. */
    _resyncsCoalesced = 0;
    /** The reload currently running, if any — a second one never starts. */
    resyncInFlight = null;
    /** Cause of the one follow-up reload queued behind the in-flight one. */
    resyncQueued = null;
    resyncTimer = null;
    /** Current minimum spacing between reloads; doubles, decays when quiet. */
    resyncBackoffMs = 0;
    lastResyncAt = 0;
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
    /**
     * `pendingBytes`, `peers` and `peersForgotten` exist so the two bounds
     * that can silently degrade behaviour are visible rather than
     * inferred: a parked buffer trimmed for memory, and a peer whose
     * high-water mark was dropped (which resets gap detection for it).
     */
    getStats() {
        return {
            replicaId: this.replicaId,
            stale: this._stale,
            resyncs: this._resyncs,
            resyncsCoalesced: this._resyncsCoalesced,
            pending: this.pending.length,
            pendingBytes: this.pendingBytes,
            peers: this.peerSeq.size,
            peersForgotten: this._peersForgotten,
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
        this.pubClient.on('error', (err) => this.warnRedisClient('pub', err));
        this.subClient.on('error', (err) => this.warnRedisClient('sub', err));
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
            // Size gate *before* the parse. The HTTP path refuses an oversized
            // body without reading it; this is the same refusal for the one
            // input that never goes through HTTP. Deliberately not tracked as a
            // sequence: the message is unread, so we do not know its seq — and
            // that is the honest outcome, because the peer's next in-order
            // message will show the hole and trigger a (coalesced, backed-off)
            // repair, which is exactly what a mutation we could not apply
            // should do.
            if (message.length > exports.MAX_MUTATION_BYTES) {
                this.recordConflict({
                    reason: 'oversized',
                    kind: 'declare',
                    key: '?',
                    fromReplica: 'unknown',
                    detail: `broadcast of ${message.length} chars exceeds the ${exports.MAX_MUTATION_BYTES}-byte limit`,
                });
                this.warn('oversized', '[registry-coordinator] refused an oversized broadcast:', { action: 'receive', status: 'refused', size: message.length, limit: exports.MAX_MUTATION_BYTES }, `${message.length} chars`);
                return;
            }
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
        this.log.info(`[registry-coordinator] replica ${this.replicaId.slice(0, 8)} subscribed to ${exports.MUTATIONS_CHANNEL}`, {
            component: 'registry-coordinator',
            replicaId: this.replicaId,
            channel: exports.MUTATIONS_CHANNEL,
            action: 'subscribed',
        });
    }
    /**
     * Redis client errors arrive once per failed reconnect attempt on each
     * of the two clients, so they are throttled per role. The message keeps
     * its two-argument console shape.
     */
    warnRedisClient(role, err) {
        const detail = (0, redis_boot_strategy_js_1.formatRedisError)(err);
        const suppressed = this.warnings.attempt(`client:${role}`);
        if (suppressed === null)
            return;
        this.log.warn(`[registry-coordinator] ${role} client error` + bounded_js_1.LogThrottle.suffix(suppressed) + ':', {
            component: 'registry-coordinator',
            replicaId: this.replicaId,
            role,
            error: detail,
            suppressed,
        }, detail);
    }
    /**
     * Release everything this replica holds on behalf of the cluster.
     *
     * Both timers are cleared here and nulled, not merely cancelled: an
     * interval that outlives `stop()` keeps the event loop alive, so
     * SIGTERM stops shutting the container down and the orchestrator falls
     * back to SIGKILL. The maps are dropped for the same reason a restart
     * should not inherit them — a coordinator restarted in-process would
     * otherwise carry a stale peer table and parked mutations whose
     * declares were addressed to a previous life.
     */
    async stop() {
        this.stopPendingSweep();
        if (this.resyncTimer) {
            clearTimeout(this.resyncTimer);
            this.resyncTimer = null;
        }
        this.resyncQueued = null;
        await Promise.allSettled([
            closeRedis(this.subClient),
            closeRedis(this.pubClient),
        ]);
        this.pubClient = null;
        this.subClient = null;
        this.registry = null;
        this.peerSeq.clear();
        this.setPending([]);
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
        if (key) {
            this.setStamp(key, {
                ts,
                replicaId: this.replicaId,
                ...(kind === 'remove' ? { removed: true } : {}),
            });
        }
        // A local delete destroys the entry and everything hanging off it,
        // so anything we parked waiting for that event is now unreplayable.
        if (kind === 'remove')
            this.purgePending(targetEvent(kind, payload));
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
            this.warn('broadcast', '[registry-coordinator] broadcast failed:', { action: 'broadcast', kind, error: (0, logger_js_1.errorMessage)(err) }, err.message);
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
            // The snapshot is authoritative for everything a forgotten peer's
            // messages could have carried, so it also repairs whatever
            // dropping that peer's high-water mark cost us.
            this.forgotLivePeer = false;
            // Applied state came wholesale from shared storage; the stamps we
            // were holding describe a history that snapshot supersedes.
            this.stamps.clear();
            this.setPending([]);
            if (cause !== 'boot') {
                this.warn('resynced', `[registry-coordinator] resynced from shared registry (${cause})`, { action: 'resync', status: 'recovered', cause, resyncs: this._resyncs });
            }
            return true;
        }
        catch (err) {
            this.warn('resync-failed', '[registry-coordinator] resync failed:', { action: 'resync', status: 'failed', cause, error: (0, logger_js_1.errorMessage)(err) }, err.message);
            return false;
        }
    }
    // ---------------------------------------------------------------
    // self-repair scheduling
    // ---------------------------------------------------------------
    /**
     * Ask for a repair reload, at most one at a time and no faster than
     * the current backoff allows.
     *
     * A reload is an `HGETALL` of the entire registry hash plus a wholesale
     * rebuild of the event map, and it clears every stamp and every parked
     * mutation on the way through — which means that while reloads are
     * happening, conflict resolution has no history to resolve against and
     * degrades to last-write-wins. Firing one per missed broadcast turns a
     * flaky peer into a self-inflicted outage: the audit's 500 gapped
     * messages produced 500 full reloads.
     *
     * Two mechanisms, doing different jobs:
     *
     *  - **Coalescing.** A reload already in flight absorbs any request
     *    that arrives while it runs. At most one follow-up is queued behind
     *    it — one is enough, because the follow-up reads the *current*
     *    snapshot, which already reflects every mutation the coalesced
     *    requests were complaining about.
     *  - **Backoff.** The first gap after a quiet period repairs
     *    immediately, because that is the common case and delaying it just
     *    serves a truncated registry for longer. Each further reload
     *    doubles the minimum spacing to `RESYNC_MAX_INTERVAL_MS`, and the
     *    spacing decays back to zero once `RESYNC_BACKOFF_RESET_MS` passes
     *    without one.
     *
     * The replica stays flagged stale for the whole deferral, so a health
     * check never reads "fine" while a repair is still pending.
     */
    requestResync(cause) {
        if (!this.registry)
            return;
        const now = Date.now();
        // Quiet for long enough that whatever caused the last storm is over.
        if (this.resyncBackoffMs > 0 && now - this.lastResyncAt >= RESYNC_BACKOFF_RESET_MS) {
            this.resyncBackoffMs = 0;
        }
        if (this.resyncInFlight) {
            this._resyncsCoalesced++;
            this.resyncQueued ??= cause;
            return;
        }
        if (this.resyncTimer) {
            this._resyncsCoalesced++;
            return;
        }
        const wait = Math.max(0, this.lastResyncAt + this.resyncBackoffMs - now);
        if (wait === 0) {
            void this.runResync(cause);
            return;
        }
        this._resyncsCoalesced++;
        this.resyncTimer = setTimeout(() => {
            this.resyncTimer = null;
            void this.runResync(cause);
        }, wait);
        this.resyncTimer.unref?.();
    }
    /** One reload, with the in-flight latch and the backoff bookkeeping. */
    async runResync(cause) {
        const running = this.resync(cause);
        this.resyncInFlight = running;
        try {
            await running;
        }
        finally {
            this.resyncInFlight = null;
            this.lastResyncAt = Date.now();
            this.resyncBackoffMs = this.resyncBackoffMs === 0
                ? RESYNC_MIN_INTERVAL_MS
                : Math.min(this.resyncBackoffMs * 2, RESYNC_MAX_INTERVAL_MS);
        }
        const queued = this.resyncQueued;
        this.resyncQueued = null;
        // Re-enters the scheduler rather than running directly, so the
        // follow-up is spaced by the backoff like any other request.
        if (queued !== null && this._started)
            this.requestResync(queued);
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
        const now = Date.now();
        this.prunePeers(now);
        const prev = this.peerSeq.get(mutation.replicaId);
        if (prev === undefined) {
            this.rememberPeer(mutation.replicaId, mutation.seq, now);
            // First contact with this peer. seq is 1-based, so anything above
            // 1 means the peer published before we started listening. That is
            // only benign if our boot read of the shared registry covered it —
            // without shared storage there is nothing that could have. It is
            // also only benign if we have not *forgotten* a live peer, because
            // then "first contact" may just be us having dropped its mark.
            if (mutation.seq > 1 && (!this.bootSynced || this.forgotLivePeer)) {
                this.markStale(`first message from replica ${mutation.replicaId.slice(0, 8)} is seq ${mutation.seq}`
                    + (this.bootSynced
                        ? ' — and a live peer was evicted from the sequence table, so this may be a resumed stream'
                        : ' — earlier broadcasts were never received and there is no shared state to read'));
            }
            return;
        }
        // What we hold is a *high-water mark*, not "the last seq seen". A
        // redelivery or a message that overtook a newer one carries a seq at
        // or below it and must leave it alone: writing the lower value back
        // would make the next in-order message look like a gap and send a
        // perfectly healthy replica through a full registry reload. It still
        // counts as contact, so the LRU position is refreshed either way.
        if (mutation.seq <= prev.seq) {
            this.rememberPeer(mutation.replicaId, prev.seq, now);
            return; // duplicate/reorder — stamps handle it
        }
        this.rememberPeer(mutation.replicaId, mutation.seq, now);
        if (mutation.seq === prev.seq + 1)
            return; // in order
        this.markStale(`missed ${mutation.seq - prev.seq - 1} broadcast(s) from replica ${mutation.replicaId.slice(0, 8)}`);
    }
    /**
     * Drop peers we have not heard from in `PEER_IDLE_TTL_MS`.
     *
     * The map is kept in least-recently-seen order, so the expired entries
     * are a prefix and the scan stops at the first live one — this is O(1)
     * on every message that evicts nothing, which is every message in a
     * healthy cluster.
     *
     * Aging out costs no gap detection. A high-water mark is only useful
     * against a message still in flight, and pub/sub latency is
     * milliseconds; nothing arriving fifteen minutes later could have been
     * ordered against it anyway. Only the capacity path in `rememberPeer`
     * can forget a peer that is still talking, and that path says so.
     */
    prunePeers(now) {
        for (const [id, peer] of this.peerSeq) {
            if (now - peer.seenAt <= PEER_IDLE_TTL_MS)
                break;
            this.peerSeq.delete(id);
        }
    }
    /**
     * Record a peer's high-water mark, keeping the table bounded and in
     * least-recently-seen order (delete-then-set moves a key to the end).
     *
     * Eviction under capacity pressure is the one case that can forget a
     * peer still publishing, and it is the case that must not be silent —
     * forgetting a mark resets gap detection for that peer, which is the
     * mechanism that repairs divergence in the first place. So it is
     * counted in `getStats().peersForgotten`, warned about, and latched in
     * `forgotLivePeer` so the next unexplained first-contact is treated as
     * a possible gap rather than assumed benign.
     *
     * In practice the LRU order means a real cluster never reaches this:
     * `MAX_PEERS` is far above any pod count, idle pods age out first, and
     * the ids that a flood mints are seen exactly once, so they sit at the
     * head of the LRU and evict each other rather than the live peers.
     */
    rememberPeer(id, seq, now) {
        if (!this.peerSeq.has(id) && this.peerSeq.size >= MAX_PEERS) {
            const oldest = this.peerSeq.entries().next();
            if (!oldest.done) {
                const [victimId, victim] = oldest.value;
                this.peerSeq.delete(victimId);
                this._peersForgotten++;
                // Only a peer we heard from recently is a real loss; an entry
                // that survived `prunePeers` but is still old carries nothing.
                if (now - victim.seenAt <= PEER_IDLE_TTL_MS)
                    this.forgotLivePeer = true;
                this.warn('peer-evicted', '[registry-coordinator] sequence table full — forgot a peer:', {
                    action: 'track-sequence',
                    status: 'evicted',
                    peer: victimId.slice(0, 8),
                    peers: this.peerSeq.size,
                    peersForgotten: this._peersForgotten,
                }, victimId.slice(0, 8));
            }
        }
        this.peerSeq.delete(id);
        this.peerSeq.set(id, { seq, seenAt: now });
    }
    markStale(detail) {
        // Guarded on the stale latch, so this is one line per healthy→stale
        // transition rather than one per missed broadcast.
        if (!this._stale) {
            this.log.warn(`[registry-coordinator] stale: ${detail}`, {
                component: 'registry-coordinator',
                replicaId: this.replicaId,
                status: 'stale',
                detail,
            });
        }
        this._stale = true;
        // Best-effort self-repair from the shared registry hash — coalesced
        // and rate-limited, so a peer that keeps skipping sequence numbers
        // cannot turn every gap into a full reload.
        this.requestResync(detail);
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
                this.warn(`unknown-kind:${String(mutation.kind)}`, '[registry-coordinator] unknown mutation kind:', { action: 'receive', kind: mutation.kind, fromReplica: mutation.replicaId }, mutation.kind);
            }
            else {
                this.warn(`malformed:${String(mutation.kind)}`, '[registry-coordinator] malformed mutation payload:', { action: 'receive', kind: mutation.kind, fromReplica: mutation.replicaId }, mutation.kind);
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
        // may still be in flight. Park it rather than dropping it — unless
        // we have a tombstone, in which case the event is not "not here
        // yet", it is gone, and holding the edit would let it re-attach
        // itself to a future incarnation of the event that never had it.
        if (mutation.kind !== 'declare' && mutation.kind !== 'remove') {
            const name = targetEvent(mutation.kind, mutation.payload);
            if (name && !registry.get(name)) {
                if (this.stamps.get(`evt\x00${name}`)?.removed) {
                    this.recordConflict({
                        reason: 'stale-write',
                        kind: mutation.kind,
                        key,
                        fromReplica: mutation.replicaId,
                        detail: `event "${name}" was removed — the edit died with it`,
                    });
                    // Stamp the discard. A decision to throw a mutation away is
                    // only safe if a redelivery of that same mutation reaches the
                    // same decision, and after the event is re-declared the
                    // tombstone is gone — so without this the copy Redis sends
                    // again would be applied.
                    if (incoming)
                        this.setStamp(key, incoming);
                    return;
                }
                this.park(mutation);
                return;
            }
        }
        if (!this.applyMutation(mutation, registry))
            return;
        if (incoming) {
            this.setStamp(key, mutation.kind === 'remove' ? { ...incoming, removed: true } : incoming);
        }
        if (mutation.kind === 'remove') {
            this.purgePending(targetEvent('remove', mutation.payload));
        }
        if (mutation.kind === 'declare') {
            const name = targetEvent('declare', mutation.payload);
            if (name)
                this.drainPending(name, registry);
        }
    }
    /**
     * Forget everything parked for an event that has just been deleted.
     *
     * Without this a `subscriber.add` that was waiting for its declare
     * survives the delete and is replayed by the *next* declare of the
     * same name, re-attaching a consumer to a fresh incarnation of the
     * event that never had it — and only on the replicas that happened to
     * have parked it, which is a divergence.
     */
    /**
     * The only place `pending` is replaced wholesale. It keeps the byte
     * total in step and retires the sweep timer once nothing is parked —
     * the alternative is a timer that ticks for the life of the process
     * over an empty array.
     */
    setPending(next) {
        this.pending = next;
        let bytes = 0;
        for (const p of next)
            bytes += p.bytes;
        this.pendingBytes = bytes;
        if (next.length === 0)
            this.stopPendingSweep();
    }
    purgePending(name) {
        if (!name || this.pending.length === 0)
            return;
        const keep = [];
        for (const p of this.pending) {
            if (targetEvent(p.mutation.kind, p.mutation.payload) !== name) {
                keep.push(p);
                continue;
            }
            const key = conflictKey(p.mutation.kind, p.mutation.payload);
            this.recordConflict({
                reason: 'stale-write',
                kind: p.mutation.kind,
                key: key ?? '?',
                fromReplica: p.mutation.replicaId,
                detail: `event "${name}" was removed while this edit was parked`,
            });
            // Same reason as the tombstone discard above: record the stamp so
            // a redelivery of this mutation is refused rather than applied to
            // the next incarnation of the event.
            if (key && typeof p.mutation.ts === 'number') {
                this.setStamp(key, { ts: p.mutation.ts, replicaId: p.mutation.replicaId });
            }
        }
        this.setPending(keep);
    }
    /**
     * Park a mutation whose declare has not arrived, under two bounds.
     *
     * `MAX_PENDING` bounds how many mutations can be waiting; the byte
     * budget bounds what those slots are allowed to *hold*, because the
     * payload is the peer's and nothing on this path checks its field
     * lengths. Both trim oldest-first, and both record what they dropped —
     * a mutation thrown away silently is the same divergence as one never
     * received.
     */
    park(mutation) {
        const bytes = payloadBytes(mutation.payload);
        this.pending.push({ mutation, parkedAt: Date.now(), bytes });
        this.pendingBytes += bytes;
        while (this.pending.length > 0
            && (this.pending.length > MAX_PENDING || this.pendingBytes > MAX_PENDING_BYTES)) {
            const dropped = this.pending.shift();
            if (!dropped)
                break;
            this.pendingBytes -= dropped.bytes;
            this.recordConflict({
                reason: 'pending-expired',
                kind: dropped.mutation.kind,
                key: conflictKey(dropped.mutation.kind, dropped.mutation.payload) ?? '?',
                fromReplica: dropped.mutation.replicaId,
                detail: this.pending.length >= MAX_PENDING
                    ? 'parked-mutation buffer overflowed before the declare arrived'
                    : 'parked-mutation buffer exceeded its byte budget before the declare arrived',
            });
        }
        if (this.pending.length === 0)
            this.pendingBytes = 0;
        this.ensurePendingSweep();
    }
    /**
     * Enforce the parking TTL without waiting for a message.
     *
     * `drainPending` also applies the TTL, but it only runs when a
     * `declare` broadcast arrives — so on a cluster that goes quiet,
     * parked mutations were held indefinitely and `PENDING_TTL_MS` meant
     * nothing. The interval exists only while something is parked, is
     * unref'd so it never holds the process open on its own, and is
     * cleared by `stop()`.
     */
    ensurePendingSweep() {
        if (this.pendingSweep !== null || this.pending.length === 0)
            return;
        this.pendingSweep = setInterval(() => this.sweepPending(), PENDING_SWEEP_MS);
        this.pendingSweep.unref?.();
    }
    stopPendingSweep() {
        if (this.pendingSweep === null)
            return;
        clearInterval(this.pendingSweep);
        this.pendingSweep = null;
    }
    /** Drop every parked mutation whose declare never turned up in time. */
    sweepPending() {
        if (this.pending.length === 0) {
            this.stopPendingSweep();
            return;
        }
        const now = Date.now();
        const keep = [];
        for (const p of this.pending) {
            if (this.expired(p, now))
                continue;
            keep.push(p);
        }
        this.setPending(keep);
    }
    /** TTL check plus the conflict record, shared by the sweep and the drain. */
    expired(p, now) {
        if (now - p.parkedAt <= PENDING_TTL_MS)
            return false;
        this.recordConflict({
            reason: 'pending-expired',
            kind: p.mutation.kind,
            key: conflictKey(p.mutation.kind, p.mutation.payload) ?? '?',
            fromReplica: p.mutation.replicaId,
            detail: 'declare never arrived within the parking window',
        });
        return true;
    }
    /** Replay parked mutations whose event just showed up, in arrival order. */
    drainPending(name, registry) {
        if (this.pending.length === 0)
            return;
        const now = Date.now();
        const keep = [];
        const ready = [];
        for (const p of this.pending) {
            if (this.expired(p, now))
                continue;
            if (targetEvent(p.mutation.kind, p.mutation.payload) === name)
                ready.push(p.mutation);
            else
                keep.push(p);
        }
        this.setPending(keep);
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
        this.warn(`compat:${entry.name}`, `[registry-coordinator] refused replicated declare for "${entry.name}" — `
            + `strict compat violation: ${compat.violations.join('; ')}`, {
            action: 'declare',
            status: 'refused',
            eventName: entry.name,
            fromReplica,
            violations: compat.violations,
        });
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
                    // Registry.declare *derives* version and schemaHistory from
                    // the local prior schema. On the replication path that is the
                    // wrong source: the payload is the peer's finished entry and
                    // already carries the authoritative values, and re-deriving
                    // them leaves two replicas holding the same schema under
                    // different version numbers and different histories. Take the
                    // peer's. Subscribers and deprecation are adopted only for a
                    // brand-new entry — they have their own conflict keys, and
                    // unioning a stale declare's subscriber list would resurrect
                    // consumers a newer subscriber.remove already retired.
                    this.adoptReplicatedFields(entry, registry, !known);
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
                    this.warn(`apply-unknown-kind:${String(mutation.kind)}`, '[registry-coordinator] unknown mutation kind:', { action: 'apply', kind: mutation.kind, fromReplica: mutation.replicaId }, mutation.kind);
                    return false;
            }
        }
        catch (err) {
            this.warn(`apply-failed:${mutation.kind}`, '[registry-coordinator] failed to apply remote mutation:', {
                action: 'apply',
                status: 'failed',
                kind: mutation.kind,
                fromReplica: mutation.replicaId,
                error: (0, logger_js_1.errorMessage)(err),
            }, err.message, mutation.kind);
            return false;
        }
    }
    /**
     * Carry over the fields Registry.declare would otherwise derive from
     * local state. Never called for a local declare, where deriving them
     * is the intended behaviour.
     *
     * `version` and `schemaHistory` are adopted on every replicated
     * declare so the winning entry looks identical everywhere. The rest
     * — subscribers, deprecation — is adopted only when the entry is
     * brand-new here, because Registry.declare resets those for a fresh
     * entry and the peer's payload is the only copy we have. For an entry
     * we already hold, those fields are owned by their own mutation kinds
     * and their own conflict keys.
     *
     * A peer on a build that predates a field simply omits it, so each
     * adoption is guarded on the value actually being present.
     */
    adoptReplicatedFields(source, registry, firstSight) {
        const created = registry.get(source.name);
        if (!created)
            return;
        if (Array.isArray(source.schemaHistory)) {
            created.schemaHistory = source.schemaHistory;
        }
        if (typeof source.version === 'number')
            created.version = source.version;
        if (!firstSight)
            return;
        if (Array.isArray(source.subscribers)) {
            for (const s of source.subscribers)
                registry.addSubscriber(source.name, s);
        }
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