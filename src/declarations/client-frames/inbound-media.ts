// src/declarations/client-frames/inbound-media.ts
//
// INBOUND (gateway → client) push frames for the `fileupload` and
// `videohangout` client-hook services — the receive side of
// ./outbound-media.ts.
//
// Sliced verbatim out of the former single-file client-frames.ts.

import type { EventDeclaration } from '../../types/index';
import { GATEWAY_PRODUCER, GATEWAY_BASE_TAGS, inboundSchema } from './_shared';

// --- fileupload --------------------------------------------------------------

/** Consumed by useFileUpload: optional server-side upload progress. */
export const wsFileuploadProgress: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.progress',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway\'s own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:progress', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        progress: { type: 'number', description: 'Upload progress as a percentage, 0-100.' },
    }, ['channel', 'id', 'progress']),
};

/** Consumed by useFileUpload: antivirus scan in progress. */
export const wsFileuploadScanning: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.scanning',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Antivirus scan is IN PROGRESS for an uploaded file — distinct from the existing ws.upload.scanned declaration, which reports the scan OUTCOME (clean/infected). The scanning-vs-scanned naming tension is documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:scanning', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
    }, ['channel', 'id']),
};

/** Consumed by useFileUpload: cancel acknowledged. */
export const wsFileuploadCancelled: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.cancelled',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Acknowledgement that a client-requested upload cancellation completed (useFileUpload.cancel round-trip). Part of the fileupload:* hook contract — see ws.fileupload.progress for the upload-vs-fileupload naming note.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:cancelled', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
    }, ['channel', 'id']),
};

// --- videohangout ------------------------------------------------------------

/** Consumed by useVideoHangout: a participant joined or updated. */
export const wsVideohangoutParticipant: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.videohangout.participant',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Participant joined or updated in a hangout session, carrying the full HangoutParticipant. NOTE: the gateway currently signals hangout/call invites via type:"call" frames (ws.call.*); videohangout:* is the useVideoHangout hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'videohangout', 'client-contract'],
    schema: inboundSchema('videohangout:participant', {
        channel: { type: 'string' },
        participant: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                displayName: { type: 'string' },
                role: { type: 'string', enum: ['host', 'participant', 'viewer'] },
                videoOn: { type: 'boolean' },
                audioOn: { type: 'boolean' },
                joinedAt: { type: 'string' },
            },
            required: ['clientId', 'role'],
            additionalProperties: true,
        },
    }, ['channel', 'participant']),
};

/** Consumed by useVideoHangout: a participant toggled video/audio. */
export const wsVideohangoutMedia: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.videohangout.media',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Media-state change for a hangout participant (video/audio toggled). Part of the videohangout:* hook contract — see ws.videohangout.participant for the videohangout-vs-ws.call.* naming note.',
    tags: [...GATEWAY_BASE_TAGS, 'videohangout', 'client-contract'],
    schema: inboundSchema('videohangout:media', {
        channel: { type: 'string' },
        clientId: { type: 'string' },
        videoOn: { type: 'boolean' },
        audioOn: { type: 'boolean' },
    }, ['channel', 'clientId', 'videoOn', 'audioOn']),
};
