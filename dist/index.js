"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineRaftRunCheckpointed = exports.pipelineRaftRunSynthesized = exports.pipelineRaftRunUpdated = exports.pipelineRaftRunStarted = exports.pipelineP2Declarations = exports.pipelineJoinFired = exports.pipelineJoinWaiting = exports.pipelineStepBreakpoint = exports.pipelineRunStuck = exports.pipelineRunRetry = exports.pipelineRunResumedFromStep = exports.pipelineRunReassigned = exports.pipelineRunOrphaned = exports.pipelineRunFailed = exports.pipelineRunCompleted = exports.pipelineRunStarted = exports.pipelineP1Declarations = exports.pipelineDeclarations = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = exports.decodeBroadcastEnvelope = exports.decodeDirectMessageEnvelope = exports.decodeChannelMessageEnvelope = exports.isBroadcastEnvelope = exports.isDirectMessageEnvelope = exports.broadcastEnvelopeSchema = exports.broadcastRedisChannel = exports.buildBroadcastEnvelope = exports.directMessageEnvelopeSchema = exports.directMessageRedisChannel = exports.buildDirectMessageEnvelope = exports.channelMessageEnvelopeSchema = exports.signalMessageSchema = exports.channelNodesRedisKey = exports.channelMessageRedisChannel = exports.isChannelMessageEnvelope = exports.buildSignalMessage = exports.buildChannelMessageEnvelope = exports.resolveNamespace = exports.deriveNamespace = exports.validateSchemaShape = exports.computeSchemaFingerprint = exports.stableStringify = exports.checkForwardCompat = exports.checkBackwardCompat = exports.DurableTransport = exports.SignalTransport = exports.Registry = exports.EventCatalog = void 0;
exports.DEPRECATED_DUAL_EMIT_ALIASES = exports.MQ_QUEUE_NAMES = exports.pipelineEventDeclarations = exports.pipelineRaftStateMachineDeclarations = exports.pipelineRaftDeclarations = exports.pipelineRaftRunTerminated = void 0;
var index_1 = require("./client/index");
Object.defineProperty(exports, "EventCatalog", { enumerable: true, get: function () { return index_1.EventCatalog; } });
var index_2 = require("./registry/index");
Object.defineProperty(exports, "Registry", { enumerable: true, get: function () { return index_2.Registry; } });
var signal_1 = require("./client/signal");
Object.defineProperty(exports, "SignalTransport", { enumerable: true, get: function () { return signal_1.SignalTransport; } });
var durable_1 = require("./client/durable");
Object.defineProperty(exports, "DurableTransport", { enumerable: true, get: function () { return durable_1.DurableTransport; } });
var schema_compat_1 = require("./registry/schema-compat");
Object.defineProperty(exports, "checkBackwardCompat", { enumerable: true, get: function () { return schema_compat_1.checkBackwardCompat; } });
Object.defineProperty(exports, "checkForwardCompat", { enumerable: true, get: function () { return schema_compat_1.checkForwardCompat; } });
// Phase E6 — fingerprint helpers exposed for downstream consumers that
// want to compute fingerprints locally (cache-key derivation, CI gates).
var fingerprint_1 = require("./registry/fingerprint");
Object.defineProperty(exports, "stableStringify", { enumerable: true, get: function () { return fingerprint_1.stableStringify; } });
Object.defineProperty(exports, "computeSchemaFingerprint", { enumerable: true, get: function () { return fingerprint_1.computeSchemaFingerprint; } });
// wave22-a — meta-schema shape validator. Catches typos like
// `type: 'objct'` at declare-time. Exported for CI usage too.
var schema_shape_1 = require("./registry/schema-shape");
Object.defineProperty(exports, "validateSchemaShape", { enumerable: true, get: function () { return schema_shape_1.validateSchemaShape; } });
// Phase E7 — namespace derivation helpers for downstream consumers that
// want to mirror the registry's auto-derive logic (e.g. CI lint that
// flags declarations whose explicit namespace doesn't match the
// derived one).
var namespace_1 = require("./registry/namespace");
Object.defineProperty(exports, "deriveNamespace", { enumerable: true, get: function () { return namespace_1.deriveNamespace; } });
Object.defineProperty(exports, "resolveNamespace", { enumerable: true, get: function () { return namespace_1.resolveNamespace; } });
// Wire envelopes (Phase 55 — single source of truth for channel_message shape).
var envelopes_1 = require("./types/envelopes");
Object.defineProperty(exports, "buildChannelMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.buildChannelMessageEnvelope; } });
Object.defineProperty(exports, "buildSignalMessage", { enumerable: true, get: function () { return envelopes_1.buildSignalMessage; } });
Object.defineProperty(exports, "isChannelMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.isChannelMessageEnvelope; } });
Object.defineProperty(exports, "channelMessageRedisChannel", { enumerable: true, get: function () { return envelopes_1.channelMessageRedisChannel; } });
Object.defineProperty(exports, "channelNodesRedisKey", { enumerable: true, get: function () { return envelopes_1.channelNodesRedisKey; } });
// Phase E2.1 close-out — JSON Schemas alongside the TS types.
Object.defineProperty(exports, "signalMessageSchema", { enumerable: true, get: function () { return envelopes_1.signalMessageSchema; } });
Object.defineProperty(exports, "channelMessageEnvelopeSchema", { enumerable: true, get: function () { return envelopes_1.channelMessageEnvelopeSchema; } });
// wave18-b — direct & broadcast envelope builders + schemas.
Object.defineProperty(exports, "buildDirectMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.buildDirectMessageEnvelope; } });
Object.defineProperty(exports, "directMessageRedisChannel", { enumerable: true, get: function () { return envelopes_1.directMessageRedisChannel; } });
Object.defineProperty(exports, "directMessageEnvelopeSchema", { enumerable: true, get: function () { return envelopes_1.directMessageEnvelopeSchema; } });
Object.defineProperty(exports, "buildBroadcastEnvelope", { enumerable: true, get: function () { return envelopes_1.buildBroadcastEnvelope; } });
Object.defineProperty(exports, "broadcastRedisChannel", { enumerable: true, get: function () { return envelopes_1.broadcastRedisChannel; } });
Object.defineProperty(exports, "broadcastEnvelopeSchema", { enumerable: true, get: function () { return envelopes_1.broadcastEnvelopeSchema; } });
// wave20-a — runtime guards + decoder helpers (receive side).
Object.defineProperty(exports, "isDirectMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.isDirectMessageEnvelope; } });
Object.defineProperty(exports, "isBroadcastEnvelope", { enumerable: true, get: function () { return envelopes_1.isBroadcastEnvelope; } });
Object.defineProperty(exports, "decodeChannelMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.decodeChannelMessageEnvelope; } });
Object.defineProperty(exports, "decodeDirectMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.decodeDirectMessageEnvelope; } });
Object.defineProperty(exports, "decodeBroadcastEnvelope", { enumerable: true, get: function () { return envelopes_1.decodeBroadcastEnvelope; } });
// Canonical cross-service event declarations (wave1-ec-1+) for events
// produced by libraries (e.g. distributed-core) that have no single
// owning runtime service. Service-owned events still live in the
// producing service's source tree.
var index_3 = require("./declarations/index");
Object.defineProperty(exports, "pipelineApprovalRequested", { enumerable: true, get: function () { return index_3.pipelineApprovalRequested; } });
Object.defineProperty(exports, "pipelineApprovalRecorded", { enumerable: true, get: function () { return index_3.pipelineApprovalRecorded; } });
Object.defineProperty(exports, "pipelineRunCheckpoint", { enumerable: true, get: function () { return index_3.pipelineRunCheckpoint; } });
Object.defineProperty(exports, "pipelineDeclarations", { enumerable: true, get: function () { return index_3.pipelineDeclarations; } });
Object.defineProperty(exports, "pipelineP1Declarations", { enumerable: true, get: function () { return index_3.pipelineP1Declarations; } });
Object.defineProperty(exports, "pipelineRunStarted", { enumerable: true, get: function () { return index_3.pipelineRunStarted; } });
Object.defineProperty(exports, "pipelineRunCompleted", { enumerable: true, get: function () { return index_3.pipelineRunCompleted; } });
Object.defineProperty(exports, "pipelineRunFailed", { enumerable: true, get: function () { return index_3.pipelineRunFailed; } });
Object.defineProperty(exports, "pipelineRunOrphaned", { enumerable: true, get: function () { return index_3.pipelineRunOrphaned; } });
Object.defineProperty(exports, "pipelineRunReassigned", { enumerable: true, get: function () { return index_3.pipelineRunReassigned; } });
Object.defineProperty(exports, "pipelineRunResumedFromStep", { enumerable: true, get: function () { return index_3.pipelineRunResumedFromStep; } });
Object.defineProperty(exports, "pipelineRunRetry", { enumerable: true, get: function () { return index_3.pipelineRunRetry; } });
Object.defineProperty(exports, "pipelineRunStuck", { enumerable: true, get: function () { return index_3.pipelineRunStuck; } });
Object.defineProperty(exports, "pipelineStepBreakpoint", { enumerable: true, get: function () { return index_3.pipelineStepBreakpoint; } });
Object.defineProperty(exports, "pipelineJoinWaiting", { enumerable: true, get: function () { return index_3.pipelineJoinWaiting; } });
Object.defineProperty(exports, "pipelineJoinFired", { enumerable: true, get: function () { return index_3.pipelineJoinFired; } });
Object.defineProperty(exports, "pipelineP2Declarations", { enumerable: true, get: function () { return index_3.pipelineP2Declarations; } });
Object.defineProperty(exports, "pipelineRaftRunStarted", { enumerable: true, get: function () { return index_3.pipelineRaftRunStarted; } });
Object.defineProperty(exports, "pipelineRaftRunUpdated", { enumerable: true, get: function () { return index_3.pipelineRaftRunUpdated; } });
Object.defineProperty(exports, "pipelineRaftRunSynthesized", { enumerable: true, get: function () { return index_3.pipelineRaftRunSynthesized; } });
Object.defineProperty(exports, "pipelineRaftRunCheckpointed", { enumerable: true, get: function () { return index_3.pipelineRaftRunCheckpointed; } });
Object.defineProperty(exports, "pipelineRaftRunTerminated", { enumerable: true, get: function () { return index_3.pipelineRaftRunTerminated; } });
Object.defineProperty(exports, "pipelineRaftDeclarations", { enumerable: true, get: function () { return index_3.pipelineRaftDeclarations; } });
// wave20-a — Raft state-machine transition subset (excludes :started).
Object.defineProperty(exports, "pipelineRaftStateMachineDeclarations", { enumerable: true, get: function () { return index_3.pipelineRaftStateMachineDeclarations; } });
// wave19-a — consolidated P0+P1 aggregate for bulk-registration.
// wave20-a — expanded to include P2 events.
Object.defineProperty(exports, "pipelineEventDeclarations", { enumerable: true, get: function () { return index_3.pipelineEventDeclarations; } });
// Shared MQ queue-name constants (wave7-d — single source of truth).
var queue_names_1 = require("./queue-names");
Object.defineProperty(exports, "MQ_QUEUE_NAMES", { enumerable: true, get: function () { return queue_names_1.MQ_QUEUE_NAMES; } });
// wave20-f — deprecated dot-form pipeline event names, derived from
// the canonical colon-form declarations' `aliases` arrays.
var deprecated_pipeline_aliases_1 = require("./declarations/deprecated-pipeline-aliases");
Object.defineProperty(exports, "DEPRECATED_DUAL_EMIT_ALIASES", { enumerable: true, get: function () { return deprecated_pipeline_aliases_1.DEPRECATED_DUAL_EMIT_ALIASES; } });
//# sourceMappingURL=index.js.map