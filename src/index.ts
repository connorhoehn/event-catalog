export { EventCatalog } from './client/index';
export { Registry } from './registry/index';
export { SignalTransport } from './client/signal';
export { DurableTransport } from './client/durable';

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
} from './types/index';

export type { ValidationResult, IRegistry } from './registry/types';
export type { SignalTransportConfig } from './client/signal';
export type { DurableTransportConfig, DurableSubscribeOptions } from './client/durable';
