import { JsonSchemaValidator } from 'distributed-core/messaging-queue';
import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyNode, TopologyEdge, TopologyFilter, CompatibilityMode } from '../types/index';
import type { IRegistry, ValidationResult, DeclareResult, ResolveResult } from './types';
import { checkBackwardCompat, checkForwardCompat, type CompatResult } from './schema-compat';
import { computeSchemaFingerprint } from './fingerprint';
import { resolveNamespace } from './namespace';
import { validateSchemaShape } from './schema-shape';

const REDIS_KEY = 'event-catalog:registry';

/** Normalize EventDeclaration.producer to an always-array form. */
function producerList(producer: string | string[]): string[] {
  return Array.isArray(producer) ? producer : [producer];
}

/** Membership test on the string-or-array `producer` field, allocation-free. */
function hasProducer(producer: string | string[], candidate: string): boolean {
  return Array.isArray(producer) ? producer.includes(candidate) : producer === candidate;
}

/**
 * AND-combine TopologyFilter predicates against a single registry entry.
 * Empty/missing filter returns true (no filter ⇒ include everything).
 * Each predicate is exact-match on the relevant field.
 */
function matchesTopologyFilter(entry: RegistryEntry, filter?: TopologyFilter): boolean {
  if (!filter) return true;
  if (filter.eventType && entry.name !== filter.eventType) return false;
  if (filter.transport && entry.transport !== filter.transport) return false;
  if (filter.producer && !hasProducer(entry.producer, filter.producer)) return false;
  if (filter.consumer && !entry.subscribers.includes(filter.consumer)) return false;
  // Phase E7 — namespace filter on the topology graph.
  if (filter.namespace && entry.namespace !== filter.namespace) return false;
  return true;
}

/**
 * wave24-b — composite key for the heartbeat map. Subscribers are
 * unique per (eventName, serviceName), not per serviceName alone.
 */
function heartbeatKey(eventName: string, serviceName: string): string {
  return `${eventName}\x00${serviceName}`;
}

export class Registry implements IRegistry {
  private events = new Map<string, RegistryEntry>();
  private readonly schemaValidator: JsonSchemaValidator;
  private readonly redis: RedisClientType | null;
  /** wave24-b — map keyed by `${eventName}\x00${serviceName}` → epoch ms. */
  private subscriberHeartbeats = new Map<string, number>();
  /**
   * alias name → canonical event name. Built lazily on the first alias
   * lookup and dropped whenever the event map changes. `resolve()` sits on
   * the publish hot path and used to walk every entry on the alias branch,
   * which cost ~24µs on a 5k-event registry — 20x a whole publish.
   */
  private aliasIndex: Map<string, string> | null = null;

  constructor(redis?: RedisClientType) {
    this.schemaValidator = new JsonSchemaValidator({ mode: 'auto' });
    this.redis = redis ?? null;
  }

  async load(): Promise<void> {
    if (!this.redis) return;
    const entries = await this.redis.hGetAll(REDIS_KEY);
    for (const [name, json] of Object.entries(entries)) {
      this.events.set(name, JSON.parse(json) as RegistryEntry);
    }
    this.aliasIndex = null;
    this.migrateHistoryFingerprints();
  }

  /**
   * Full-state resync from the shared Redis hash — delete-aware, unlike
   * `load()`, which only overlays. This is the repair path for a replica
   * that missed pub/sub broadcasts: Redis pub/sub offers no replay, so
   * the persisted hash is the only shared record of current truth.
   *
   * Returns false when the registry has no Redis backing (single-process
   * mode), so the caller can tell "resynced" from "cannot resync".
   */
  async reload(): Promise<boolean> {
    if (!this.redis) return false;
    const entries = await this.redis.hGetAll(REDIS_KEY);
    const next = new Map<string, RegistryEntry>();
    for (const [name, json] of Object.entries(entries)) {
      next.set(name, JSON.parse(json) as RegistryEntry);
    }
    this.events = next;
    this.aliasIndex = null;
    this.migrateHistoryFingerprints();
    return true;
  }

