import { JsonSchemaValidator } from 'distributed-core';
import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyNode, TopologyEdge } from '../types/index';
import type { IRegistry, ValidationResult } from './types';

const REDIS_KEY = 'event-catalog:registry';

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

  declare(event: EventDeclaration): void {
    const existing = this.events.get(event.name);

    if (existing) {
      existing.schema = event.schema;
      existing.description = event.description;
      existing.tags = event.tags;
      if (event.producer && !existing.producer) {
        existing.producer = event.producer;
      }
      this.persist(event.name, existing);
      return;
    }

    const entry: RegistryEntry = {
      ...event,
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
  }

  get(name: string): RegistryEntry | undefined {
    return this.events.get(name);
  }

  list(filter?: RegistryFilter): RegistryEntry[] {
    let entries = Array.from(this.events.values());

    if (filter?.transport) {
      entries = entries.filter(e => e.transport === filter.transport);
    }
    if (filter?.producer) {
      entries = entries.filter(e => e.producer === filter.producer);
    }
    if (filter?.subscriber) {
      entries = entries.filter(e => e.subscribers.includes(filter.subscriber!));
    }
    if (filter?.tag) {
      entries = entries.filter(e => e.tags?.includes(filter.tag!) ?? false);
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

  getTopology(): TopologyGraph {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];
    const servicesSeen = new Set<string>();

    for (const entry of this.events.values()) {
      nodes.push({
        id: entry.name,
        type: 'event',
        metadata: { transport: entry.transport, description: entry.description },
      });

      if (!servicesSeen.has(entry.producer)) {
        servicesSeen.add(entry.producer);
        nodes.push({ id: entry.producer, type: 'service', metadata: {} });
      }

      edges.push({ from: entry.producer, to: entry.name, relation: 'publishes' });

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

  private persist(name: string, entry: RegistryEntry): void {
    if (!this.redis) return;
    this.redis.hSet(REDIS_KEY, name, JSON.stringify(entry)).catch(() => {});
  }
}
