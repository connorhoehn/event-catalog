import type { EventDeclaration, RegistryEntry, RegistryFilter, TopologyGraph, TopologyFilter } from '../types/index';
import type { CompatResult } from './schema-compat';

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ message: string; path?: string }>;
}

export interface DeclareResult {
  version: number;
  compatible: boolean;
  violations?: string[];
  /** Phase E6 — sha256 of the canonical schema serialization. */
  schemaFingerprint: string;
}

/**
 * Phase 20-a — public shape of `Registry.resolve()` results.
 *
 * `entry` is the canonical RegistryEntry regardless of whether the
 * caller queried by canonical name or a deprecated alias. `viaAlias`
 * is present only on the alias path, carrying the alias name + optional
 * `until` cutoff so callers can surface "this name is deprecated".
 */
export interface ResolveResult {
  entry: RegistryEntry;
  viaAlias?: {
    name: string;
    until?: string;
  };
}

export interface IRegistry {
  declare(event: EventDeclaration): DeclareResult;
  get(name: string): RegistryEntry | undefined;
  list(filter?: RegistryFilter): RegistryEntry[];
  addSubscriber(eventName: string, serviceName: string): void;
  removeSubscriber(eventName: string, serviceName: string): void;
  updateStats(eventName: string, stats: Partial<RegistryEntry['metadata']>): void;
  remove(eventName: string): boolean;
  getTopology(filter?: TopologyFilter): TopologyGraph;
  validate(eventName: string, payload: unknown): ValidationResult;
  checkSchemaCompat(eventName: string, proposedSchema: Record<string, unknown>): CompatResult;
  size(): number;
  clear(): void;
}
