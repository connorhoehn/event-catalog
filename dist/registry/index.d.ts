import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph } from '../types/index';
import type { IRegistry, ValidationResult } from './types';
export declare class Registry implements IRegistry {
    private events;
    private readonly schemaValidator;
    constructor();
    declare(event: EventDeclaration): void;
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
}
//# sourceMappingURL=index.d.ts.map