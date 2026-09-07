"use strict";
// src/declarations/bundles/sfu-webhooks.ts
//
// "sfu-webhooks" FeatureBundle — the durable SFU → platform-api webhook
// contract.
//
// These are the twelve events live-video-streaming dispatches through
// `webhookDispatcher` (src/declarations/sfu/webhook.ts). They are the
// durable half of the `sfu.*` namespace: persisted, retried, and consumed
// by platform-api's lvsWebhooks route. A deployment that receives SFU
// webhooks depends on all twelve as a unit — the dispatcher does not let
// you subscribe to a subset.
//
// The signal halves live in sfu-control-plane (stream-events hub) and
// sfu-chat (chat-bus). They are separately adoptable: a deployment can
// take webhooks without ever joining the Redis hubs.
//
// Transport: 'durable' — every member is declared durable.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sfuWebhooksBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'sfu-webhooks',
    version: '1.0.0',
    transport: 'durable',
    description: 'SFU durable webhook contract — session, stream, recording, and channel lifecycle events '
        + 'dispatched by live-video-streaming and consumed by platform-api. Stream health and '
        + 'thumbnail events are optional (feature-gated in the SFU); the rest are the core contract.',
    events: [
        // Session lifecycle
        { name: 'sfu.session.created', required: true },
        { name: 'sfu.session.ended', required: true },
        // Stream lifecycle
        { name: 'sfu.stream.started', required: true },
        { name: 'sfu.stream.ended', required: true },
        // Stream health + thumbnails — feature-gated in the SFU
        { name: 'sfu.stream.health.degraded', required: false },
        { name: 'sfu.stream.health.recovered', required: false },
        { name: 'sfu.stream.thumbnail.updated', required: false },
        // Recording lifecycle
        { name: 'sfu.recording.started', required: true },
        { name: 'sfu.recording.completed', required: true },
        // Channel CRUD
        { name: 'sfu.channel.created', required: true },
        { name: 'sfu.channel.updated', required: true },
        { name: 'sfu.channel.deleted', required: true },
    ],
};
exports.sfuWebhooksBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=sfu-webhooks.js.map