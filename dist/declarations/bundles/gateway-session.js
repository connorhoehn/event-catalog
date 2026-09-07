"use strict";
// src/declarations/bundles/gateway-session.ts
//
// "gateway-session" FeatureBundle — the connection-lifecycle frames every
// other bundle sits on top of.
//
// These are not a feature. They are the plumbing a deployment gets the
// moment it speaks to the gateway at all: the welcome frame that says the
// session is usable, and the multiplexer's subscribe/unsubscribe acks.
// They are bundled rather than left uncovered because they are exactly
// what an operator needs to be able to pin — `ws.session.connected` gates
// all outbound traffic in the gateway's pre-session queue, so a
// deployment missing it does not degrade, it silently sends nothing.
//
// Transport: 'signal'.
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatewaySessionBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'gateway-session',
    version: '1.0.0',
    transport: 'signal',
    description: 'Gateway connection lifecycle — the session welcome frame that releases the outbound '
        + 'pre-session queue, and the generic multiplexer subscribe/unsubscribe acknowledgements. '
        + 'Underpins every other signal bundle rather than being a feature of its own.',
    events: [
        { name: 'ws.session.connected', required: true },
        // The acks are suppressed on an authz denial, so their ABSENCE is
        // meaningful to the client — optional in the pin, load-bearing on the wire.
        { name: 'ws.subscribe.subscribed', required: false },
        { name: 'ws.subscribe.unsubscribed', required: false },
        { name: 'ws.error', required: false },
    ],
};
exports.gatewaySessionBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=gateway-session.js.map