import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// CALL frames — src/services/call-service.ts
//
// All five call signaling actions share the same envelope shape.
// Each is declared separately so the catalog can track cardinality
// per action.
// ===========================================================================

function callSchema(action: string): Record<string, unknown> {
    return wsSchema('call', {
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

export const wsCallInvite: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.invite',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call invitation broadcast to target users (or all users when no targets specified).',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('invite'),
};

export const wsCallAccepted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.accepted',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call accepted signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('accepted'),
};

export const wsCallDeclined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.declined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call declined signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('declined'),
};

export const wsCallCancelled: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.cancelled',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call cancelled signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('cancelled'),
};

export const wsCallEnded: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.ended',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call ended signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('ended'),
};

/** Broadcast when a participant enables their video feed. */
export const wsCallVideoOn: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.video-on',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to call participants when a participant enables their video feed.',
    tags: [...BASE_TAGS, 'call'],
    schema: wsSchema('call', {
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
export const wsCallVideoOff: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.video-off',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to call participants when a participant disables their video feed.',
    tags: [...BASE_TAGS, 'call'],
    schema: wsSchema('call', {
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
export const wsCallRecordingStarted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.recording-started',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all call participants when server-side recording of the session starts.',
    tags: [...BASE_TAGS, 'call', 'recording'],
    schema: wsSchema('call', {
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
export const wsCallRecordingCompleted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.recording-completed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all call participants when recording ends and a download URL for the recording is available.',
    tags: [...BASE_TAGS, 'call', 'recording'],
    schema: wsSchema('call', {
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
