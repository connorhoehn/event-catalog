"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsCallRecordingCompleted = exports.wsCallRecordingStarted = exports.wsCallVideoOff = exports.wsCallVideoOn = exports.wsCallEnded = exports.wsCallCancelled = exports.wsCallDeclined = exports.wsCallAccepted = exports.wsCallInvite = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// CALL frames — src/services/call-service.ts
//
// All five call signaling actions share the same envelope shape.
// Each is declared separately so the catalog can track cardinality
// per action.
// ===========================================================================
function callSchema(action) {
    return (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: action },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                lobbyName: { type: 'string' },
                targetUserIds: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: true,
        },
    }, ['action']);
}
exports.wsCallInvite = {
    namespace: 'ws',
    name: 'ws.call.invite',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Call invitation broadcast to target users (or all users when no targets specified).',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: callSchema('invite'),
};
exports.wsCallAccepted = {
    namespace: 'ws',
    name: 'ws.call.accepted',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Call accepted signal delivered to the call initiator.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: callSchema('accepted'),
};
exports.wsCallDeclined = {
    namespace: 'ws',
    name: 'ws.call.declined',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Call declined signal delivered to the call initiator.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: callSchema('declined'),
};
exports.wsCallCancelled = {
    namespace: 'ws',
    name: 'ws.call.cancelled',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Call cancelled signal broadcast to all parties.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: callSchema('cancelled'),
};
exports.wsCallEnded = {
    namespace: 'ws',
    name: 'ws.call.ended',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Call ended signal broadcast to all parties.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: callSchema('ended'),
};
/** Broadcast when a participant enables their video feed. */
exports.wsCallVideoOn = {
    namespace: 'ws',
    name: 'ws.call.video-on',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to call participants when a participant enables their video feed.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'video-on' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                participantId: { type: 'string' },
                userId: { type: 'string' },
            },
            required: ['callId', 'participantId'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast when a participant disables their video feed. */
exports.wsCallVideoOff = {
    namespace: 'ws',
    name: 'ws.call.video-off',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to call participants when a participant disables their video feed.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'video-off' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                participantId: { type: 'string' },
                userId: { type: 'string' },
            },
            required: ['callId', 'participantId'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to all call participants when server-side recording begins. */
exports.wsCallRecordingStarted = {
    namespace: 'ws',
    name: 'ws.call.recording-started',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all call participants when server-side recording of the session starts.',
    tags: [..._shared_1.BASE_TAGS, 'call', 'recording'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'recording-started' },
        data: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                recordingId: { type: 'string' },
                format: { type: 'string', description: 'Recording format (e.g. "mp4", "webm")' },
            },
            required: ['sessionId', 'recordingId', 'format'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to all call participants when server-side recording finishes and a download is available. */
exports.wsCallRecordingCompleted = {
    namespace: 'ws',
    name: 'ws.call.recording-completed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all call participants when recording ends and a download URL for the recording is available.',
    tags: [..._shared_1.BASE_TAGS, 'call', 'recording'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'recording-completed' },
        data: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                recordingId: { type: 'string' },
                downloadUrl: { type: 'string' },
            },
            required: ['sessionId', 'recordingId', 'downloadUrl'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
//# sourceMappingURL=call.js.map