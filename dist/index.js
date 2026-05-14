"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineP1Declarations = exports.pipelineDeclarations = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = exports.channelNodesRedisKey = exports.channelMessageRedisChannel = exports.isChannelMessageEnvelope = exports.buildSignalMessage = exports.buildChannelMessageEnvelope = exports.checkForwardCompat = exports.checkBackwardCompat = exports.DurableTransport = exports.SignalTransport = exports.Registry = exports.EventCatalog = void 0;
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
// Wire envelopes (Phase 55 — single source of truth for channel_message shape).
var envelopes_1 = require("./types/envelopes");
Object.defineProperty(exports, "buildChannelMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.buildChannelMessageEnvelope; } });
Object.defineProperty(exports, "buildSignalMessage", { enumerable: true, get: function () { return envelopes_1.buildSignalMessage; } });
Object.defineProperty(exports, "isChannelMessageEnvelope", { enumerable: true, get: function () { return envelopes_1.isChannelMessageEnvelope; } });
Object.defineProperty(exports, "channelMessageRedisChannel", { enumerable: true, get: function () { return envelopes_1.channelMessageRedisChannel; } });
Object.defineProperty(exports, "channelNodesRedisKey", { enumerable: true, get: function () { return envelopes_1.channelNodesRedisKey; } });
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
//# sourceMappingURL=index.js.map