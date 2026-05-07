"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = void 0;
const distributed_core_1 = require("distributed-core");
class Registry {
    events = new Map();
    schemaValidator;
    constructor() {
        this.schemaValidator = new distributed_core_1.JsonSchemaValidator({ mode: 'auto' });
    }
    declare(event) {
        const existing = this.events.get(event.name);
        if (existing) {
            existing.schema = event.schema;
            existing.description = event.description;
            existing.tags = event.tags;
            if (event.producer && !existing.producer) {
                existing.producer = event.producer;
            }
            return;
        }
        const entry = {
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
    get(name) {
        return this.events.get(name);
    }
    list(filter) {
        let entries = Array.from(this.events.values());
        if (filter?.transport) {
            entries = entries.filter(e => e.transport === filter.transport);
        }
        if (filter?.producer) {
            entries = entries.filter(e => e.producer === filter.producer);
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
        return this.events.delete(eventName);
    }
    getTopology() {
        const nodes = [];
        const edges = [];
        const servicesSeen = new Set();
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
}
exports.Registry = Registry;
//# sourceMappingURL=index.js.map