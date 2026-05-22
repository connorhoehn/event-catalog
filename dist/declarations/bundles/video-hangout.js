"use strict";
// src/declarations/bundles/video-hangout.ts
//
// "video-hangout" FeatureBundle — LVS video session lifecycle via WebSocket.
//
// These events coordinate session lifecycle (join, leave, end) and participant
// media state (video on/off). Actual media streaming uses WHIP/WHEP through
// LVS directly — not these WS events.
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoHangoutBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'video-hangout',
    version: '1.0.0',
    transport: 'signal',
    description: 'LVS video session lifecycle — invite, accept, decline, cancel, and end video calls over WebSocket. Media streaming is WHIP/WHEP via LVS.',
    events: [
        // Session lifecycle — mapped to ws.call.* (closest existing names)
        { name: 'ws.call.invite', required: true }, // session.created / session.invited
        { name: 'ws.call.accepted', required: true }, // session.joined
        { name: 'ws.call.declined', required: true }, // session.declined
        { name: 'ws.call.cancelled', required: true }, // session.cancelled
        { name: 'ws.call.ended', required: true }, // session.ended / session.left
        { name: 'ws.call.video-on', required: true }, // participant.video-on
        { name: 'ws.call.video-off', required: true }, // participant.video-off
        { name: 'ws.error', required: false },
    ],
};
exports.videoHangoutBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=video-hangout.js.map