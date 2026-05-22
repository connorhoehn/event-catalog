"use strict";
// src/declarations/bundles/agentic-pipeline.ts
//
// "agentic-pipeline" FeatureBundle — DEPRECATED since v0.3.45.
//
// Superseded by the transport-coherent split:
//   agentic-pipeline-signal@1.0.0  — WS lifecycle events (transport: signal)
//   agentic-pipeline-durable@1.0.0 — approval + audit events (transport: durable)
//
// This bundle is retained for backward compat so existing CRD fingerprint pins
// remain valid. The deprecated field is set and the bundle keeps working; CRD
// operators should migrate to the new names.
//
// Sources: pipeline-p1.ts, pipeline-p2.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agenticPipelineBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'agentic-pipeline',
    version: '1.0.0',
    transport: 'signal',
    description: 'DEPRECATED — use agentic-pipeline-signal@1.0.0 (WS lifecycle) + agentic-pipeline-durable@1.0.0 (approval/audit). Pipeline lifecycle and step events — run, step, join, and breakpoint events for agentic pipelines.',
    deprecated: {
        since: 'v0.3.45',
        replacement: 'agentic-pipeline-signal@1.0.0',
    },
    events: [
        // Run lifecycle (pipeline-p2.ts)
        { name: 'pipeline:run:started', required: true },
        { name: 'pipeline:run:completed', required: true },
        { name: 'pipeline:run:failed', required: true },
        { name: 'pipeline:run:cancelled', required: true },
        { name: 'pipeline:run:paused', required: true },
        { name: 'pipeline:run:resumed', required: true },
        { name: 'pipeline:run:retry', required: true },
        { name: 'pipeline:run:stuck', required: true },
        { name: 'pipeline:run:orphaned', required: false },
        { name: 'pipeline:run:reassigned', required: false },
        // Step lifecycle (pipeline-p1.ts)
        { name: 'pipeline:step:started', required: true },
        { name: 'pipeline:step:completed', required: true },
        { name: 'pipeline:step:failed', required: true },
        { name: 'pipeline:step:skipped', required: false },
        { name: 'pipeline:step:cancelled', required: false },
        { name: 'pipeline:step:breakpoint', required: false },
        { name: 'pipeline:step:heartbeat', required: false },
        // Join gates (pipeline-p2.ts)
        { name: 'pipeline:join:waiting', required: false },
        { name: 'pipeline:join:fired', required: false },
        // TODO: pipeline:run:trigger not yet declared in the catalog
        // (design doc calls this "trigger"; pipeline:run:started is the closest)
        // { name: 'pipeline:run:trigger',         required: false },
    ],
};
exports.agenticPipelineBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=agentic-pipeline.js.map