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

/**
 * AND-combine TopologyFilter predicates against a single registry entry.
 * Empty/missing filter returns true (no filter ⇒ include everything).
 * Each predicate is exact-match on the relevant field.
 */
function matchesTopologyFilter(entry: RegistryEntry, filter?: TopologyFilter): boolean {
  if (!filter) return true;
  if (filter.eventType && entry.name !== filter.eventType) return false;
  if (filter.transport && entry.transport !== filter.transport) return false;
  if (filter.producer && !producerList(entry.producer).includes(filter.producer)) return false;
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

    for (const entry of this.events.values()) {
      const match = entry.aliases?.find((a) => a.name === name);
      if (match) {
        return { entry, viaAlias: { name: match.name, until: match.until } };
      }
    }

    return undefined;
  }

  list(filter?: RegistryFilter): RegistryEntry[] {
    let entries = Array.from(this.events.values());

    if (filter?.transport) {
      entries = entries.filter(e => e.transport === filter.transport);
    }
    if (filter?.producer) {
      entries = entries.filter(e => producerList(e.producer).includes(filter.producer!));
    }
    if (filter?.subscriber) {
      entries = entries.filter(e => e.subscribers.includes(filter.subscriber!));
    }
    if (filter?.tag) {
      entries = entries.filter(e => e.tags?.includes(filter.tag!) ?? false);
    }
    // Phase E7 — namespace filter (exact match).
    if (filter?.namespace) {
      entries = entries.filter(e => e.namespace === filter.namespace);
    }

    return entries;
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
  }

  removeSubscriber(eventName: string, serviceName: string): void {
    const entry = this.events.get(eventName);
    if (!entry) return;
    entry.subscribers = entry.subscribers.filter(s => s !== serviceName);
    this.subscriberHeartbeats.delete(heartbeatKey(eventName, serviceName));
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
        metadata: { transport: entry.transport, description: entry.description },
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
