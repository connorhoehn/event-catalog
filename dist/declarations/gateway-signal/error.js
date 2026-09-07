"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsError = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// ERROR frame — src/core/message-router.ts + all service sendError() methods
// ===========================================================================
/**
 * Generic error frame sent when any service encounters a client-visible error.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): the gateway dist
 * services emit TWO error-envelope shapes on the wire, both modelled here:
 *   - NESTED (chat / reaction / cursor / crdt): { type:'error', service,
 *     error:{ code, message, service, clientId, timestamp } } — via
 *     createErrorResponse/sendError.
 *   - FLAT (presence / activity): { type:'error', service, message } — these
 *     services have no ErrorCodes/createErrorResponse and send a bare message.
 * Both top-level `message` (flat) and the nested `error` object are therefore
 * declared optional; `service` names the originating service in both shapes.
 */
exports.wsError = {
    namespace: 'ws',
    name: 'ws.error',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Generic error frame sent to a client when any gateway service encounters a client-visible error. GROUND TRUTH (gateway dist): chat/reaction/cursor/crdt nest under error:{ code, message, service, clientId, timestamp }; presence/activity send a flat top-level message. `service` names the originating service in both shapes.',
    tags: [..._shared_1.BASE_TAGS, 'error'],
    schema: (0, _shared_1.wsSchema)('error', {
        service: { type: 'string', description: 'The service that generated the error (chat, cursor, presence, etc.)' },
        // FLAT shape (presence / activity)
        code: { type: 'string', description: 'flat-shape error code (when no nested error object is present)' },
        message: { type: 'string', description: 'flat-shape human-readable message (presence/activity); for chat/reaction/cursor/crdt the message lives under error.message' },
        // NESTED shape (chat / reaction / cursor / crdt) via createErrorResponse
        error: {
            type: 'object',
            description: 'nested error envelope emitted by chat/reaction/cursor/crdt',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                service: { type: 'string' },
                clientId: { type: 'string' },
                timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
            },
            required: ['code', 'message'],
            additionalProperties: true,
        },
    }, []),
};
//# sourceMappingURL=error.js.map