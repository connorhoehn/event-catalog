"use strict";
// src/declarations/client-frames/inbound-control-plane.ts
//
// INBOUND (gateway → client) control-plane push frames: capability and
// feature-flag state changes. Not a fan-out service — these come from the
// gateway's own control plane.
//
// Sliced verbatim out of the former single-file client-frames.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsFeatureFlagUpdated = exports.wsCapabilityUpdated = void 0;
const _shared_1 = require("./_shared");
// --- capability / feature-flag (control-plane push) ----------------------------
/** Consumed by useCapability: a CRD-derived capability changed. */
exports.wsCapabilityUpdated = {
    namespace: 'ws',
    name: 'ws.capability.updated',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Control-plane push that a CRD-derived capability changed state, so useCapability consumers update without a remount. Payload mirrors CapabilityUpdatedPayload in useCapability.ts.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'capability', 'control-plane', 'client-contract'],
    schema: (0, _shared_1.inboundSchema)('capability:updated', {
        payload: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                channel: { type: 'string', description: 'optional channel scope' },
                version: { type: 'string', description: 'bundle version from the CRD' },
                metadata: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'enabled'],
            additionalProperties: true,
        },
    }, ['payload']),
};
/** Consumed by useFeatureFlag: an app-level feature flag changed. */
exports.wsFeatureFlagUpdated = {
    namespace: 'ws',
    name: 'ws.feature-flag.updated',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Gateway push that an app-level feature flag changed (kill-switch / A-B variant), so useFeatureFlag consumers update reactively. Payload mirrors FeatureFlagUpdatedPayload in useFeatureFlag.ts.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'feature-flag', 'control-plane', 'client-contract'],
    schema: (0, _shared_1.inboundSchema)('feature-flag:updated', {
        payload: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                variant: { type: 'string', description: 'variant id for multi-variant flags' },
                metadata: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'enabled'],
            additionalProperties: true,
        },
    }, ['payload']),
};
//# sourceMappingURL=inbound-control-plane.js.map