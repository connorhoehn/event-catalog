import { RetryManager } from 'distributed-core/transport';
import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport, parseSubscriptionHandle } from './durable';
import {
  buildChannelMessageEnvelope,
  buildSignalMessage,
} from '../types/envelopes';
import type {
  EventCatalogConfig,
  EventDeclaration,
  EventEnvelope,
  EventHandler,
  EventMetadata,
  NamespacePolicy,
  PublishOptions,
  Subscription,
  SubscribeOptions,
} from '../types/index';
import type { ResolveResult, ValidationResult } from '../registry/types';
import type { RegistryEntry } from '../types/index';
import { resolveNamespace } from '../registry/namespace';
import { eventId, nowIso } from '../utils/hot-path';
import { BoundedCounter, LogThrottle } from '../utils/bounded';
import { LogWriter, errorMessage, type CatalogLogger, type LogFields } from '../utils/logger';

/** Re-exported so consumers can type a logger without reaching into a subpath. */
export type { CatalogLogger, LogFields } from '../utils/logger';
import type { EventPayloadMap } from '../generated/event-types';

/**
 * Cap on per-event-name bookkeeping.
 *
 * `publishSignal()` takes an event name straight from the caller and does
 * not require it to be declared — the websocket-gateway forwards client
 * frame types through it. That key space is bounded by nothing: a typo in
 * a retry loop, or a client sending unknown frame types, grows these maps
 * for the life of the process.
 */
const MAX_TRACKED_EVENT_NAMES = 1000;

/**
 * Payload type for a declared event name, or `unknown` for a name the
 * generated map doesn't know about. Drives the typed `publish()` overload.
 */
type PayloadFor<K> = K extends keyof EventPayloadMap ? EventPayloadMap[K] : unknown;

/** Cap on how much of an offending value we splice into an error message. */
const MAX_VALUE_PREVIEW = 120;

/**
 * Render the value that failed validation, short enough to sit in a log
 * line. Undefined renders as `undefined` (not omitted) because "the field
 * is missing" is the single most common cause.
 */
function previewValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_VALUE_PREVIEW
    ? `${text.slice(0, MAX_VALUE_PREVIEW)}…`
    : text;
}

