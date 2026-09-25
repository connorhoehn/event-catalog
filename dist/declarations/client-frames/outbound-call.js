"use strict";
// src/declarations/client-frames/outbound-call.ts
//
// OUTBOUND (client → gateway) frames for document calls (2026-09-24),
// sent by realtime-modules useDocumentCall. The gateway's `call` service
// answers each with ws.call.call-meta.
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientCallTransferHost = exports.clientCallRemoveParticipant = exports.clientCallMuteParticipant = exports.clientCallSetTitle = exports.clientCallPresent = exports.clientCallSetDocuments = exports.clientCallMeta = void 0;
const _shared_1 = require("./_shared");
/** Ask for a document call's meta (participants only). */
exports.clientCallMeta = {
    namespace: 'client',
    name: 'client.call.meta',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Ask for a document call\'s live meta. The gateway replies to the sender only with ws.call.call-meta.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: (0, _shared_1.clientFrameSchema)('call', 'meta', { callId: { type: 'string' } }, ['callId']),
};
/** Replace the review-document list (any participant). */
exports.clientCallSetDocuments = {
    namespace: 'client',
    name: 'client.call.set-documents',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Replace a document call\'s review documents (host document stays first). Any participant. Broadcasts ws.call.call-meta.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: (0, _shared_1.clientFrameSchema)('call', 'set-documents', {
        callId: { type: 'string' },
        documentIds: { type: 'array', items: { type: 'string' }, description: 'The new review list; the server puts the host document first.' },
        documentTitles: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional document id → title map for the list.' },
    }, ['callId', 'documentIds']),
};
/** Start (documentId) or stop (null) presenting. */
exports.clientCallPresent = {
    namespace: 'client',
    name: 'client.call.present',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Present a review document, or stop with documentId null. Only the current presenter or the host may replace a presenter. Broadcasts ws.call.call-meta.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: (0, _shared_1.clientFrameSchema)('call', 'present', {
        callId: { type: 'string' },
        documentId: { type: ['string', 'null'], description: 'Review document to present, or null to stop presenting.' },
    }, ['callId']),
};
/** Rename the call (host only). */
exports.clientCallSetTitle = {
    namespace: 'client',
    name: 'client.call.set-title',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Rename a document call. Host only. Broadcasts ws.call.call-meta.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: (0, _shared_1.clientFrameSchema)('call', 'set-title', {
        callId: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 200 },
    }, ['callId', 'title']),
};
// --- Host moderation (2026-09-24) — host only; target must be in the call ---
function moderationFrame(action, what) {
    return (0, _shared_1.clientFrameSchema)('call', action, {
        callId: { type: 'string' },
        userId: { type: 'string', description: `The participant to ${what}.` },
    }, ['callId', 'userId']);
}
exports.clientCallMuteParticipant = {
    namespace: 'client',
    name: 'client.call.mute-participant',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Host asks a participant to mute. The gateway sends ws.call.mute-participant to that person\'s connections only.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: moderationFrame('mute-participant', 'mute'),
};
exports.clientCallRemoveParticipant = {
    namespace: 'client',
    name: 'client.call.remove-participant',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Host removes a participant. The gateway sends ws.call.remove-participant to them, user-status left (reason removed) and call-meta to everyone else.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: moderationFrame('remove-participant', 'remove from the call'),
};
exports.clientCallTransferHost = {
    namespace: 'client',
    name: 'client.call.transfer-host',
    transport: 'signal',
    producer: _shared_1.CLIENT_PRODUCER,
    description: 'Host hands the host role to another participant. The gateway broadcasts ws.call.call-meta with the new hostUserId.',
    tags: [..._shared_1.CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: moderationFrame('transfer-host', 'make host'),
};
//# sourceMappingURL=outbound-call.js.map