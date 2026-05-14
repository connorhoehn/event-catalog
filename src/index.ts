export { EventCatalog } from './client/index';
export { Registry } from './registry/index';
export { SignalTransport } from './client/signal';
export { DurableTransport } from './client/durable';

export type {
  TransportType,
  CompatibilityMode,
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
  TopologyFilter,
  HealthStatus,
  RegistryEntry,
  RegistryFilter,
  SchemaHistoryEntry,
  EventDiscriminator,
  EventAlias,
} from './types/index';

export type { ValidationResult, DeclareResult, IRegistry } from './registry/types';
export type { CompatResult } from './registry/schema-compat';
export { checkBackwardCompat, checkForwardCompat } from './registry/schema-compat';
export type { SignalTransportConfig } from './client/signal';
export type { DurableTransportConfig, DurableSubscribeOptions, EnsureQueueOptions } from './client/durable';

// Wire envelopes (Phase 55 — single source of truth for channel_message shape).
export {
  buildChannelMessageEnvelope,
  buildSignalMessage,
  isChannelMessageEnvelope,
  channelMessageRedisChannel,
  channelNodesRedisKey,
} from './types/envelopes';
export type {
  ChannelMessageEnvelope,
  SignalMessage,
  BuildChannelMessageEnvelopeArgs,
  BuildSignalMessageArgs,
} from './types/envelopes';

// Canonical cross-service event declarations (wave1-ec-1+) for events
// produced by libraries (e.g. distributed-core) that have no single
// owning runtime service. Service-owned events still live in the
// producing service's source tree.
export {
  pipelineApprovalRequested,
  pipelineApprovalRecorded,
  pipelineRunCheckpoint,
  pipelineDeclarations,
  pipelineP1Declarations,
  pipelineRunStarted,
  pipelineRunCompleted,
  pipelineRunFailed,
  pipelineRunOrphaned,
  pipelineRunReassigned,
  pipelineRunResumedFromStep,
  pipelineRunStuck,
  pipelineStepBreakpoint,
  pipelineJoinWaiting,
  pipelineJoinFired,
  pipelineP2Declarations,
} from './declarations/index';
