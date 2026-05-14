"use strict";
// src/declarations/index.ts
//
// Aggregated declarations exported by `@connorhoehn/event-catalog` for
// platform-wide cross-service events. Consumers `import { pipelineDeclarations }`
// (or individual constants) and feed them into `catalog.declare()` at boot.
//
// This module is the canonical home for events whose producer is a library
// (e.g. `distributed-core`) and therefore has no single service that can
// own its declaration. Service-owned events still live in the producing
// service's own source tree per the charter.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineP2Declarations = exports.pipelineJoinFired = exports.pipelineJoinWaiting = exports.pipelineStepBreakpoint = exports.pipelineRunStuck = exports.pipelineRunResumedFromStep = exports.pipelineRunReassigned = exports.pipelineRunOrphaned = exports.pipelineRunFailed = exports.pipelineRunCompleted = exports.pipelineRunStarted = exports.pipelineP1Declarations = exports.pipelineDeclarations = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = void 0;
var pipeline_1 = require("./pipeline");
Object.defineProperty(exports, "pipelineApprovalRequested", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRequested; } });
Object.defineProperty(exports, "pipelineApprovalRecorded", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRecorded; } });
Object.defineProperty(exports, "pipelineRunCheckpoint", { enumerable: true, get: function () { return pipeline_1.pipelineRunCheckpoint; } });
Object.defineProperty(exports, "pipelineDeclarations", { enumerable: true, get: function () { return pipeline_1.pipelineDeclarations; } });
var pipeline_p1_1 = require("./pipeline-p1");
Object.defineProperty(exports, "pipelineP1Declarations", { enumerable: true, get: function () { return pipeline_p1_1.pipelineP1Declarations; } });
var pipeline_p2_1 = require("./pipeline-p2");
Object.defineProperty(exports, "pipelineRunStarted", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunStarted; } });
Object.defineProperty(exports, "pipelineRunCompleted", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunCompleted; } });
Object.defineProperty(exports, "pipelineRunFailed", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunFailed; } });
Object.defineProperty(exports, "pipelineRunOrphaned", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunOrphaned; } });
Object.defineProperty(exports, "pipelineRunReassigned", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunReassigned; } });
Object.defineProperty(exports, "pipelineRunResumedFromStep", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunResumedFromStep; } });
Object.defineProperty(exports, "pipelineRunStuck", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunStuck; } });
Object.defineProperty(exports, "pipelineStepBreakpoint", { enumerable: true, get: function () { return pipeline_p2_1.pipelineStepBreakpoint; } });
Object.defineProperty(exports, "pipelineJoinWaiting", { enumerable: true, get: function () { return pipeline_p2_1.pipelineJoinWaiting; } });
Object.defineProperty(exports, "pipelineJoinFired", { enumerable: true, get: function () { return pipeline_p2_1.pipelineJoinFired; } });
Object.defineProperty(exports, "pipelineP2Declarations", { enumerable: true, get: function () { return pipeline_p2_1.pipelineP2Declarations; } });
//# sourceMappingURL=index.js.map