  /**
   * Phase E6.5 — backfill `fingerprint` on `schemaHistory` entries that
   * lack it (entries persisted before wave19-h, when the field was
   * introduced). Idempotent: returns 0 when every history entry already
   * carries a fingerprint. Called from `load()` after Redis hydration;
   * exposed publicly so a one-shot CLI / test can drive it.
   */
  migrateHistoryFingerprints(): number {
    let backfilled = 0;
    for (const [name, entry] of this.events) {
      let touched = false;
      for (const hist of entry.schemaHistory) {
        if (!hist.fingerprint) {
          hist.fingerprint = computeSchemaFingerprint(hist.schema ?? {});
          backfilled++;
          touched = true;
        }
      }
      if (touched) this.persist(name, entry);
    }
    return backfilled;
  }

  declare(event: EventDeclaration): DeclareResult {
    // wave22-a — meta-validate the schema shape before anything else.
    // Empty schema ({}) is allowed; non-object or malformed schemas
    // are rejected at declare-time so a typo doesn't sit in the
    // registry until the first publish trips Ajv.
    if (event.schema && Object.keys(event.schema).length > 0) {
      const shape = validateSchemaShape(event.schema);
      if (!shape.ok) {
        throw new Error(
          `[event-catalog] declare("${event.name}") rejected: invalid JSON Schema shape: ${shape.errors.join('; ')}`,
        );
      }
    }

    const existing = this.events.get(event.name);

    if (existing) {
      const schemaChanged = JSON.stringify(existing.schema) !== JSON.stringify(event.schema);
      const mode = event.compatibilityMode ?? existing.compatibilityMode;
      let compatible = true;
      let violations: string[] | undefined;

      if (schemaChanged && Object.keys(event.schema).length > 0) {
        const result = this.runCompatCheck(mode, existing.schema, event.schema);
        compatible = result.compatible;
        violations = result.violations.length > 0 ? result.violations : undefined;

        existing.schemaHistory.push({
          version: existing.version,
          schema: existing.schema,
          // Phase E6.5 — stash the prior schema's fingerprint so a
          // consumer with a cached fingerprint can ask
          // "is X somewhere in my history?" without recomputing.
          fingerprint: existing.schemaFingerprint,
          updatedAt: new Date().toISOString(),
        });
        if (existing.schemaHistory.length > 5) {
          existing.schemaHistory = existing.schemaHistory.slice(-5);
        }

        existing.version += 1;
      }

      existing.schema = event.schema;
      // Phase E6 — recompute fingerprint whenever the schema is replaced.
      // Stays in lockstep with `version` bumps.
      if (schemaChanged) {
        existing.schemaFingerprint = computeSchemaFingerprint(event.schema);
      }
      existing.description = event.description;
      existing.tags = event.tags;
      if (event.compatibilityMode) {
        existing.compatibilityMode = event.compatibilityMode;
      }
      // EC-7 — per-event enforcement override is sticky once set; an
      // incoming declaration may upgrade/downgrade it explicitly.
      if (event.compatMode) {
        existing.compatMode = event.compatMode;
      }
      if (event.producer && !existing.producer) {
        existing.producer = event.producer;
      }
      this.persist(event.name, existing);
      return {
        version: existing.version,
        compatible,
        violations,
        schemaFingerprint: existing.schemaFingerprint,
      };
    }

    const entry: RegistryEntry = {
      ...event,
      version: event.version ?? 1,
      // Phase E6 — fingerprint computed at creation. Empty schema (e.g.
      // bulk-registration entries that lack a schema) gets the fingerprint
      // of `{}` so the field is always present.
      schemaFingerprint: computeSchemaFingerprint(event.schema ?? {}),
      // Phase E7 — namespace is auto-derived from the event name when not
      // explicitly declared. Always populated on RegistryEntry.
      namespace: resolveNamespace(event.name, event.namespace),
      compatibilityMode: event.compatibilityMode ?? 'backward',
      schemaHistory: [],
      subscribers: [],
      metadata: {
        createdAt: new Date().toISOString(),
        lastPublishedAt: null,
        publishCount: 0,
        errorCount: 0,
      },
    };

    this.events.set(event.name, entry);
    this.aliasIndex = null;
    this.persist(event.name, entry);
    return {
      version: entry.version,
      compatible: true,
      schemaFingerprint: entry.schemaFingerprint,
    };
  }

