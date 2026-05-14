"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = void 0;
const distributed_core_1 = require("distributed-core");
const schema_compat_1 = require("./schema-compat");
const REDIS_KEY = 'event-catalog:registry';
/** Normalize EventDeclaration.producer to an always-array form. */
function producerList(producer) {
    return Array.isArray(producer) ? producer : [producer];
}
/**
 * AND-combine TopologyFilter predicates against a single registry entry.
 * Empty/missing filter returns true (no filter ⇒ include everything).
 * Each predicate is exact-match on the relevant field.
 */
function matchesTopologyFilter(entry, filter) {
    if (!filter)
        return true;
    if (filter.eventType && entry.name !== filter.eventType)
        return false;
    if (filter.transport && entry.transport !== filter.transport)
        return false;
    if (filter.producer && !producerList(entry.producer).includes(filter.producer))
        return false;
    if (filter.consumer && !entry.subscribers.includes(filter.consumer))
        return false;
    return true;
}
class Registry {
    events = new Map();
    schemaValidator;
    redis;
    constructor(redis) {
        this.schemaValidator = new distributed_core_1.JsonSchemaValidator({ mode: 'auto' });
        this.redis = redis ?? null;
    }
    async load() {
        if (!this.redis)
            return;
        const entries = await this.redis.hGetAll(REDIS_KEY);
        for (const [name, json] of Object.entries(entries)) {
            this.events.set(name, JSON.parse(json));
        }
    }
    declare(event) {
        const existing = this.events.get(event.name);
        if (existing) {
            const schemaChanged = JSON.stringify(existing.schema) !== JSON.stringify(event.schema);
            const mode = event.compatibilityMode ?? existing.compatibilityMode;
            let compatible = true;
            let violations;
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
            return { version: existing.version, compatible, violations };
        }
        const entry = {
            ...event,
            version: event.version ?? 1,
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
        return { version: entry.version, compatible: true };
    }
    get(name) {
        return this.events.get(name);
    }
    list(filter) {
        let entries = Array.from(this.events.values());
        if (filter?.transport) {
            entries = entries.filter(e => e.transport === filter.transport);
        }
        if (filter?.producer) {
            entries = entries.filter(e => producerList(e.producer).includes(filter.producer));
        }
        if (filter?.subscriber) {
            entries = entries.filter(e => e.subscribers.includes(filter.subscriber));
        }
        if (filter?.tag) {
            entries = entries.filter(e => e.tags?.includes(filter.tag) ?? false);
        }
        return entries;
    }
    addSubscriber(eventName, serviceName) {
        const entry = this.events.get(eventName);
        if (!entry)
            return;
        if (!entry.subscribers.includes(serviceName)) {
            entry.subscribers.push(serviceName);
        }
    }
    removeSubscriber(eventName, serviceName) {
        const entry = this.events.get(eventName);
        if (!entry)
            return;
        entry.subscribers = entry.subscribers.filter(s => s !== serviceName);
    }
    updateStats(eventName, stats) {
        const entry = this.events.get(eventName);
        if (!entry)
            return;
        Object.assign(entry.metadata, stats);
    }
    remove(eventName) {
        const deleted = this.events.delete(eventName);
        if (deleted && this.redis) {
            this.redis.hDel(REDIS_KEY, eventName).catch(() => { });
        }
        return deleted;
    }
    getTopology(filter) {
        const nodes = [];
        const edges = [];
        const servicesSeen = new Set();
        for (const entry of this.events.values()) {
            if (!matchesTopologyFilter(entry, filter))
                continue;
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
    validate(eventName, payload) {
        const entry = this.events.get(eventName);
        if (!entry) {
            return { valid: false, errors: [{ message: `Event "${eventName}" is not declared` }] };
        }
        if (!entry.schema || Object.keys(entry.schema).length === 0) {
            return { valid: true };
        }
        const result = this.schemaValidator.validate(entry.schema, payload);
        if (result.ok)
            return { valid: true };
        const errors = (result.errors ?? []).map(e => ({
            message: e.message,
            path: e.path || undefined,
        }));
        return { valid: false, errors };
    }
    size() {
        return this.events.size;
    }
    clear() {
        this.events.clear();
    }
    checkSchemaCompat(eventName, proposedSchema) {
        const entry = this.events.get(eventName);
        if (!entry) {
            return { compatible: true, violations: [] };
        }
        return this.runCompatCheck(entry.compatibilityMode, entry.schema, proposedSchema);
    }
    runCompatCheck(mode, oldSchema, newSchema) {
        if (mode === 'none') {
            return { compatible: true, violations: [] };
        }
        if (mode === 'backward') {
            return (0, schema_compat_1.checkBackwardCompat)(oldSchema, newSchema);
        }
        if (mode === 'forward') {
            return (0, schema_compat_1.checkForwardCompat)(oldSchema, newSchema);
        }
        // full — both must pass
        const backward = (0, schema_compat_1.checkBackwardCompat)(oldSchema, newSchema);
        const forward = (0, schema_compat_1.checkForwardCompat)(oldSchema, newSchema);
        const violations = [...backward.violations, ...forward.violations];
        return { compatible: violations.length === 0, violations };
    }
    persist(name, entry) {
        if (!this.redis)
            return;
        this.redis.hSet(REDIS_KEY, name, JSON.stringify(entry)).catch(() => { });
    }
}
exports.Registry = Registry;
//# sourceMappingURL=index.js.map