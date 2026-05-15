import { JsonSchemaValidator } from 'distributed-core/messaging-queue';
import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyNode, TopologyEdge, TopologyFilter, CompatibilityMode } from '../types/index';
import type { IRegistry, ValidationResult, DeclareResult } from './types';
import { checkBackwardCompat, checkForwardCompat, type CompatResult } from './schema-compat';
import { computeSchemaFingerprint } from './fingerprint';
import { resolveNamespace } from './namespace';

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

export class Registry implements IRegistry {
  private events = new Map<string, RegistryEntry>();
  private readonly schemaValidator: JsonSchemaValidator;
  private readonly redis: RedisClientType | null;

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
  resolve(name: string): { entry: RegistryEntry; viaAlias?: { name: string; until?: string } } | undefined {
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
  }

  removeSubscriber(eventName: string, serviceName: string): void {
    const entry = this.events.get(eventName);
    if (!entry) return;
    entry.subscribers = entry.subscribers.filter(s => s !== serviceName);
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