  get(name: string): RegistryEntry | undefined {
    return this.events.get(name);
  }

  /**
   * Phase E3.5 — alias-aware lookup.
   *
   * Returns the canonical RegistryEntry for `name`, whether `name` is the
   * canonical event name or a deprecated alias declared on some canonical
   * event. When `name` resolves via an alias, `viaAlias` carries the alias
   * record so callers can surface a deprecation warning.
   */
  resolve(name: string): ResolveResult | undefined {
    const direct = this.events.get(name);
    if (direct) return { entry: direct };

    const canonical = this.getAliasIndex().get(name);
    if (canonical === undefined) return undefined;

    const entry = this.events.get(canonical);
    if (!entry) return undefined;
    const match = entry.aliases?.find((a) => a.name === name);
    if (!match) return undefined;
    return { entry, viaAlias: { name: match.name, until: match.until } };
  }

  /**
   * Build (or reuse) the alias → canonical-name index. Invalidated by any
   * change to the event map, so it can never outlive the declarations it
   * was derived from. Insertion order is preserved, which keeps the
   * first-declaration-wins behaviour of the old linear scan when two
   * events declare the same alias.
   */
  private getAliasIndex(): Map<string, string> {
    if (this.aliasIndex) return this.aliasIndex;
    const index = new Map<string, string>();
    for (const entry of this.events.values()) {
      for (const alias of entry.aliases ?? []) {
        if (!index.has(alias.name)) index.set(alias.name, entry.name);
      }
    }
    this.aliasIndex = index;
    return index;
  }

  list(filter?: RegistryFilter): RegistryEntry[] {
    if (!filter) return Array.from(this.events.values());

    // One pass, one output array. The previous shape chained a `.filter()`
    // per criterion, so a three-criteria query walked and re-allocated the
    // whole registry four times over.
    const { transport, producer, subscriber, tag, namespace } = filter;
    const out: RegistryEntry[] = [];
    for (const e of this.events.values()) {
      if (transport && e.transport !== transport) continue;
      if (producer && !hasProducer(e.producer, producer)) continue;
      if (subscriber && !e.subscribers.includes(subscriber)) continue;
      if (tag && !(e.tags?.includes(tag) ?? false)) continue;
      // Phase E7 — namespace filter (exact match).
      if (namespace && e.namespace !== namespace) continue;
      out.push(e);
    }
    return out;
  }

  addSubscriber(eventName: string, serviceName: string): void {
    const entry = this.events.get(eventName);
    if (!entry) return;
    if (!entry.subscribers.includes(serviceName)) {
      entry.subscribers.push(serviceName);
    }
    // wave24-b — also stamp a heartbeat so the sweeper has a baseline
    // for "when did we last hear from this consumer?"
    this.touchHeartbeat(eventName, serviceName);
    // Subscribers used to live only in memory, so a restart — or a
    // multi-replica resync, which reads this hash — silently lost
    // "who consumes X?", the question the registry exists to answer.
    this.persist(eventName, entry);
  }

  removeSubscriber(eventName: string, serviceName: string): void {
    const entry = this.events.get(eventName);
    if (!entry) return;
    entry.subscribers = entry.subscribers.filter(s => s !== serviceName);
    this.subscriberHeartbeats.delete(heartbeatKey(eventName, serviceName));
    this.persist(eventName, entry);
  }

