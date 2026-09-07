// src/declarations/client-frames/outbound-media.ts
//
// OUTBOUND (client → gateway) frames for the two media services that have NO
// gateway service counterpart today — `fileupload` and `videohangout` are
// client-hook contracts and are absent from the gateway MessageValidator
// allow-list. Kept apart from ./outbound-fanout.ts for exactly that reason.
//
// Sliced verbatim out of the former single-file client-frames.ts.

import type { EventDeclaration } from '../../types/index';
import { CLIENT_PRODUCER, CLIENT_BASE_TAGS, clientFrameSchema } from './_shared';

// ===========================================================================
// OUTBOUND — fileupload (useFileUpload.ts)
//
// NOTE: the websocket-gateway MessageValidator allow-list does not currently
// include the 'fileupload' service — these frames are the client-hook
// contract; the gateway-side service is pending (the gateway's own upload
// lifecycle is declared as ws.upload.* in gateway-signal.ts).
// ===========================================================================

/** Sent by useFileUpload.upload() step 1. */
export const clientFileuploadRequestUpload: EventDeclaration = {
    namespace: 'client',
    name: 'client.fileupload.request-upload',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for a presigned upload URL (useFileUpload.upload step 1). `id` is a client-generated upload identifier echoed back on all subsequent fileupload:* frames.',
    tags: [...CLIENT_BASE_TAGS, 'fileupload'],
    schema: clientFrameSchema('fileupload', 'request-upload', {
        id: { type: 'string', description: 'client-generated upload id' },
        filename: { type: 'string' },
        size: { type: 'number', description: 'file size in bytes' },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'id', 'filename', 'size']),
};

/** Sent by useFileUpload after the XHR PUT to the presigned URL completes. */
export const clientFileuploadComplete: EventDeclaration = {
    namespace: 'client',
    name: 'client.fileupload.complete',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that the presigned-URL PUT finished (useFileUpload.upload step 4). Gateway replies with fileupload:complete / fileupload:scanning depending on scan policy.',
    tags: [...CLIENT_BASE_TAGS, 'fileupload'],
    schema: clientFrameSchema('fileupload', 'complete', {
        id: { type: 'string' },
    }, ['channel', 'id']),
};

/** Sent by useFileUpload.cancel(). */
export const clientFileuploadCancel: EventDeclaration = {
    namespace: 'client',
    name: 'client.fileupload.cancel',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to cancel an in-flight upload (useFileUpload.cancel). Gateway acknowledges with fileupload:cancelled.',
    tags: [...CLIENT_BASE_TAGS, 'fileupload'],
    schema: clientFrameSchema('fileupload', 'cancel', {
        id: { type: 'string' },
    }, ['channel', 'id']),
};

// ===========================================================================
// OUTBOUND — videohangout (useVideoHangout.ts)
//
// NOTE: the websocket-gateway routes hangout/call invite signaling through
// the 'call' service (ws.call.* frames) and has no 'videohangout' service in
// its MessageValidator allow-list. The videohangout:* service is the
// client-hook (LVS session signaling) contract — naming tension documented
// here per Wave A2; no renames in this wave.
// ===========================================================================

/** Sent by useVideoHangout.start(). */
export const clientVideohangoutStart: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.start',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to start a video hangout/call session on a channel (useVideoHangout.start). Gateway replies with videohangout:created.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'start', {
        type: { type: 'string', enum: ['hangout', 'call'] },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel']),
};

/** Sent by useVideoHangout.join(). */
export const clientVideohangoutJoin: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.join',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to join an existing hangout session (useVideoHangout.join). Gateway replies with videohangout:joined.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'join', {
        sessionId: { type: 'string' },
    }, ['channel', 'sessionId']),
};

/** Sent by useVideoHangout.leave(). */
export const clientVideohangoutLeave: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.leave',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that it is leaving the hangout session (useVideoHangout.leave).',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'leave', {
        sessionId: { type: 'string' },
    }, ['channel', 'sessionId']),
};

/** Sent by useVideoHangout.end(). */
export const clientVideohangoutEnd: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.end',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client (host) request to end the hangout session for all participants (useVideoHangout.end).',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'end', {
        sessionId: { type: 'string' },
    }, ['channel', 'sessionId']),
};

/** Sent by useVideoHangout.toggleVideo(). */
export const clientVideohangoutToggleVideo: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.toggle-video',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that it toggled its video feed on/off (useVideoHangout.toggleVideo). Gateway fans out videohangout:media.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'toggle-video', {
        sessionId: { type: 'string' },
        videoOn: { type: 'boolean' },
    }, ['channel', 'sessionId', 'videoOn']),
};

/** Sent by useVideoHangout.toggleAudio(). */
export const clientVideohangoutToggleAudio: EventDeclaration = {
    namespace: 'client',
    name: 'client.videohangout.toggle-audio',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client notification that it toggled its audio feed on/off (useVideoHangout.toggleAudio). Gateway fans out videohangout:media.',
    tags: [...CLIENT_BASE_TAGS, 'videohangout'],
    schema: clientFrameSchema('videohangout', 'toggle-audio', {
        sessionId: { type: 'string' },
        audioOn: { type: 'boolean' },
    }, ['channel', 'sessionId', 'audioOn']),
};
