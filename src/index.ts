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
  PublishHook,
  NamespacePolicy,
} from './types/index';

export type { ValidationResult, DeclareResult, IRegistry, ResolveResult } from './registry/types';
export type { CompatResult } from './registry/schema-compat';
export { checkBackwardCompat, checkForwardCompat } from './registry/schema-compat';
// Phase E6 — fingerprint helpers exposed for downstream consumers that
// want to compute fingerprints locally (cache-key derivation, CI gates).
export { stableStringify, computeSchemaFingerprint } from './registry/fingerprint';
// wave22-a — meta-schema shape validator. Catches typos like
// `type: 'objct'` at declare-time. Exported for CI usage too.
export { validateSchemaShape } from './registry/schema-shape';
export type { SchemaShapeResult } from './registry/schema-shape';
// Phase E7 — namespace derivation helpers for downstream consumers that
// want to mirror the registry's auto-derive logic (e.g. CI lint that
// flags declarations whose explicit namespace doesn't match the
// derived one).
export { deriveNamespace, resolveNamespace } from './registry/namespace';
export type { SignalTransportConfig } from './client/signal';
export type { DurableTransportConfig, DurableSubscribeOptions, EnsureQueueOptions } from './client/durable';

// Wire envelopes (Phase 55 — single source of truth for channel_message shape).
export {
  buildChannelMessageEnvelope,
  buildSignalMessage,
  isChannelMessageEnvelope,
  channelMessageRedisChannel,
  channelNodesRedisKey,
  // Phase E2.1 close-out — JSON Schemas alongside the TS types.
  signalMessageSchema,
  channelMessageEnvelopeSchema,
  // wave18-b — direct & broadcast envelope builders + schemas.
  buildDirectMessageEnvelope,
  directMessageRedisChannel,
  directMessageEnvelopeSchema,
  buildBroadcastEnvelope,
  broadcastRedisChannel,
  broadcastEnvelopeSchema,
  // wave20-a — runtime guards + decoder helpers (receive side).
  isDirectMessageEnvelope,
  isBroadcastEnvelope,
  decodeChannelMessageEnvelope,
  decodeDirectMessageEnvelope,
  decodeBroadcastEnvelope,
} from './types/envelopes';
export type {
  ChannelMessageEnvelope,
  SignalMessage,
  BuildChannelMessageEnvelopeArgs,
  BuildSignalMessageArgs,
  DirectMessageEnvelope,
  BuildDirectMessageEnvelopeArgs,
  BroadcastEnvelope,
  BuildBroadcastEnvelopeArgs,
  DecodeResult,
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
  pipelineRunRetry,
  pipelineRunStuck,
  pipelineStepBreakpoint,
  pipelineJoinWaiting,
  pipelineJoinFired,
  pipelineP2Declarations,
  pipelineRaftRunStarted,
  pipelineRaftRunUpdated,
  pipelineRaftRunSynthesized,
  pipelineRaftRunCheckpointed,
  pipelineRaftRunTerminated,
  pipelineRaftDeclarations,
  // wave20-a — Raft state-machine transition subset (excludes :started).
  pipelineRaftStateMachineDeclarations,
  // wave19-a — consolidated P0+P1 aggregate for bulk-registration.
  // wave20-a — expanded to include P2 events.
  pipelineEventDeclarations,
} from './declarations/index';

// Producer-side validation wrapper (createValidatingPublisher / createPublisher).
export {
  createValidatingPublisher,
  createPublisher,
  ValidationError,
  type ValidationMode,
  type ValidatingPublisherOptions,
} from './utils/validating-publisher';

// Shared MQ queue-name constants (wave7-d — single source of truth).
export { MQ_QUEUE_NAMES, ACTIVITY_RECORDED } from './queue-names';
export type { MQQueueName } from './queue-names';

// Channel recording profile registry — single source of truth for
// recording-shape configuration consumed by LVS, platform-api, and WSG.
// See live-video-streaming/.agent/ADR-002-recording-profiles.md.
export {
  RECORDING_PROFILES,
  RECORDING_PROFILE_REGISTRY,
  RECORDING_PROFILE_REGISTRY_VERSION,
  InvalidRecordingProfileError,
  isRecordingProfile,
  validateRecordingProfile,
  resolveRecordingProfile,
} from './declarations/recording-profiles';
export type {
  RecordingProfile,
  RecordingProfileDef,
  StoredRecordingConfig,
} from './declarations/recording-profiles';

// wave20-f — deprecated dot-form pipeline event names, derived from
// the canonical colon-form declarations' `aliases` arrays.
export { DEPRECATED_DUAL_EMIT_ALIASES } from './declarations/deprecated-pipeline-aliases';

// Generated typed map from event name → payload shape.
// Regenerate with: npm run generate-types
export type { EventPayloadMap, EventPayload } from './generated/event-types';

// Wave A2 — client→gateway WS frame contract (client.* namespace) plus
// the inbound gateway→client additions consumed by realtime-modules hooks.
// Per-service Inbound/Outbound union types live on the ./client-frames subpath.
export {
  clientFrameOutboundDeclarations,
  clientContractInboundDeclarations,
  clientFrameDeclarations,
} from './declarations/index';
export type { ClientFramePayloadMap, ClientFramePayload } from './generated/client-frames';

// E5 DLQ infrastructure — re-exported from ./dlq for consumers that import from root.
export { DLQManager } from './dlq/DLQManager';
export { InMemoryDLQStore } from './dlq/DLQStore';
export type { DLQRecord, DLQReason, DLQQueryOptions, ReplayResult } from './dlq/types';

// FeatureBundle — capability-level event grouping for CRD pinning (v0.3.38).
export type { FeatureBundle, EventReference, BundleValidationResult } from './bundles/FeatureBundle';
export {
  FeatureBundleRegistry,
  computeFingerprint,
  registerFeatureBundle,
  getFeatureBundle,
  listFeatureBundles,
  validateBundle,
  findBundleByFingerprint,
  getCrdSchema,
} from './bundles/FeatureBundle';
// Sample bundle declarations.
export { chatBundle } from './declarations/bundles/chat';
export { presenceBundle } from './declarations/bundles/presence';
export { allBundles } from './declarations/bundles/index';