/** Read `payload.a.b[0]` from a dotted/bracketed validator path. */
function valueAtPath(payload: unknown, path: string): unknown {
  if (!path) return payload;
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    // Split trailing array indices: `items[2]` → `items`, `2`.
    const parts = segment.split('[');
    for (const raw of parts) {
      const key = raw.endsWith(']') ? raw.slice(0, -1) : raw;
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

/**
 * Turn a `ValidationResult` into a message a human can act on without
 * opening the schema: which event, which field, what was wrong, and what
 * was actually there.
 *
 * Bad:  `payload validation failed for "orders:created": expected type number, got string`
 * Good: `payload validation failed for "orders:created" (1 problem):
 *        payload.total — expected type number, got string (was "12")`
 */
function formatValidationFailure(
  prefix: string,
  eventName: string,
  validation: ValidationResult,
  payload: unknown,
  entry: RegistryEntry | undefined,
): string {
  const errors = validation.errors ?? [];
  const details = errors.length === 0
    ? 'unknown error (the validator reported a failure with no details)'
    : errors
      .map((e) => {
        const where = e.path ? `payload.${e.path}` : 'payload';
        const actual = e.path !== undefined
          ? ` (was ${previewValue(valueAtPath(payload, e.path))})`
          : '';
        return `${where} — ${e.message}${actual}`;
      })
      .join('; ');

  const problems = errors.length === 1 ? '1 problem' : `${errors.length} problems`;
  const context = entry
    ? ` [schema v${entry.version}, fingerprint ${entry.schemaFingerprint.slice(0, 12)}, `
      + `declared by ${Array.isArray(entry.producer) ? entry.producer.join('/') : entry.producer}]`
    : '';

  return `[event-catalog] ${prefix} for "${eventName}" (${problems}): ${details}.${context}`;
}

/**
 * Cheap edit-distance-ish scorer for "did you mean…?". Only ever runs on
 * an error path, and only over the local registry, so the O(n·m) cost is
 * irrelevant. Bounded so a pathological name can't blow up.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s.length > 200 || t.length > 200) return 0;
  // Normalizing separators makes `pipeline.run.started` a near-match for
  // `pipeline:run:started` — the single most common mistake in this repo.
  const ns = s.replace(/[.:_-]/g, '');
  const nt = t.replace(/[.:_-]/g, '');
  if (ns === nt) return 0.99;

  const rows = ns.length + 1;
  const cols = nt.length + 1;
  let prev = new Array<number>(cols);
  let curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = ns[i - 1] === nt[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const distance = prev[cols - 1];
  return 1 - distance / Math.max(ns.length, nt.length, 1);
}

/**
 * Suggest up to two declared names close to `name`. Colon/dot confusion
 * and typos are the usual cause of an "is not declared" at 3am, and the
 * registry already knows the right answer.
 */
/** Human-readable runtime type, for "expected a string, got …" messages. */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Fail fast on a blank transport URL. A missing env var otherwise shows up
 * as `redis://undefined` or a fetch to `/api/v1/queues` on the current
 * host, minutes later and nowhere near the cause.
 */
function requireConfigValue(value: string | undefined, field: string, envVar?: string): void {
  if (typeof value === 'string' && value.trim() !== '') return;
  const from = envVar ? ` (normally read from the ${envVar} env var)` : '';
  throw new Error(
    `[event-catalog] EventCatalog config is missing "${field}"${from}. `
    + `Received ${previewValue(value)}.`,
  );
}

function suggestNames(name: string, candidates: string[]): string[] {
  return candidates
    .map((candidate) => ({ candidate, score: similarity(name, candidate) }))
    .filter((s) => s.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.candidate);
}

/**
 * Phase E3.3 — resolve the Redis channel an event publishes on.
 *
 *   - `undefined` channel → default to the event name (preserves v0.1 behavior).
 *   - `string` channel    → literal pattern.
 *   - `function` channel  → call with the payload (per-publish destinations,
 *     e.g. `p => \`document:${p.documentId}\``).
 */
function resolveSignalChannel(
  declared: string | ((payload: unknown) => string) | undefined,
  eventName: string,
  payload: unknown,
): string {
  if (declared === undefined) return eventName;
  if (typeof declared === 'string') return declared;
  return declared(payload);
}

/**
 * Subscribe-side resolver. Static channels only — a function-typed `channel`
 * means the destination is per-payload, which `subscribe()` cannot honor
 * without a payload to evaluate against.
 */
function resolveStaticSignalChannel(
  declared: string | ((payload: unknown) => string) | undefined,
  eventName: string,
): string {
  if (declared === undefined) return eventName;
  if (typeof declared === 'string') return declared;
  throw new Error(
    `[event-catalog] cannot subscribe to "${eventName}": its declared channel is a function `
    + `(per-payload). Declare a static channel string, or subscribe directly via the `
    + `SignalTransport with a Redis pattern subscription.`,
  );
}

/**
 * Phase 20-h — merge a namespace policy's defaults into a declaration
 * for any field the declaration didn't set explicitly. Per-event values
 * always win. Returns a new declaration object (does not mutate the
 * input — important for callers that re-use shared declaration arrays).
 *
 * If no policy is registered for the event's namespace, returns the
 * input unchanged.
 */
function applyNamespacePolicy(
  event: EventDeclaration,
  policies: Record<string, NamespacePolicy> | undefined,
): EventDeclaration {
  if (!policies || Object.keys(policies).length === 0) return event;
  const ns = resolveNamespace(event.name, event.namespace);
  const policy = policies[ns];
  if (!policy) return event;

  const merged: EventDeclaration = { ...event };
  if (merged.compatibilityMode === undefined && policy.compatibilityMode !== undefined) {
    merged.compatibilityMode = policy.compatibilityMode;
  }
  if (merged.retention === undefined && policy.retention !== undefined) {
    merged.retention = policy.retention;
  }
  if (merged.dlqRetention === undefined && policy.dlqRetention !== undefined) {
    merged.dlqRetention = policy.dlqRetention;
  }
  if (merged.dlqAfterAttempts === undefined && policy.dlqAfterAttempts !== undefined) {
    merged.dlqAfterAttempts = policy.dlqAfterAttempts;
  }
  if (policy.tags && policy.tags.length > 0) {
    const existingTags = new Set(merged.tags ?? []);
    for (const t of policy.tags) existingTags.add(t);
    merged.tags = [...existingTags];
  }
  return merged;
}

/**
 * A publish that was discarded before it reached a transport, rather than
 * throwing. Today the only cause is a signal publish issued while the
 * Redis transport is disconnected.
 */
export interface DroppedPublish {
  eventName: string;
  transport: 'signal';
  reason: 'transport-not-connected';
  /** The envelope that was lost, so a caller can buffer or re-emit it. */
  envelope: EventEnvelope;
  /**
   * Set for `publishSignal()` drops — the channel the message was
   * addressed to. Absent for `publish()` drops.
   */
  channelId?: string;
}

/**
 * `EventCatalogConfig` plus the client-only knobs that govern what happens
 * when a publish cannot be delivered.
 *
 * Additive: every field is optional and the defaults preserve the
 * historical behaviour, so existing `EventCatalogConfig` objects remain
 * valid without change.
 */
export interface EventCatalogClientOptions extends EventCatalogConfig {
  /**
   * Called for every publish discarded because the signal transport was
   * not connected. Without this, such a publish resolves normally and the
   * only trace is a one-shot `console.warn` plus the drop counters.
   *
   * Exceptions thrown here are caught and logged; they never fail the
   * publish. Wire it to a metric or a retry buffer.
   */
  onPublishDropped?(drop: DroppedPublish): void;

  /**
   * When true, `publish()` and `publishSignal()` **reject** instead of
   * dropping when the signal transport is disconnected — matching what
   * the durable transport already does.
   *
   * Defaults to `false` to preserve the v0.x contract. Prefer turning this
   * on in any service where a lost realtime event is worse than a rejected
   * request.
   */
  strictTransport?: boolean;

  /**
   * Shared secret presented as `Authorization: Bearer <token>` on the
   * mutating registry calls this client makes (`syncToRemoteRegistry`,
   * the subscriber heartbeat, subscriber registration, `pinManifest`).
   *
   * v0.5.0 added optional bearer auth to the *server*
   * (`EVENT_CATALOG_AUTH_TOKEN`, see `src/server/auth.ts`) which challenges
   * every non-GET on `/api`. Without a matching credential here, switching
   * that on would 401 every producer's boot-time sync and heartbeat — and
   * because the library never blocks on the registry, each service would
   * still report healthy while the inventory silently emptied out. This is
   * the client half of that feature.
   *
   * Defaults to `process.env.EVENT_CATALOG_AUTH_TOKEN`. Unset — the
   * default, and what an unauthenticated server expects — means no
   * `Authorization` header is sent and the requests are byte-for-byte what
   * they were before v0.5.0.
   */
  authToken?: string;

  /**
   * Sink for the library's own diagnostics — the lines this client, the
   * signal transport and the durable transport emit about dropped
   * publishes, failed registry syncs, backpressure, poll errors and
   * dead-lettered messages.
   *
   * Two required methods, one optional, all taking
   * `(message, fields?)`, so adapting a host logger is a literal:
   *
   * ```ts
   * new EventCatalog({
   *   ...config,
   *   logger: {
   *     warn: (msg, fields) => log.warn(fields ?? {}, msg),
   *     error: (msg, fields) => log.error(fields ?? {}, msg),
   *   },
   * });
   * ```
   *
   * `fields` carries the structured half of the line — `eventName`,
   * `channel`, `queue`, `attempt`, `status`, `suppressed` and friends —
   * so a pino/bunyan sink never has to regex the message.
   *
   * Defaults to `console.warn` / `console.error`, byte-identical to the
   * behaviour before this option existed. Rate limiting stays inside the
   * library (a sink cannot know which lines sit on a per-publish path), so
   * an adapter should forward every call it receives.
   */
  logger?: CatalogLogger;
}

/**
 * The library half of event-catalog: declare events, publish them with
 * local schema validation, and subscribe to them.
 *
 * Failure semantics at a glance:
 *   - Programming errors (undeclared event, bad payload, bad discriminator,
 *     a throwing `beforePublish` hook) **reject**.
 *   - Registry-server failures (declaration sync, subscriber registration,
 *     heartbeat) are **swallowed and warned** — publishing never blocks on
 *     the registry.
 *   - Durable transport failures **reject** after retries.
 *   - Signal transport failures **reject**, except a publish issued while
 *     disconnected, which is **dropped**. Dropped publishes are counted
 *     ({@link getDroppedPublishCount}), reported to `onPublishDropped`, and
 *     can be made to reject with `strictTransport: true`. They never count
 *     toward `publishCount`.
 */
export class EventCatalog {
  private readonly config: EventCatalogClientOptions;
  private readonly registry: Registry;
  private readonly signal: SignalTransport;
  private readonly durable: DurableTransport;
  private readonly syncRetryManager: RetryManager;
  private connected = false;
  /** Shared by concurrent `connect()` callers so a race starts one re-sync loop. */
  private connectInFlight: Promise<void> | null = null;
  private resyncInterval: ReturnType<typeof setInterval> | null = null;
  /**
   * The pending background-sync retry. Tracked so `disconnect()` can clear
   * it: an untracked chained `setTimeout` keeps the event loop alive after
   * SIGTERM, and a reconnect used to resume every chain a previous failed
   * connect had left behind.
   */
  private backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** Heartbeat interval, so `disconnect()` releases it even if `stop()` is never called. */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  /**
   * Phase E3.5 — dedupe deprecation log to one line per alias per process.
   * Keyed by a *declared* alias, so this is bounded by the declaration set.
   */
  private readonly warnedAliases = new Set<string>();
  /**
   * wave25-a — deprecated event names already warned about. Keyed by a
   * declared canonical name, so bounded by the declaration set.
   */
  private readonly warnedDeprecated = new Set<string>();
  /**
   * Undeclared names already warned about on the publishSignal path.
   * Bounded and rate-limited: the key is caller-controlled, and "warn once
   * per key" over an unbounded key space is still unbounded logging.
   */
  private readonly undeclaredSignalWarnings = new LogThrottle({
    maxKeys: MAX_TRACKED_EVENT_NAMES,
    maxPerWindow: 10,
  });
  /** Throttle for the per-publish hook/callback failure warnings. */
  private readonly hookWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5 });
  private hookFailures = 0;
  /**
   * Publishes discarded because a transport was down, keyed by event name.
   * Bounded per key with an exact lifetime total — see
   * {@link getDroppedPublishTotal}.
   */
  private readonly droppedPublishes = new BoundedCounter(MAX_TRACKED_EVENT_NAMES);
  /** Diagnostics sink — `console` unless the caller supplied one. */
  private readonly log: LogWriter;

  /**
   * @param config transport URLs, service identity, and optional
   *   validation/observability knobs. `redis.url` and `messageQueue.url`
   *   must be non-empty — the constructor throws otherwise, naming the
   *   env var each is normally read from, because an empty URL otherwise
   *   surfaces much later as a confusing connection failure.
   * @throws when `redis.url`, `messageQueue.url` or `serviceName` is
   *   missing or blank.
   */
  constructor(config: EventCatalogClientOptions) {
    requireConfigValue(config.redis?.url, 'redis.url', 'REDIS_URL');
    requireConfigValue(config.messageQueue?.url, 'messageQueue.url', 'MESSAGE_QUEUE_URL');
    requireConfigValue(config.serviceName, 'serviceName');
    this.config = config;
    this.log = new LogWriter(config.logger);
    this.registry = new Registry();
    this.signal = new SignalTransport({ url: config.redis.url, logger: config.logger });
    this.durable = new DurableTransport({ ...config.messageQueue, logger: config.logger });
    this.syncRetryManager = new RetryManager({
      maxRetries: 2,
      baseDelay: 1000,
      backoffFactor: 2,
      jitter: false,
      enableLogging: false,
      name: 'catalog-registry-sync',
    });
  }

  /**
   * Connect both transports, then push local declarations to the remote
   * registry if `registryUrl` is set. Idempotent.
   *
   * Publish before this resolves and the event is dropped (signal) or
   * rejected (durable) — always await it during boot.
   *
   * @throws when Redis cannot be reached. An unreachable message-queue or
   *   registry does **not** throw: the registry sync retries twice, then
   *   falls back to a background retry loop, and a 60s periodic re-sync
   *   starts regardless. Publishing never blocks on the registry.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    // Two callers awaiting connect() concurrently used to get past the
    // `connected` guard together and each install a 60s re-sync interval;
    // the second one's handle overwrote the first, which then survived
    // disconnect() forever.
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = this.doConnect().finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }

  private async doConnect(): Promise<void> {
    try {
      await Promise.all([
        this.signal.connect(),
        this.durable.connect(),
      ]);
    } catch (err) {
      // A rejected connect() must leave nothing running: the signal
      // transport may have failed while the durable one succeeded, and a
      // half-connected catalog with live transports is how a process keeps
      // itself alive after a boot failure.
      await this.releaseResources();
      throw err;
    }

    this.connected = true;

    if (this.config.registryUrl) {
      try {
        await this.syncRetryManager.execute(() => this.syncToRemoteRegistry());
      } catch {
        this.log.warn(
          '[event-catalog] registry sync failed after retries, scheduling background retry',
          { registryUrl: this.config.registryUrl, serviceName: this.config.serviceName },
        );
        this.scheduleBackgroundSync();
      }

      // Defensive: a caller that reconnects without disconnecting cleanly
      // would otherwise orphan the previous interval.
      if (this.resyncInterval) clearInterval(this.resyncInterval);
      this.resyncInterval = setInterval(() => {
        this.syncToRemoteRegistry().catch(err => {
          this.log.warn(
            '[event-catalog] periodic re-sync failed:',
            {
              registryUrl: this.config.registryUrl,
              serviceName: this.config.serviceName,
              error: errorMessage(err),
            },
            (err as Error).message,
          );
        });
      }, 60_000);
    }
  }

  /**
   * Stop the periodic registry re-sync and disconnect both transports.
   * Idempotent and best-effort — safe to call from a SIGTERM handler.
   *
   * Does not deregister this service's subscriptions from the remote
   * registry (they age out via the heartbeat TTL), and does not drain
   * in-flight durable messages.
   */
  async disconnect(): Promise<void> {
    await this.releaseResources();
    this.connected = false;
  }

  /**
   * Clear every timer this catalog owns and disconnect both transports.
   *
   * Deliberately unconditional rather than gated on `connected`: a
   * heartbeat can be started before connect, a background-sync chain can
   * outlive a failed connect, and a transport can be left half-open by a
   * partial connect. Any one of those surviving `disconnect()` keeps the
   * event loop alive after SIGTERM — the classic container that will not
   * stop. Idempotent; safe to call twice, and safe after a failed connect.
   */
  private async releaseResources(): Promise<void> {
    if (this.resyncInterval) {
      clearInterval(this.resyncInterval);
      this.resyncInterval = null;
    }
    if (this.backgroundSyncTimer) {
      clearTimeout(this.backgroundSyncTimer);
      this.backgroundSyncTimer = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    await Promise.all([
      this.signal.disconnect(),
      this.durable.disconnect(),
    ]);
  }

  /**
   * Register an event with the local registry. In strict mode
   * (`config.strict === true` or `EVENT_CATALOG_STRICT=true`), throws
   * when the new schema breaks compatibility against the registered
   * history. Otherwise the violation is non-fatal — callers may inspect
   * the catalog's logs or the server's `GET /api/events/:name/schema/check`
   * endpoint.
   *
   * Purely local and synchronous — it does not reach the registry server.
   * Declarations are pushed on `connect()` and by the 60s re-sync, so an
   * event declared after connect is publishable immediately but visible to
   * the server only on the next sync.
   *
   * @throws when the schema shape itself is invalid (e.g. `type: 'objct'`),
   *   and — in strict mode only — when the new schema breaks compatibility
   *   with the registered history.
   */
  declare(event: EventDeclaration): void {
    // Phase 20-h — apply namespace policy defaults to fields the
    // declaration didn't set explicitly. Per-event values always win.
    const merged = applyNamespacePolicy(event, this.config.namespacePolicies);
    const result = this.registry.declare(merged);
    if (this.isStrict() && !result.compatible) {
      const violations = result.violations?.join('; ') ?? 'unknown';
      throw new Error(
        `[event-catalog] declare("${event.name}") rejected by strict mode: ${violations}`,
      );
    }
  }

  /** Phase 20-h — public access to the merged namespace policy for a name. */
  getNamespacePolicy(namespace: string): NamespacePolicy | undefined {
    return this.config.namespacePolicies?.[namespace];
  }

  /**
   * Phase 20-b — bulk-declare convenience. Equivalent to looping
   * `declare()` per event but documents intent at the call site (most
   * consumers register many declarations at boot from an exported
   * array, e.g. `pipelineEventDeclarations`). In strict mode each
   * incompatible declaration throws *immediately*; earlier successful
   * declarations stay in the local registry.
   */
  declareAll(events: EventDeclaration[]): void {
    for (const event of events) {
      this.declare(event);
    }
  }

  /**
   * wave24-e — periodically POST /api/heartbeat for every event this
   * catalog instance is currently subscribed to. Returns a `stop()`
   * function for graceful shutdown wiring.
   *
   * Defaults to 5-minute cadence which sits comfortably within the
   * server's default 30-min `SUBSCRIBER_TTL_SECONDS`. Best-effort:
   * heartbeat HTTP failures log a warn and the loop continues.
   *
   * Use case (consumer boot):
   *   const stopHb = catalog.startHeartbeating();
   *   process.on('SIGTERM', async () => { stopHb(); await catalog.disconnect(); });
   */
  startHeartbeating(intervalMs: number = 5 * 60 * 1000): () => void {
    if (!this.config.registryUrl) {
      // No remote registry to heartbeat against — return a no-op stop.
      return () => {};
    }
    const tick = async (): Promise<void> => {
      const subscribed = this.registry.eventsSubscribedBy(this.config.serviceName);
      if (subscribed.length === 0) return;
      try {
        const res = await fetch(`${this.config.registryUrl!.replace(/\/$/, '')}/api/heartbeat`, {
          method: 'POST',
          headers: this.registryHeaders(),
          body: JSON.stringify({ serviceName: this.config.serviceName, events: subscribed }),
        });
        // A non-2xx here is not harmless: the server sweeps subscribers that
        // stop heartbeating, so a silently-failing heartbeat ends with this
        // service disappearing from the registry at TTL.
        if (!res.ok) {
          this.log.warn(
            `[event-catalog] heartbeat rejected: HTTP ${res.status} — `
            + 'this service will be swept from the registry if this persists',
            {
              status: res.status,
              serviceName: this.config.serviceName,
              events: subscribed.length,
            },
          );
        }
      } catch (err) {
        this.log.warn(
          '[event-catalog] heartbeat failed:',
          { serviceName: this.config.serviceName, error: errorMessage(err) },
          (err as Error).message,
        );
      }
    };
    // Fire one immediately so the first tick doesn't wait `intervalMs`.
    void tick();
    // BEHAVIOUR CHANGE (v0.5): a second call replaces the first loop
    // instead of adding one. Previously two calls meant two intervals,
    // only the second of which the caller could stop — and neither of
    // which disconnect() knew about.
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    const handle = setInterval(() => { void tick(); }, intervalMs);
    this.heartbeatInterval = handle;
    return () => {
      clearInterval(handle);
      if (this.heartbeatInterval === handle) this.heartbeatInterval = null;
    };
  }

  /**
   * wave24-e — derive a manifest of every event this consumer is
   * subscribed to + the current local fingerprint. Returns the shape
   * the wave23-b PUT /api/manifests/:consumer endpoint expects.
   *
   * Use case:
   *   const manifest = catalog.exportManifest();
   *   await fetch(`${url}/api/manifests/audit-worker`, { method: 'PUT', body: JSON.stringify(manifest) });
   */
  exportManifest(): { events: Array<{ name: string; fingerprint: string }> } {
    const events: Array<{ name: string; fingerprint: string }> = [];
    for (const name of this.registry.eventsSubscribedBy(this.config.serviceName)) {
      const entry = this.registry.get(name);
      if (entry) events.push({ name, fingerprint: entry.schemaFingerprint });
    }
    return { events };
  }

  /**
   * wave24-e — convenience: derive the manifest via exportManifest()
   * and PUT it to the registry under the configured serviceName (or
   * an explicit override). Returns the server's response body. Throws
   * on non-2xx HTTP. No-op when registryUrl is unset.
   */
  async pinManifest(consumerName?: string): Promise<unknown> {
    if (!this.config.registryUrl) return null;
    const consumer = consumerName ?? this.config.serviceName;
    const body = this.exportManifest();
    const url = `${this.config.registryUrl.replace(/\/$/, '')}/api/manifests/${encodeURIComponent(consumer)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.registryHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`[event-catalog] pinManifest("${consumer}"): HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Phase 21-b — bulk drift detection. For every event in the local
   * registry, fetches the current fingerprint from the remote registry
   * and compares to the local one. Returns a per-event status report.
   *
   *   'fresh'   — local fingerprint matches remote
   *   'stale'   — fingerprints differ; the local declaration is out of sync
   *   'unknown' — no remote fingerprint (event not yet on the registry,
   *               or `registryUrl` is unset)
   *
   * Useful at consumer boot to log a single startup line summarizing
   * declaration drift, or for periodic health checks. Network errors
   * on individual events show as 'unknown' (they don't abort the loop).
   */
  async checkAllSchemaFreshness(): Promise<Array<{
    eventName: string;
    status: 'fresh' | 'stale' | 'unknown';
    localFingerprint: string;
    remoteFingerprint: string | null;
  }>> {
    const local = this.registry.list();
    const out: Array<{
      eventName: string;
      status: 'fresh' | 'stale' | 'unknown';
      localFingerprint: string;
      remoteFingerprint: string | null;
    }> = [];

    for (const entry of local) {
      let remote: string | null = null;
      try {
        remote = await this.getSchemaFingerprint(entry.name);
      } catch {
        // Network/HTTP failure → unknown rather than aborting the loop.
        remote = null;
      }
      const status: 'fresh' | 'stale' | 'unknown' = remote === null
        ? 'unknown'
        : remote === entry.schemaFingerprint
          ? 'fresh'
          : 'stale';
      out.push({
        eventName: entry.name,
        status,
        localFingerprint: entry.schemaFingerprint,
        remoteFingerprint: remote,
      });
    }
    return out;
  }

  /**
   * Phase 20-b — fetch the current sha256 fingerprint of an event's
   * schema from the remote registry. Returns null when the event is
   * not declared on the registry, or when `registryUrl` is unset.
   * Throws on network errors (callers can wrap to fail open).
   *
   * Use case: a consumer caches the fingerprint from its last fetch.
   * On a tick it calls this and compares — if the value changed, the
   * cached schema is stale and the consumer should re-fetch.
   */
  async getSchemaFingerprint(eventName: string): Promise<string | null> {
    if (!this.config.registryUrl) return null;
    const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`[event-catalog] getSchemaFingerprint("${eventName}"): HTTP ${res.status}`);
    }
    const body = await res.json() as { schemaFingerprint?: string };
    return body.schemaFingerprint ?? null;
  }

  /**
   * Headers for a mutating registry call. Adds `Authorization: Bearer` only
   * when a token is configured, so an unauthenticated server sees exactly
   * the request shape it saw before v0.5.0.
   */
  private registryHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.config.authToken ?? process.env.EVENT_CATALOG_AUTH_TOKEN;
    if (typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  private isStrict(): boolean {
    if (typeof this.config.strict === 'boolean') return this.config.strict;
    return process.env.EVENT_CATALOG_STRICT === 'true';
  }

  /**
   * Publish a declared event. Validates the payload locally against the
   * declared JSON Schema, then routes to the signal transport, the durable
   * transport, or both, according to the declaration's `transport`.
   *
   * When `eventName` is a name the generated `EventPayloadMap` knows
   * about, the payload is contextually typed for you — object literals get
   * field autocomplete and inference from the declared schema. Passing a
   * `string` variable, or a name not in the map, keeps the old untyped
   * behaviour.
   *
   * @throws when the event is not declared (the message suggests close
   *   declared names), when the payload fails schema or discriminator
   *   validation (the message names the field, the rule and the value),
   *   when a `beforePublish` hook throws, or when a transport send fails.
   *   `errorCount` is incremented on every one of those.
   * @remarks Does **not** guarantee delivery. A signal publish issued while
   *   the Redis transport is disconnected is dropped, not thrown — see
   *   {@link getDroppedPublishCount} and the `onPublishDropped` /
   *   `strictTransport` options. Signal delivery itself is fire-and-forget
   *   with no ack. Never blocks on the registry server.
   */
  async publish<K extends string>(
    eventName: K,
    payload: PayloadFor<K>,
    options?: PublishOptions,
  ): Promise<void>;
  async publish<T = unknown>(eventName: string, payload: T, options?: PublishOptions): Promise<void>;
  async publish(eventName: string, payload: unknown, options?: PublishOptions): Promise<void> {
    // Phase E3.5 — alias resolution. If `eventName` is a deprecated alias of
    // some canonical declaration, route the publish through the canonical
    // (use its schema, channel, queue) and emit on the canonical name so
    // subscribers don't have to handle both forms. A one-line deprecation
    // warning per process per alias keeps log noise bounded.
    const resolved = this.registry.resolve(eventName);
    if (!resolved) {
      throw new Error(this.undeclaredEventMessage(eventName, 'publish'));
    }
    const entry = resolved.entry;
    if (resolved.viaAlias) {
      this.warnDeprecatedAlias(resolved.viaAlias.name, entry.name, resolved.viaAlias.until);
      eventName = entry.name;
    }

    // wave25-a — one-time warn per process when publishing a deprecated
    // event. Doesn't block (existing producers shouldn't break) but the
    // warn shows up in service logs so owners notice.
    if (entry.deprecation && this.config.warnOnDeprecated !== false && !this.warnedDeprecated.has(entry.name)) {
      this.warnedDeprecated.add(entry.name);
      const reason = entry.deprecation.reason ? ` reason: ${entry.deprecation.reason}` : '';
      const by = entry.deprecation.by ? ` (by ${entry.deprecation.by})` : '';
      this.log.warn(
        `[event-catalog] publish("${entry.name}") — event is DEPRECATED `
        + `as of ${entry.deprecation.deprecatedAt}${by}.${reason}`,
        {
          eventName: entry.name,
          deprecatedAt: entry.deprecation.deprecatedAt,
          deprecatedBy: entry.deprecation.by,
          deprecationReason: entry.deprecation.reason,
        },
      );
    }

    // Validate payload against schema
    const validation = this.registry.validate(eventName, payload);
    if (!validation.valid) {
      throw new Error(
        formatValidationFailure('payload validation failed', eventName, validation, payload, entry),
      );
    }

    // Discriminator validation (Phase E3.6) — when a declaration carries
    // `discriminator: { field, values }`, the payload's value at `field`
    // must be one of the declared values. Catches sub-type drift at
    // publish time, e.g. ingest:progress carries 10 sub-shapes via
    // payload.type.
    if (entry.discriminator) {
      const { field, values } = entry.discriminator;
      const actual = (payload as Record<string, unknown> | null)?.[field];
      if (typeof actual !== 'string' || !values.includes(actual)) {
        throw new Error(
          `[event-catalog] discriminator validation failed for "${eventName}": `
          + `payload.${field}=${JSON.stringify(actual)} is not in declared values [${values.join(', ')}]`
          + (typeof actual === 'string'
            ? ''
            : ` — the discriminator must be a string, got ${describeType(actual)}`),
        );
      }
    }

    const metadata: EventMetadata = {
      id: eventId(),
      producer: this.config.serviceName,
      timestamp: options?.timestamp ?? Date.now(),
      correlationId: options?.correlationId,
      headers: options?.headers,
    };

    const envelope: EventEnvelope = {
      eventName,
      payload,
      metadata,
    };

    try {
      // Phase 20-c — beforePublish hooks. Run sequentially in declared
      // order so a tracing hook can read what a logging hook set.
      // Throwing aborts the publish.
      const hooks = this.config.hooks ?? [];
      for (const hook of hooks) {
        await hook.beforePublish?.(envelope as EventEnvelope, entry);
      }

      // Phase E3.4 — 'both' fan-out: publish to signal AND durable in
      // parallel. Failure of either propagates after both are attempted so
      // partial deliveries are not silently masked.
      // Evaluate FIFO routing before either leg starts: a throwing partition
      // function must not leave an already-started signal promise unobserved.
      const hasDurable = entry.transport === 'durable' || entry.transport === 'both';
      const durableGroupId = hasDurable ? options?.groupId ?? (entry.fifo ? entry.partitionKey?.(payload) : undefined) : undefined;
      if (hasDurable && entry.fifo && !durableGroupId) throw new Error('FIFO publish requires a groupId or declared partitionKey');
      const sends: Array<Promise<void>> = [];
      // A signal publish issued while Redis is disconnected is discarded by
      // SignalTransport rather than thrown. Detect that here so the drop is
      // accounted for as an error rather than counted as a publish — the
      // alternative (a rising publishCount for events nobody received) is
      // the single most misleading state this library can report.
      let signalDropped = false;
      if (entry.transport === 'signal' || entry.transport === 'both') {
        // Phase E3.3 — resolve declared `channel` (string, function of
        // payload, or fall back to event name).
        const signalChannel = resolveSignalChannel(entry.channel, eventName, payload);
        if (this.signal.isConnected()) {
          sends.push(this.signal.publish(signalChannel, envelope as EventEnvelope));
        } else if (this.config.strictTransport) {
          throw new Error(
            `[event-catalog] publish("${eventName}"): the signal transport is not connected, `
            + 'so the event would be silently lost (strictTransport is on). '
            + 'Await catalog.connect() before publishing.',
          );
        } else {
          signalDropped = true;
          this.recordDroppedPublish({
            eventName,
            transport: 'signal',
            reason: 'transport-not-connected',
            envelope: envelope as EventEnvelope,
          });
          // Still call through so SignalTransport records the drop on its
          // own per-channel counter and emits its one-shot warning.
          sends.push(this.signal.publish(signalChannel, envelope as EventEnvelope));
        }
      }
      if (entry.transport === 'durable' || entry.transport === 'both') {
        // Derived here rather than above the branch: the two regex passes in
        // eventNameToQueueName cost ~7% of a signal-only publish, and the
        // overwhelming majority of declared events never touch this branch.
        const queueName = entry.queue ?? DurableTransport.eventNameToQueueName(eventName, entry.fifo);
        // Phase 4.2 — thread the declared durable-side config so
        // DurableTransport.ensureQueue can PUT the right shape on first publish.
        const queueOptions = {
          retention: entry.retention,
          fifo: entry.fifo,
          dlqAfterAttempts: entry.dlqAfterAttempts,
        };
        sends.push(this.durable.publish(queueName, envelope as EventEnvelope, queueOptions, {
          groupId: durableGroupId,
          deduplicationId: options?.deduplicationId, delaySeconds: options?.delaySeconds,
          signal: options?.signal, timeoutMs: options?.timeoutMs, schemaVersion: entry.version,
        }));
      }
      const results = await Promise.allSettled(sends);
      const rejection = results.find((r) => r.status === 'rejected');
      if (rejection && rejection.status === 'rejected') {
        throw rejection.reason;
      }

      if (signalDropped) {
        // Nothing was delivered on the signal leg. Count it as an error,
        // not a publish, and leave lastPublishedAt alone.
        this.registry.updateStats(eventName, {
          errorCount: (entry.metadata.errorCount ?? 0) + 1,
        });
        return;
      }

      this.registry.updateStats(eventName, {
        lastPublishedAt: nowIso(),
        publishCount: (entry.metadata.publishCount ?? 0) + 1,
      });

      // Phase 20-c — afterPublish hooks. Informational. Exceptions are
      // caught + logged so an audit-sink failure can't fail the publish
      // that just succeeded.
      for (const hook of hooks) {
        try {
          await hook.afterPublish?.(envelope as EventEnvelope, entry);
        } catch (hookErr) {
          // Per-publish path: a hook that throws once throws every time.
          this.warnOnHotPath(
            `afterPublish:${eventName}`,
            `[event-catalog] afterPublish hook threw on "${eventName}"`,
            hookErr as Error,
            { eventName, hook: 'afterPublish' },
          );
        }
      }
    } catch (err) {
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
   * Not interchangeable with `publish()`: this one takes a channel, skips
   * the registry's transport routing (always signal), does not run
   * `beforePublish`/`afterPublish` hooks, and — because the gateway's wire
   * envelope has nowhere to carry them — **ignores `options.headers` and
   * `options.correlationId`**. Only `options.timestamp` is honoured. Use
   * `publish()` for anything that isn't a gateway channel broadcast.
   *
   * @returns number of gateway nodes the envelope was addressed to.
   *   **`0` is ambiguous** — it means "no gateway node is registered for
   *   this channel" *or* "the signal transport is disconnected and the
   *   message was dropped". {@link getDroppedPublishCount} distinguishes
   *   them.
   * @throws when a declared payload fails schema or discriminator
   *   validation, when Redis rejects the publish, or — with
   *   `strictTransport: true` — when the transport is disconnected.
   * @remarks An undeclared event publishes anyway, with a one-time warning
   *   per event name and no schema enforcement.
   */
  async publishSignal<T = unknown>(
    channelId: string,
    eventName: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<number> {
    const entry = this.registry.get(eventName);

    if (entry) {
      const validation = this.registry.validate(eventName, payload);
      if (!validation.valid) {
        this.registry.updateStats(eventName, {
          errorCount: (entry.metadata.errorCount ?? 0) + 1,
        });
        throw new Error(
          formatValidationFailure(
            'publishSignal payload validation failed',
            eventName,
            validation,
            payload,
            entry,
          ),
        );
      }

      if (entry.discriminator) {
        const { field, values } = entry.discriminator;
        const actual = (payload as Record<string, unknown> | null)?.[field];
        if (typeof actual !== 'string' || !values.includes(actual)) {
          this.registry.updateStats(eventName, {
            errorCount: (entry.metadata.errorCount ?? 0) + 1,
          });
          throw new Error(
            `[event-catalog] publishSignal discriminator validation failed for "${eventName}": `
            + `payload.${field}=${JSON.stringify(actual)} is not in declared values [${values.join(', ')}]`
            + (typeof actual === 'string'
              ? ''
              : ` — the discriminator must be a string, got ${describeType(actual)}`),
          );
        }
      }
    } else {
      // One warning per event name per process, with a global ceiling.
      // This is the gateway's broadcast hot path and the event name comes
      // from the caller, so warn-once-per-name alone bounds nothing: an
      // unbounded name space means unbounded log lines. The ceiling is
      // what holds. Suppressed occurrences stay counted on
      // `getDroppedPublishStats().suppressedWarnings`.
      const suppressed = this.undeclaredSignalWarnings.attempt(eventName);
      if (suppressed !== null) {
        // `suggestNames` walks the whole registry, so it must run only on
        // the line we actually emit — not on every suppressed occurrence.
        const suggestions = suggestNames(eventName, this.registry.list().map((e) => e.name));
        const didYouMean = suggestions.length > 0
          ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?`
          : '';
        this.log.warn(
          `[event-catalog] publishSignal called with undeclared event "${eventName}" — `
          + `emitting without schema validation. Declare it via catalog.declare() to enforce schema.`
          + `${didYouMean} (further occurrences of this event name are not logged)`
          + LogThrottle.suffix(suppressed),
          { eventName, channelId, suggestions, suppressed },
        );
      }
    }

    let dropped = false;
    if (!this.signal.isConnected()) {
      dropped = true;
      if (this.config.strictTransport) {
        throw new Error(
          `[event-catalog] publishSignal("${channelId}", "${eventName}"): the signal transport `
          + 'is not connected, so the message would be silently lost (strictTransport is on). '
          + 'Await catalog.connect() before publishing.',
        );
      }
      this.recordDroppedPublish({
        eventName,
        transport: 'signal',
        reason: 'transport-not-connected',
        channelId,
        envelope: {
          eventName,
          payload,
          metadata: { id: eventId(), producer: this.config.serviceName, timestamp: Date.now() },
        },
      });
    }

    const timestamp = options?.timestamp !== undefined
      ? new Date(options.timestamp).toISOString()
      : nowIso();

    const envelope = buildChannelMessageEnvelope({
      channel: channelId,
      message: buildSignalMessage({
        eventName,
        channel: channelId,
        payload,
        timestamp,
      }),
      fromNode: this.config.serviceName,
      timestamp,
    });

    let delivered: number;
    try {
      delivered = await this.signal.publishChannelMessage(channelId, envelope);
    } catch (err) {
      if (entry) {
        this.registry.updateStats(eventName, {
          errorCount: (entry.metadata.errorCount ?? 0) + 1,
        });
      }
      throw err;
    }

    if (entry) {
      if (dropped) {
        // Nothing left the process — record it as an error, not a publish.
        this.registry.updateStats(eventName, {
          errorCount: (entry.metadata.errorCount ?? 0) + 1,
        });
      } else {
        this.registry.updateStats(eventName, {
          lastPublishedAt: nowIso(),
          publishCount: (entry.metadata.publishCount ?? 0) + 1,
        });
      }
    }

    return delivered;
  }

  /**
   * Subscribe to a declared event, routed to Redis pub/sub or message-queue
   * polling by the declaration's `transport`. Synchronous — the returned
   * handle is usable immediately, while the underlying attach completes in
   * the background (`unsubscribe()` awaits it).
   *
   * `options` (`pollingInterval`, `batchSize`, `visibilityTimeout`) apply
   * to durable events only and are ignored for signal events.
   *
   * @throws synchronously when the event is not declared, or when a signal
   *   event's declared `channel` is a function (per-payload channels can't
   *   be resolved without a payload).
   * @remarks Registration with the remote registry is fire-and-forget: a
   *   failure warns and leaves the local subscription working, so "who
   *   consumes X?" on the server may be incomplete. Handler exceptions are
   *   swallowed and logged on the signal path; on the durable path they
   *   trigger redelivery and eventual dead-lettering.
   */
  subscribe<T = unknown>(
    eventName: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): Subscription {
    // Phase E3.5 — alias-aware subscribe. If the caller supplied a deprecated
    // alias, resolve to the canonical and subscribe there. No warning on the
    // subscribe path — only producers should be redirected (the alias-warning
    // story belongs on the emission side).
    const resolved = this.registry.resolve(eventName);
    if (!resolved) {
      throw new Error(this.undeclaredEventMessage(eventName, 'subscribe'));
    }
    const entry = resolved.entry;
    if (resolved.viaAlias) {
      eventName = entry.name;
    }
    if (options?.subscription !== undefined && entry.transport === 'signal') {
      throw new Error(
        `[event-catalog] cannot subscribe to "${eventName}" with a durable subscription handle: `
        + 'it is a signal event, and signal delivery has no queue-owned subscriptions.',
      );
    }
    const subscription = options?.subscription === undefined
      ? undefined
      : parseSubscriptionHandle(options.subscription);

    this.registry.addSubscriber(eventName, this.config.serviceName);

    // Notify remote catalog (non-blocking, fault-tolerant)
    this.registerSubscriberRemote(eventName).catch(err => {
      this.log.warn(
        `[event-catalog] failed to register subscriber with remote registry for "${eventName}":`,
        { eventName, serviceName: this.config.serviceName, error: errorMessage(err) },
        (err as Error).message,
      );
    });

    // Phase 20-b — shared paused-state for the Subscription handle.
    // The handler wrapper consults this flag; transports keep
    // receiving so resume() doesn't have to re-attach.
    let paused = false;
    const guardedHandler = async (envelope: EventEnvelope<T>): Promise<void> => {
      if (paused) return;
      await handler(envelope);
    };

    if (entry.transport === 'signal') {
      let unsubFn: (() => Promise<void>) | null = null;

      // Phase E3.3 — subscribe() needs a static channel. If the declaration's
      // `channel` is a function (dynamic per payload), the subscriber has no
      // payload to resolve from. Reject with a clear error rather than silently
      // subscribing to the wrong channel.
      const signalChannel = resolveStaticSignalChannel(entry.channel, eventName);

      const setupPromise = this.signal.subscribe(signalChannel, (envelope) => {
        guardedHandler(envelope as EventEnvelope<T>);
      }).then(unsub => {
        unsubFn = unsub;
      });

      return {
        unsubscribe: async () => {
          await setupPromise;
          if (unsubFn) await unsubFn();
          this.deregisterSubscriberRemote(eventName).catch(err => {
            this.log.warn(
              `[event-catalog] failed to deregister subscriber from remote registry for "${eventName}":`,
              { eventName, serviceName: this.config.serviceName, error: errorMessage(err) },
              (err as Error).message,
            );
          });
        },
        pause: () => { paused = true; },
        resume: () => { paused = false; },
        isPaused: () => paused,
      };
    } else {
      const queueName = entry.queue ?? DurableTransport.eventNameToQueueName(eventName, entry.fifo);
      const cancel = this.durable.subscribe(
        queueName,
        async (envelope, context) => {
          await handler(envelope as EventEnvelope<T>, context);
        },
        {
          pollingInterval: options?.pollingInterval,
          batchSize: options?.batchSize,
          visibilityTimeout: options?.visibilityTimeout,
          queueOptions: { retention: entry.retention, fifo: entry.fifo, dlqAfterAttempts: entry.dlqAfterAttempts },
          isPaused: () => paused,
          subscription,
          onTerminalError: options?.onTerminalError,
        },
      );

      return {
        unsubscribe: async () => {
          cancel();
          await cancel.done;
          this.deregisterSubscriberRemote(eventName).catch(err => {
            this.log.warn(
              `[event-catalog] failed to deregister subscriber from remote registry for "${eventName}":`,
              { eventName, serviceName: this.config.serviceName, error: errorMessage(err) },
              (err as Error).message,
            );
          });
        },
        pause: () => { paused = true; },
        resume: () => { paused = false; },
        isPaused: () => paused,
        terminalError: () => cancel.terminalError,
      };
    }
  }

  /**
   * The live local registry. Returned by reference — mutating it changes
   * this catalog's behaviour, so treat it as read-only unless you mean
   * otherwise. Prefer {@link resolveEvent} for name lookups.
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Phase 20-a — alias-aware public lookup. Returns the canonical
   * RegistryEntry plus alias-info if the caller queried by a deprecated
   * name. Use this for "what's my canonical name for this old alias?"
   * audits without reaching into `getRegistry()`.
   */
  resolveEvent(name: string): ResolveResult | undefined {
    return this.registry.resolve(name);
  }

  /**
   * The underlying Redis transport, for health checks, per-channel metrics
   * and drop counters. Publishing through it directly bypasses schema
   * validation, alias resolution and hooks — use {@link publish} instead.
   */
  getSignalTransport(): SignalTransport {
    return this.signal;
  }

  /**
   * The underlying message-queue transport, for health checks, queue
   * metrics and the in-memory DLQ. Publishing through it directly bypasses
   * schema validation, alias resolution and hooks — use {@link publish}.
   */
  getDurableTransport(): DurableTransport {
    return this.durable;
  }

  /**
   * True once `connect()` has resolved. Says nothing about whether Redis
   * or message-queue are currently healthy — ask the transports'
   * `healthCheck()` for that.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Publishes discarded because a transport was not connected — with
   * `eventName`, that event's count; without, a copy of the whole map.
   *
   * These publishes resolved successfully from the caller's point of view
   * but delivered nothing, so this counter (or the `onPublishDropped`
   * callback) is the only way to notice. A non-zero value means events
   * were lost. Process-local; resets on restart.
   */
  getDroppedPublishCount(eventName: string): number;
  getDroppedPublishCount(): Map<string, number>;
  getDroppedPublishCount(eventName?: string): number | Map<string, number> {
    if (eventName !== undefined) return this.droppedPublishes.get(eventName);
    return this.droppedPublishes.snapshot();
  }

  /**
   * Every publish this catalog has dropped, and how much per-event detail
   * has been evicted for capacity.
   *
   * `getDroppedPublishCount()`'s map holds at most 1000 event names —
   * `publishSignal()` accepts undeclared names, so its key space is
   * caller-controlled. `total` here never evicts and is the number to
   * alert on. `suppressedWarnings` counts log lines withheld by the
   * per-publish throttles, so a quiet log is not mistaken for a quiet
   * system.
   */
  getDroppedPublishStats(): {
    total: number;
    trackedEvents: number;
    evictedEvents: number;
    evictedTotal: number;
    hookFailures: number;
    suppressedWarnings: number;
  } {
    return {
      total: this.droppedPublishes.total,
      trackedEvents: this.droppedPublishes.size,
      evictedEvents: this.droppedPublishes.evictedKeys,
      evictedTotal: this.droppedPublishes.evictedTotal,
      hookFailures: this.hookFailures,
      suppressedWarnings:
        this.undeclaredSignalWarnings.suppressedTotal + this.hookWarnings.suppressedTotal,
    };
  }

  /** Count a dropped publish and notify the configured observer. */
  private recordDroppedPublish(drop: DroppedPublish): void {
    this.droppedPublishes.increment(drop.eventName);
    try {
      this.config.onPublishDropped?.(drop);
    } catch (err) {
      // A callback that throws throws on *every* drop, and drops arrive at
      // the full publish rate while a transport is down.
      this.warnOnHotPath(
        `onPublishDropped:${drop.eventName}`,
        `[event-catalog] onPublishDropped threw for "${drop.eventName}"`,
        err as Error,
        { eventName: drop.eventName, callback: 'onPublishDropped' },
      );
    }
  }

  /**
   * Warn about a failure that recurs at the publish rate: counted every
   * time, logged at most once a minute per key and ten times a minute
   * overall. Without this a throwing hook turns a dependency outage into
   * a log-volume outage.
   */
  private warnOnHotPath(key: string, message: string, err: Error, fields: LogFields): void {
    this.hookFailures++;
    const suppressed = this.hookWarnings.attempt(key);
    if (suppressed === null) return;
    this.log.warn(
      `${message} (${this.hookFailures} such failures this process)`
      + LogThrottle.suffix(suppressed) + ':',
      { ...fields, error: err.message, hookFailures: this.hookFailures, suppressed },
      err.message,
    );
  }

  /**
   * Message for "you referenced an event nobody declared". Includes what
   * to do next and the closest declared names — colon/dot confusion
   * (`pipeline.run.started` vs `pipeline:run:started`) is the usual cause.
   */
  private undeclaredEventMessage(eventName: string, action: 'publish' | 'subscribe'): string {
    const declared = this.registry.list().map((e) => e.name);
    const suggestions = suggestNames(eventName, declared);
    const didYouMean = suggestions.length > 0
      ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?`
      : '';
    const scale = declared.length === 0
      ? ' No events are declared on this catalog instance at all — declarations may not have '
        + 'been registered before this call.'
      : ` (${declared.length} events are declared on this instance by "${this.config.serviceName}".)`;
    return `[event-catalog] event "${eventName}" is not declared, so ${action}() cannot use it. `
      + `Call catalog.declare({ name: "${eventName}", schema, transport, producer }) first, or `
      + `declareAll() with the shared declaration array for this domain.${didYouMean}${scale}`;
  }

  private warnDeprecatedAlias(aliasName: string, canonicalName: string, until?: string): void {
    if (this.warnedAliases.has(aliasName)) return;
    this.warnedAliases.add(aliasName);
    const expiry = until ? ` (removal scheduled after ${until})` : '';
    this.log.warn(
      `[event-catalog] publish("${aliasName}") routed via deprecated alias — `
      + `canonical name is "${canonicalName}". Update producers to emit the `
      + `canonical name${expiry}.`,
      { alias: aliasName, eventName: canonicalName, until },
    );
  }

  /**
   * Retry the declaration sync in the background with exponential back-off.
   *
   * At most one chain is ever pending: the handle is tracked so
   * `disconnect()` can clear it, and a second `scheduleBackgroundSync()`
   * replaces the first rather than running two chains. Before this, a
   * connect/disconnect/connect cycle after repeated sync failures left one
   * live chain per cycle, all re-syncing forever.
   */
  private scheduleBackgroundSync(): void {
    const attempt = (delay: number): void => {
      if (this.backgroundSyncTimer) clearTimeout(this.backgroundSyncTimer);
      this.backgroundSyncTimer = setTimeout(() => {
        this.backgroundSyncTimer = null;
        if (!this.connected || !this.config.registryUrl) return;
        this.syncToRemoteRegistry().catch(() => {
          const nextDelay = Math.min(delay * 2, 60_000);
          this.log.warn(
            `[event-catalog] background sync retry failed, next attempt in ${nextDelay}ms`,
            {
              registryUrl: this.config.registryUrl,
              serviceName: this.config.serviceName,
              nextAttemptInMs: nextDelay,
            },
          );
          attempt(nextDelay);
        });
      }, delay);
    };
    attempt(5_000);
  }

  private async syncToRemoteRegistry(): Promise<void> {
    const entries = this.registry.list();
    if (entries.length === 0) return;

    const url = `${this.config.registryUrl}/api/events/bulk`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.registryHeaders(),
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

    // Without this a registry answering 500 produced one POST, no retry, no
    // background re-sync and no log — the service believed it had registered
    // its declarations. The caller wraps this in a RetryManager and falls back
    // to a background re-sync, but only if it is told the attempt failed.
    if (!res.ok) {
      throw new Error(
        `[event-catalog] registry sync rejected by ${this.config.registryUrl}: HTTP ${res.status}`,
      );
    }
  }

  private async registerSubscriberRemote(eventName: string): Promise<void> {
    if (!this.config.registryUrl) return;

    const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}/subscribers`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.registryHeaders(),
      body: JSON.stringify({ serviceName: this.config.serviceName }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  }

  private async deregisterSubscriberRemote(eventName: string): Promise<void> {
    if (!this.config.registryUrl) return;

    const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}/subscribers/${encodeURIComponent(this.config.serviceName)}`;

    const res = await fetch(url, {
      method: 'DELETE',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  }
}
