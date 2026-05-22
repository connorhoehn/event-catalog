"use strict";
// src/declarations/bundles/chat.ts
//
// "chat" FeatureBundle — real-time chat messaging via WebSocket.
//
// Event names match the canonical ws.chat.* declarations in
// src/declarations/gateway-signal.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'chat',
    version: '1.0.0',
    transport: 'signal',
    description: 'Real-time chat messaging via WebSocket.',
    events: [
        { name: 'ws.chat.joined', required: true },
        { name: 'ws.chat.left', required: true },
        { name: 'ws.chat.message', required: true },
        { name: 'ws.chat.sent', required: true },
        { name: 'ws.chat.history', required: true },
        // Generic error frame is optional — shared across all bundles.
        { name: 'ws.error', required: false },
    ],
};
exports.chatBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=chat.js.map