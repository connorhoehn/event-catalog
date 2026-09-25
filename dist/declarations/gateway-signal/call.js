"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsCallRemoveParticipant = exports.wsCallMuteParticipant = exports.wsCallUserStatus = exports.wsCallParticipantState = exports.wsCallInviteExpired = exports.wsCallCallMeta = exports.wsCallRecordingCompleted = exports.wsCallRecordingStarted = exports.wsCallVideoOff = exports.wsCallVideoOn = exports.wsCallEnded = exports.wsCallCancelled = exports.wsCallDeclined = exports.wsCallAccepted = exports.wsCallInvite = void 0;
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
// ===========================================================================
// Document calls (2026-09-24) — realtime-modules src/call/CallService.ts.
// A call that belongs to a document review: live meta (title, review
// documents, presenter, per-person ring state), per-target ring expiry, and
// the in-call roster frames the gateway has always relayed but never declared.
// ===========================================================================
const documentCallMetaData = {
    type: 'object',
    properties: {
        callId: { type: 'string' },
        documentId: { type: 'string', description: 'Host document (also the LVS lobby name).' },
        title: { type: 'string' },
        documentIds: { type: 'array', items: { type: 'string' }, description: 'Review documents, host document first.' },
        documentTitles: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional document id → title map sent with the list, so joiners can label rows before their own document list loads.' },
        hostUserId: { type: 'string', description: 'userId of the person who started the call; may end it for everyone and rename it.' },
        media: { type: 'string', enum: ['video', 'audio'], description: 'Media mode chosen at start: video, or audio with cameras off.' },
        startedAt: { type: 'integer', description: 'Epoch milliseconds when the call started.' },
        presenting: {
            description: 'Who is presenting which review document, or null.',
            oneOf: [
                { type: 'null' },
                {
                    type: 'object',
                    properties: {
                        documentId: { type: 'string' },
                        userId: { type: 'string' },
                        since: { type: 'integer' },
                    },
                    required: ['documentId', 'userId', 'since'],
                },
            ],
        },
        invites: {
            type: 'object',
            description: 'userId → ring state of each invited person.',
            additionalProperties: {
                type: 'object',
                properties: {
                    at: { type: 'integer', description: 'Epoch milliseconds of the latest ring to this person.' },
                    state: { type: 'string', enum: ['ringing', 'accepted', 'declined', 'missed', 'notified', 'removed'], description: 'Ring state; notified = had no connected client, got a notification instead; removed = the host removed them.' },
                    by: { type: 'string', description: 'userId of whoever sent the invite (receives invite-expired).' },
                },
                required: ['at', 'state'],
            },
        },
    },
    required: ['callId', 'documentId', 'title', 'documentIds', 'hostUserId', 'media', 'startedAt', 'presenting', 'invites'],
    additionalProperties: true,
};
/** The full meta of a document call, after a `meta` query and after every change. */
exports.wsCallCallMeta = {
    namespace: 'ws',
    name: 'ws.call.call-meta',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Live meta of a document call (title, review documents, presenter, per-person ring state). Sent to the asker after a meta query and to every participant after set-documents / present / set-title / invite / accept / ring expiry.',
    tags: [..._shared_1.BASE_TAGS, 'call', 'document-call'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'call-meta' },
        data: documentCallMetaData,
    }, ['action', 'data']),
};
/** One target's ring timed out; sent by the sweep leader to the inviter's clients. */
exports.wsCallInviteExpired = {
    namespace: 'ws',
    name: 'ws.call.invite-expired',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A document-call ring to one person expired unanswered (60 s). Sent to the inviter (their row reads "Didn\'t answer") and to that person (their ring closes); the call itself goes on.',
    tags: [..._shared_1.BASE_TAGS, 'call', 'document-call'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'invite-expired' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                userId: { type: 'string' },
                inviteAt: { type: 'integer', description: 'Epoch milliseconds of the ring that expired; a later ring of the same person supersedes this outcome.' },
            },
            required: ['callId', 'userId'],
            additionalProperties: false,
        },
    }, ['action', 'data']),
};
/** In-call media flags of one participant, relayed to the others. */
exports.wsCallParticipantState = {
    namespace: 'ws',
    name: 'ws.call.participant-state',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A participant\'s camera / mic / screen-share state and display name, relayed to the rest of the call.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'participant-state' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                callerId: { type: 'string', description: 'userId of the participant this state belongs to (legacy name).' },
                userId: { type: 'string' },
                participantId: { type: 'string' },
                displayName: { type: 'string' },
                cameraOn: { type: 'boolean', description: 'True while the participant\'s camera is publishing.' },
                audioOn: { type: 'boolean', description: 'True while the participant\'s microphone is unmuted.' },
                screenSharing: { type: 'boolean', description: 'True while the participant shares their screen.' },
                status: { type: 'string', enum: ['in-call', 'left', 'on-hold', 'reconnecting'] },
            },
            additionalProperties: true,
        },
    }, ['action']),
};
/** Presence of one participant in the call. `reconnecting` (2026-09-24) covers the rejoin grace. */
exports.wsCallUserStatus = {
    namespace: 'ws',
    name: 'ws.call.user-status',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A participant is in the call, on hold, reconnecting (socket dropped, inside the rejoin grace) or has left.',
    tags: [..._shared_1.BASE_TAGS, 'call'],
    schema: (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: 'user-status' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                userId: { type: ['string', 'null'] },
                status: { type: 'string', enum: ['in-call', 'left', 'on-hold', 'reconnecting'] },
                reason: { type: 'string' },
                rejoinGraceMs: { type: 'integer', description: 'Milliseconds the dropped participant has to come back before `left` follows.' },
            },
            required: ['callId', 'status'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
// --- Host moderation (2026-09-24) -------------------------------------------
function moderationSchema(action) {
    return (0, _shared_1.wsSchema)('call', {
        action: { type: 'string', const: action },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                userId: { type: 'string', description: 'The person being moderated — only their own clients receive this frame.' },
                by: { type: 'string', description: 'userId of the host who did it.' },
            },
            required: ['callId', 'userId', 'by'],
            additionalProperties: false,
        },
    }, ['action', 'data']);
}
/** The host asked this person to mute; their client mutes itself and announces participant-state. */
exports.wsCallMuteParticipant = {
    namespace: 'ws',
    name: 'ws.call.mute-participant',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'The host muted this participant. Sent to every connection of the target only; their client mutes and its participant-state tells the others.',
    tags: [..._shared_1.BASE_TAGS, 'call', 'document-call'],
    schema: moderationSchema('mute-participant'),
};
/** The host removed this person; their client leaves. Others get user-status left (reason removed) and call-meta. */
exports.wsCallRemoveParticipant = {
    namespace: 'ws',
    name: 'ws.call.remove-participant',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'The host removed this participant from the call. Sent to every connection of the target only; the rest of the call gets user-status left with reason "removed" and call-meta. Only a new invite lets them back in.',
    tags: [..._shared_1.BASE_TAGS, 'call', 'document-call'],
    schema: moderationSchema('remove-participant'),
};
//# sourceMappingURL=call.js.map