"use strict";
// src/declarations/bundles/reactions.ts
//
// "reactions" FeatureBundle — emoji reactions via WebSocket.
//
// Event names match the canonical ws.reaction.* declarations in
// src/declarations/gateway-signal.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reactionsBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'reactions',
    version: '1.0.0',
    transport: 'signal',
    description: 'Emoji reactions — subscribe, send, and receive reaction events via WebSocket.',
    events: [
        { name: 'ws.reaction.subscribed', required: true },
        { name: 'ws.reaction.sent', required: true },
        { name: 'ws.reaction.received', required: true },
        { name: 'ws.reaction.removed', required: true },
        { name: 'ws.reaction.list', required: true },
        { name: 'ws.error', required: false },
    ],
};
exports.reactionsBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=reactions.js.map