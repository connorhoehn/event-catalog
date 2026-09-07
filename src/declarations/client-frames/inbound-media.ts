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

/**
 * Consumed by useFileUpload: a transfer finished and the file is fetchable.
 * Broadcast to the whole channel
 * (realtime-modules:src/fileupload/FileUploadService.ts:664).
 *
 * `transferId` is load-bearing here, not decorative: peers never saw the
 * correlation `id` and have tracked this transfer by the minted id since
 * `fileupload:started`, so a completion without it leaves their in-flight row
 * unresolved and the file shows up twice. `contentType` can be undefined when
 * neither the row nor the active transfer recorded one.
 */
export const wsFileuploadComplete: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.complete',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'A file transfer completed and is available for download. Broadcast to the channel. Supersedes the type:"upload" ws.upload.completed frame, which the fileupload producer does not build.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:complete', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        transferId: { type: 'string', description: 'Server-minted storage id. Peers key their in-flight row on this, not on `id`.' },
        actor: { type: 'string', description: 'Identity attributed with the upload, as recorded when the transfer began.' },
        uploader: { type: 'string', description: 'Display identity of the participant who uploaded the file.' },
        downloadUrl: { type: 'string', format: 'uri', description: 'HTTP GET target for the finished file.' },
        filename: { type: 'string', description: 'Original filename as supplied by the uploading client.' },
        size: { type: 'integer', minimum: 0, description: 'Total size of the upload in bytes.' },
        contentType: { type: 'string', description: 'MIME type, when either the stored row or the active transfer recorded one.' },
        width: { type: 'integer', minimum: 0, description: 'Pixel width, for image uploads that could be measured.' },
        height: { type: 'integer', minimum: 0, description: 'Pixel height, for image uploads that could be measured.' },
        preview: { type: 'string', description: 'Inline preview payload or URL, when one could be generated.' },
    }, ['channel', 'id', 'transferId', 'downloadUrl', 'filename', 'size']),
};

/**
 * Consumed by useFileUpload: a transfer failed. Sent to the requesting client
 * (realtime-modules:src/fileupload/FileUploadService.ts:292 and :319).
 */
export const wsFileuploadFailed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.failed',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'A file transfer failed. Delivered privately to the requesting client. Supersedes the type:"upload" ws.upload.failed frame, which the fileupload producer does not build.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:failed', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        error: { type: 'string', description: 'Human-readable reason the transfer failed.' },
    }, ['channel', 'id', 'error']),
};

/**
 * Consumed by useFileUpload: the server-minted PUT target for a transfer.
 * Sent to the REQUESTING CLIENT only, not the channel
 * (realtime-modules:src/fileupload/FileUploadService.ts:483).
 *
 * Note the two ids: `id` echoes the caller's correlation id, while
 * `transferId` carries the server-minted storage id that the uploadUrl path
 * is built from — the sender's hook keys its local entry on the latter so it
 * matches what every other participant will see.
 */
export const wsFileuploadUrl: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.url',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'The HTTP PUT target for an accepted upload, returned privately to the requesting client. Supersedes the type:"upload" ws.upload.requested handshake, which the fileupload producer does not build.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:url', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        transferId: { type: 'string', description: 'Server-minted storage id; the uploadUrl path is built from this, not from `id`.' },
        uploadUrl: { type: 'string', format: 'uri', description: 'HTTP PUT target the client uploads the bytes to.' },
    }, ['channel', 'id', 'transferId', 'uploadUrl']),
};

/**
 * Consumed by useFileUpload: a transfer has begun and is now visible to the
 * channel. Emitted by FileUploadService at the point the transfer is
 * registered (realtime-modules:src/fileupload/FileUploadService.ts:521).
 *
 * Declared late: the triage of "events whose producer emits nothing" named
 * this frame as what superseded `ws.upload.requested`, and a test asserting
 * every claimed replacement is really declared caught that the replacement
 * itself was missing from the catalog.
 */
export const wsFileuploadStarted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.started',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'A file transfer has started and is announced to the channel. Supersedes the type:"upload" ws.upload.requested frame, which the fileupload producer does not build.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: inboundSchema('fileupload:started', {
        channel: { type: 'string' },
        transferId: { type: 'string', description: 'Server-side transfer id for this upload; distinct from the client-generated `id`.' },
        id: { type: 'string', description: 'client-generated upload id' },
        actor: { type: 'string', description: 'Identity attributed with the upload, as recorded when the transfer began.' },
        uploader: { type: 'string', description: 'Display identity of the participant who started the upload.' },
        filename: { type: 'string', description: 'Original filename as supplied by the uploading client.' },
        size: { type: 'integer', minimum: 0, description: 'Total size of the upload in bytes.' },
        // The producer spreads these in conditionally, so none are required.
        contentType: { type: 'string', description: 'MIME type, when the client supplied one.' },
        preview: { type: 'string', description: 'Inline preview payload or URL, when one could be generated.' },
        width: { type: 'integer', minimum: 0, description: 'Pixel width, for image uploads that could be measured.' },
        height: { type: 'integer', minimum: 0, description: 'Pixel height, for image uploads that could be measured.' },
    }, ['channel', 'transferId', 'id', 'filename', 'size']),
};

/** Consumed by useFileUpload: optional server-side upload progress. */
export const wsFileuploadProgress: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.fileupload.progress',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway\'s own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    // FileUploadService.publishProgress sends BYTES (`transferred` + `size`),
    // never a percentage. `progress` was declared AND required, so no real
    // frame validated, and useFileUpload's own `progress?: number` guard can
    // never fire. `progress` stays declared-but-optional: removing a property
    // is breaking under this repo's own compat gate.
    schema: inboundSchema('fileupload:progress', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
        transferId: { type: 'string', description: 'Server-side transfer id for this upload; distinct from the client-generated `id`.' },
        actor: { type: 'string', description: 'Identity attributed with the upload, as recorded when the transfer began.' },
        transferred: { type: 'integer', minimum: 0, description: 'Bytes transferred so far. This is what the producer actually sends — divide by `size` for a percentage.' },
        size: { type: 'integer', minimum: 0, description: 'Total size of the upload in bytes.' },
        progress: { type: 'number', description: 'Upload progress as a percentage, 0-100. NEVER EMITTED — FileUploadService sends `transferred`/`size` instead.' },
    }, ['channel', 'id']),
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
