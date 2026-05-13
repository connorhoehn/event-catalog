import type { RedisClientType } from 'redis';
import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph } from '../types/index';
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
    list(filter?: RegistryFilter): RegistryEntry[];
    addSubscriber(eventName: string, serviceName: string): void;
    removeSubscriber(eventName: string, serviceName: string): void;
    updateStats(eventName: string, stats: Partial<RegistryEntry['metadata']>): void;
    remove(eventName: string): boolean;
    getTopology(): TopologyGraph;
    validate(eventName: string, payload: unknown): ValidationResult;
    size(): number;
    clear(): void;
    checkSchemaCompat(eventName: string, proposedSchema: Record<string, unknown>): CompatResult;
    private runCompatCheck;
    private persist;
}
//# sourceMappingURL=index.d.ts.map