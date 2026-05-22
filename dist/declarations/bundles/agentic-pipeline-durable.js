"use strict";
// src/declarations/bundles/agentic-pipeline-durable.ts
//
// "agentic-pipeline-durable" FeatureBundle — approval and audit events.
//
// Transport is 'durable': events are forwarded onto the durable bus (SQS /
// MQ) by platform-api (M4.4 v2) so workers and audit consumers receive
// them across restarts. All three approval events have transport 'both' in
// the catalog (they also emit on the signal bus); the bundle uses 'durable'
// because the *raison d'être* of this bundle is durable delivery.
//
// Apps needing both real-time WS updates and durable audit should subscribe
// to BOTH agentic-pipeline-signal AND agentic-pipeline-durable.
//
// Sources: pipeline.ts (pipelineApproval* declarations).
//
// CRD coordination note (v0.3.45):
//   The dc-k8s-operator AgenticPipeline CRD currently uses a single
//   `eventBundle` field. A future wave will extend the CRD schema to accept
//   `eventBundles: [string]` (array). Until then, operators referencing both
//   bundles should enumerate them in a `eventBundles` annotation comment and
//   use `agentic-pipeline-signal@1.0.0` as the primary `eventBundle` value.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agenticPipelineDurableBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'agentic-pipeline-durable',
    version: '1.0.0',
    transport: 'durable',
    description: 'Pipeline approval and audit events — durable-bus delivery for approval '
        + 'workflow state (requested, recorded, resolved) so workers and audit '
        + 'consumers see gate outcomes across restarts. Pair with '
        + 'agentic-pipeline-signal for full WS + durable coverage.',
    events: [
        // Approval workflow (pipeline.ts) — transport: 'both' in catalog
        { name: 'pipeline.approval.requested', required: true },
        { name: 'pipeline.approval.recorded', required: true },
        { name: 'pipeline.approval.resolved', required: true },
    ],
};
exports.agenticPipelineDurableBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=agentic-pipeline-durable.js.map