  /**
   * wave24-b — refresh a subscriber's lastSeenAt for one event or all
   * events it currently subscribes to (when `eventNames` is omitted).
   * Used by POST /api/heartbeat. Returns the list of events that were
   * actually refreshed (skipping any the consumer wasn't subscribed to).
   */
  heartbeat(serviceName: string, eventNames?: string[]): string[] {
    const refreshed: string[] = [];
    const targets = eventNames ?? this.eventsSubscribedBy(serviceName);
    for (const name of targets) {
      const entry = this.events.get(name);
      if (!entry || !entry.subscribers.includes(serviceName)) continue;
      this.touchHeartbeat(name, serviceName);
      refreshed.push(name);
    }
    return refreshed;
  }

  /** wave24-b — list events a service currently subscribes to. */
  eventsSubscribedBy(serviceName: string): string[] {
    const out: string[] = [];
    for (const entry of this.events.values()) {
      if (entry.subscribers.includes(serviceName)) out.push(entry.name);
    }
    return out;
  }

  /**
   * wave24-b — return all subscriber records with their last-seen
   * timestamps. Each entry is `{ eventName, serviceName, lastSeenAt }`.
   * For the admin UI's "Subscribers" view + the GET /api/subscribers
   * surface.
   */
  listSubscriberHeartbeats(): Array<{ eventName: string; serviceName: string; lastSeenAt: string }> {
    const out: Array<{ eventName: string; serviceName: string; lastSeenAt: string }> = [];
    for (const entry of this.events.values()) {
      for (const s of entry.subscribers) {
        const ts = this.subscriberHeartbeats.get(heartbeatKey(entry.name, s));
        out.push({
          eventName: entry.name,
          serviceName: s,
          lastSeenAt: ts ? new Date(ts).toISOString() : '1970-01-01T00:00:00.000Z',
        });
      }
    }
    return out;
  }

  /**
   * wave24-b — remove subscriber records older than `ttlMs`.
   * Returns the list of `{ eventName, serviceName }` pairs that were
   * pruned so callers can audit / log / emit.
   */
  pruneStaleSubscribers(ttlMs: number, nowMs: number = Date.now()): Array<{ eventName: string; serviceName: string }> {
    const pruned: Array<{ eventName: string; serviceName: string }> = [];
    const cutoff = nowMs - ttlMs;
    for (const entry of this.events.values()) {
      const stillSubscribed: string[] = [];
      for (const s of entry.subscribers) {
        const ts = this.subscriberHeartbeats.get(heartbeatKey(entry.name, s)) ?? 0;
        if (ts < cutoff) {
          pruned.push({ eventName: entry.name, serviceName: s });
          this.subscriberHeartbeats.delete(heartbeatKey(entry.name, s));
        } else {
          stillSubscribed.push(s);
        }
      }
      entry.subscribers = stillSubscribed;
    }
    return pruned;
  }

  private touchHeartbeat(eventName: string, serviceName: string): void {
    this.subscriberHeartbeats.set(heartbeatKey(eventName, serviceName), Date.now());
  }

  updateStats(eventName: string, stats: Partial<RegistryEntry['metadata']>): void {
    const entry = this.events.get(eventName);
    if (!entry) return;
    Object.assign(entry.metadata, stats);
  }

  remove(eventName: string): boolean {
    const deleted = this.events.delete(eventName);
    if (deleted) this.aliasIndex = null;
    if (deleted && this.redis) {
      this.redis.hDel(REDIS_KEY, eventName).catch(() => {});
    }
    return deleted;
  }

  /**
   * wave25-a — mark an event as deprecated. Publish still works
   * (don't break existing producers); the catalog logs a warn at
   * publish time when warnOnDeprecated is on. Idempotent: re-calling
   * with new metadata updates the deprecation record. Returns true if
   * the event existed (and was marked or remarked).
   */
  deprecate(eventName: string, opts?: { reason?: string; by?: string }): boolean {
    const entry = this.events.get(eventName);
    if (!entry) return false;
    entry.deprecation = {
      deprecatedAt: new Date().toISOString(),
      reason: opts?.reason,
      by: opts?.by,
    };
    if (this.redis) {
      this.redis.hSet(REDIS_KEY, eventName, JSON.stringify(entry)).catch(() => {});
    }
    return true;
  }

