"use strict";
// src/declarations/bundles/cursor.ts
//
// "cursor" FeatureBundle — collaborative cursor presence via WebSocket.
//
// Event names match the canonical ws.cursor.* declarations in
// src/declarations/gateway-signal.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cursorBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'cursor',
    version: '1.0.0',
    transport: 'signal',
    description: 'Collaborative cursor presence — track, broadcast, and remove cursor positions via WebSocket.',
    events: [
        { name: 'ws.cursor.subscribed', required: true },
        { name: 'ws.cursor.unsubscribed', required: true },
        { name: 'ws.cursor.update', required: true },
        { name: 'ws.cursor.remove', required: true },
        { name: 'ws.cursor.cursors', required: true },
        { name: 'ws.cursor.modes', required: true },
        { name: 'ws.cursor.clear', required: true },
        { name: 'ws.cursor.batch', required: true },
        { name: 'ws.error', required: false },
    ],
};
exports.cursorBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=cursor.js.map