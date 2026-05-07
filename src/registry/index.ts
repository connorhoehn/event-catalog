import Ajv from 'ajv';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyNode, TopologyEdge } from '../types/index';
import type { IRegistry, ValidationResult } from './types';

export class Registry implements IRegistry {
  private events = new Map<string, RegistryEntry>();
  private ajv: Ajv;
  private validators = new Map<string, ReturnType<Ajv['compile']>>();

  constructor() {
    this.ajv = new Ajv({ strict: false, allErrors: true });
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
      this.validators.delete(event.name);
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
    this.validators.delete(eventName);
    return this.events.delete(eventName);
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

    let validateFn = this.validators.get(eventName);
    if (!validateFn) {
      try {
        validateFn = this.ajv.compile(entry.schema);
        this.validators.set(eventName, validateFn);
      } catch (err) {
        return { valid: false, errors: [{ message: `Invalid schema: ${(err as Error).message}` }] };
      }
    }

    const valid = validateFn(payload);
    if (valid) return { valid: true };

    const errors = (validateFn.errors ?? []).map(e => ({
      message: e.message ?? 'validation error',
      path: e.instancePath || undefined,
    }));

    return { valid: false, errors };
  }

  size(): number {
    return this.events.size;
  }

  clear(): void {
    this.events.clear();
    this.validators.clear();
  }
}