  /**
   * wave25-a — clear the deprecation flag. Returns true if the event
   * existed and was previously deprecated; false if no-op.
   */
  undeprecate(eventName: string): boolean {
    const entry = this.events.get(eventName);
    if (!entry || !entry.deprecation) return false;
    delete entry.deprecation;
    if (this.redis) {
      this.redis.hSet(REDIS_KEY, eventName, JSON.stringify(entry)).catch(() => {});
    }
    return true;
  }

  /** wave25-a — convenience: every currently-deprecated event. */
  listDeprecated(): RegistryEntry[] {
    return Array.from(this.events.values()).filter(e => !!e.deprecation);
  }

  getTopology(filter?: TopologyFilter): TopologyGraph {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];
    const servicesSeen = new Set<string>();

    for (const entry of this.events.values()) {
      if (!matchesTopologyFilter(entry, filter)) continue;

      nodes.push({
        id: entry.name,
        type: 'event',
        // Phase E7/E8.4 — `namespace` is what the admin TopologyView and
        // FlowView build their namespace <select> from, and what
        // NamespaceClusters uses to draw the cluster overlay. Omitting it
        // left the dropdown stuck on "all" and the overlay never drawn.
        metadata: {
          transport: entry.transport,
          description: entry.description,
          namespace: entry.namespace,
        },
      });

      for (const producer of producerList(entry.producer)) {
        if (!servicesSeen.has(producer)) {
          servicesSeen.add(producer);
          nodes.push({ id: producer, type: 'service', metadata: {} });
        }
        edges.push({ from: producer, to: entry.name, relation: 'publishes' });
      }

      for (const sub of entry.subscribers) {
        if (!servicesSeen.has(sub)) {
          servicesSeen.add(sub);
          nodes.push({ id: sub, type: 'service', metadata: {} });
        }
        edges.push({ from: entry.name, to: sub, relation: 'subscribes' });
      }
    }

    return { nodes, edges };
  }

  validate(eventName: string, payload: unknown): ValidationResult {
    const entry = this.events.get(eventName);
    if (!entry) {
      return { valid: false, errors: [{ message: `Event "${eventName}" is not declared` }] };
    }

    if (!entry.schema || Object.keys(entry.schema).length === 0) {
      return { valid: true };
    }

    const result = this.schemaValidator.validate(entry.schema, payload);
    if (result.ok) return { valid: true };

    const errors = (result.errors ?? []).map(e => ({
      message: e.message,
      path: e.path || undefined,
    }));

    return { valid: false, errors };
  }

  size(): number {
    return this.events.size;
  }

  clear(): void {
    this.events.clear();
    this.aliasIndex = null;
  }

  checkSchemaCompat(eventName: string, proposedSchema: Record<string, unknown>): CompatResult {
    const entry = this.events.get(eventName);
    if (!entry) {
      return { compatible: true, violations: [] };
    }
    return this.runCompatCheck(entry.compatibilityMode, entry.schema, proposedSchema);
  }

  private runCompatCheck(mode: CompatibilityMode, oldSchema: Record<string, unknown>, newSchema: Record<string, unknown>): CompatResult {
    if (mode === 'none') {
      return { compatible: true, violations: [] };
    }

    if (mode === 'backward') {
      return checkBackwardCompat(oldSchema, newSchema);
    }

    if (mode === 'forward') {
      return checkForwardCompat(oldSchema, newSchema);
    }

    // full — both must pass
    const backward = checkBackwardCompat(oldSchema, newSchema);
    const forward = checkForwardCompat(oldSchema, newSchema);
    const violations = [...backward.violations, ...forward.violations];
    return { compatible: violations.length === 0, violations };
  }

  private persist(name: string, entry: RegistryEntry): void {
    if (!this.redis) return;
    this.redis.hSet(REDIS_KEY, name, JSON.stringify(entry)).catch(() => {});
  }
}
