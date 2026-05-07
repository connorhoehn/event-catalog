import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ message: string; path?: string }>;
}

export interface IRegistry {
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
