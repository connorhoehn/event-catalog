"use strict";
// src/declarations/bundles/presence.ts
//
// "presence" FeatureBundle — client presence tracking via WebSocket.
//
// Event names match the canonical ws.presence.* declarations in
// src/declarations/gateway-signal.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.presenceBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'presence',
    version: '1.0.0',
    transport: 'signal',
    description: 'Client presence tracking — set, broadcast, subscribe/unsubscribe, and offline eviction.',
    events: [
        { name: 'ws.presence.set', required: true },
        { name: 'ws.presence.update', required: true },
        { name: 'ws.presence.subscribed', required: true },
        { name: 'ws.presence.unsubscribed', required: true },
        { name: 'ws.presence.data', required: true },
        { name: 'ws.presence.offline', required: true },
        // Generic error frame is optional — shared across all bundles.
        { name: 'ws.error', required: false },
    ],
};
exports.presenceBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=presence.js.map