export { EventCatalog } from './client/index.js';
export { Registry } from './registry/index.js';
export { SignalTransport } from './client/signal.js';
export { DurableTransport } from './client/durable.js';

export type {
  TransportType,
  EventDeclaration,
  EventCatalogConfig,
  PublishOptions,
  SubscribeOptions,
  EventMetadata,
  EventEnvelope,
  EventHandler,
  Subscription,
  EventStats,
  TopologyNode,
  TopologyEdge,
  TopologyGraph,
  HealthStatus,
  RegistryEntry,
  RegistryFilter,
} from './types/index.js';

export type { ValidationResult, IRegistry } from './registry/types.js';
export type { SignalTransportConfig } from './client/signal.js';
export type { DurableTransportConfig, DurableSubscribeOptions } from './client/durable.js';
