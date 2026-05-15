import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyFilter } from '../types/index';
import type { IRegistry, ValidationResult, DeclareResult } from './types';
import { type CompatResult } from './schema-compat';
export declare class Registry implements IRegistry {
    private events;
    private readonly schemaValidator;
    private readonly redis;
    constructor(redis?: RedisClientType);
    load(): Promise<void>;
    declare(event: EventDeclaration): DeclareResult;
    get(name: string): RegistryEntry | undefined;
    /**
     * Phase E3.5 — alias-aware lookup.
     *
     * Returns the canonical RegistryEntry for `name`, whether `name` is the
     * canonical event name or a deprecated alias declared on some canonical
     * event. When `name` resolves via an alias, `viaAlias` carries the alias
     * record so callers can surface a deprecation warning.
     */
    resolve(name: string): {
        entry: RegistryEntry;
        viaAlias?: {
            name: string;
            until?: string;
        };
    } | undefined;
    list(filter?: RegistryFilter): RegistryEntry[];
    addSubscriber(eventName: string, serviceName: string): void;
    removeSubscriber(eventName: string, serviceName: string): void;
    updateStats(eventName: string, stats: Partial<RegistryEntry['metadata']>): void;
    remove(eventName: string): boolean;
    getTopology(filter?: TopologyFilter): TopologyGraph;
    validate(eventName: string, payload: unknown): ValidationResult;
    size(): number;
    clear(): void;
    checkSchemaCompat(eventName: string, proposedSchema: Record<string, unknown>): CompatResult;
    private runCompatCheck;
    private persist;
}
//# sourceMappingURL=index.d.ts.map