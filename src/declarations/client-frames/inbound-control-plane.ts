// src/declarations/client-frames/inbound-control-plane.ts
//
// INBOUND (gateway → client) control-plane push frames: capability and
// feature-flag state changes. Not a fan-out service — these come from the
// gateway's own control plane.
//
// Sliced verbatim out of the former single-file client-frames.ts.

import type { EventDeclaration } from '../../types/index';
import { GATEWAY_PRODUCER, GATEWAY_BASE_TAGS, inboundSchema } from './_shared';

// --- capability / feature-flag (control-plane push) ----------------------------

/** Consumed by useCapability: a CRD-derived capability changed. */
export const wsCapabilityUpdated: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.capability.updated',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Control-plane push that a CRD-derived capability changed state, so useCapability consumers update without a remount. Payload mirrors CapabilityUpdatedPayload in useCapability.ts.',
    tags: [...GATEWAY_BASE_TAGS, 'capability', 'control-plane', 'client-contract'],
    schema: inboundSchema('capability:updated', {
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
export const wsFeatureFlagUpdated: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.feature-flag.updated',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Gateway push that an app-level feature flag changed (kill-switch / A-B variant), so useFeatureFlag consumers update reactively. Payload mirrors FeatureFlagUpdatedPayload in useFeatureFlag.ts.',
    tags: [...GATEWAY_BASE_TAGS, 'feature-flag', 'control-plane', 'client-contract'],
    schema: inboundSchema('feature-flag:updated', {
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
