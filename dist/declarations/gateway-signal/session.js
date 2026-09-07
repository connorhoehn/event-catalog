"use strict";
// src/declarations/gateway-signal/session.ts
//
// The session-bootstrap welcome frame — src/server.ts:2507.
//
// ADDED 2026-09-07. This frame has been on the wire since the gateway
// existed and was the last obviously-undeclared gateway→client frame: it is
// absent from `WS_FRAME_DECLARATIONS` in the gateway's own
// `src/observability/gateway-event-declarations.ts` (which claims to cover
// "every `type:` value the gateway emits") and had no catalog declaration.
//
// It was not, however, undocumented — `scripts/generate-asyncapi.ts` carries
// a HAND-WRITTEN copy of this schema, inlined as `SessionBootstrap`, with a
// comment saying it exists because the frame "has no event-catalog
// declaration". That is now false. Until the generator is taught to drop its
// inline copy in favour of this one, `contracts/asyncapi.yaml` describes the
// frame twice; see the note in contracts/README.md.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsSessionConnected = void 0;
const _shared_1 = require("./_shared");
/** The gateway's welcome frame — always the first frame of a connection. */
exports.wsSessionConnected = {
    namespace: 'ws',
    name: 'ws.session.connected',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Session welcome frame, sent once immediately after the WebSocket upgrade completes and '
        + 'before the client may send anything (src/server.ts:2507). It is load-bearing protocol, '
        + 'not a courtesy: the gateway queues every other outbound frame until this one has gone out '
        + '(core/pre-session-queue.ts), and the client cannot reconnect without the `sessionToken` or '
        + 'feature-gate without `enabledServices`. `restored` tells the client whether its prior '
        + 'subscriptions came back with it — false both for a genuinely new connection and for a '
        + 'presented token the gateway could not restore, including the fallback path where a '
        + 'subscription restore failed and the connection was re-minted under a fresh clientId '
        + '(server.ts:2399).',
    tags: [..._shared_1.BASE_TAGS, 'session', 'lifecycle'],
    schema: (0, _shared_1.wsSchema)('session', {
        status: {
            type: 'string',
            const: 'connected',
            description: 'Always the literal `connected` — the frame has no other outcome; a rejected upgrade never reaches this point.',
        },
        clientId: {
            type: 'string',
            description: 'Gateway-assigned connection id, echoed on subsequent frames. Preserved across a successful resume, re-minted otherwise.',
        },
        sessionToken: {
            type: 'string',
            description: 'Opaque resume token the client passes back as `?sessionToken=` on reconnect. Always a string here — a connection that presented no token, or an unusable one, has one minted before this frame is built (server.ts:2363).',
        },
        restored: {
            type: 'boolean',
            description: 'True when this connection resumed a prior session AND its subscriptions were restored.',
        },
        nodeId: {
            type: 'string',
            description: 'Cluster node id of the gateway instance serving this connection.',
        },
        enabledServices: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fan-out services this gateway has enabled (chat, presence, reaction, …). A client should not send frames for a service absent from this list.',
        },
    }, ['status', 'clientId', 'sessionToken', 'restored', 'nodeId', 'enabledServices']),
};
//# sourceMappingURL=session.js.map