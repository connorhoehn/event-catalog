"use strict";
// src/declarations/client-frames/inbound-media.ts
//
// INBOUND (gateway → client) push frames for the `fileupload` and
// `videohangout` client-hook services — the receive side of
// ./outbound-media.ts.
//
// Sliced verbatim out of the former single-file client-frames.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsVideohangoutMedia = exports.wsVideohangoutParticipant = exports.wsFileuploadCancelled = exports.wsFileuploadScanning = exports.wsFileuploadProgress = void 0;
const _shared_1 = require("./_shared");
// --- fileupload --------------------------------------------------------------
/** Consumed by useFileUpload: optional server-side upload progress. */
exports.wsFileuploadProgress = {
    namespace: 'ws',
    name: 'ws.fileupload.progress',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway\'s own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    // FileUploadService.publishProgress sends BYTES (`transferred` + `size`),
    // never a percentage. `progress` was declared AND required, so no real
    // frame validated, and useFileUpload's own `progress?: number` guard can
    // never fire. `progress` stays declared-but-optional: removing a property
    // is breaking under this repo's own compat gate.
    schema: (0, _shared_1.inboundSchema)('fileupload:progress', {
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
exports.wsFileuploadScanning = {
    namespace: 'ws',
    name: 'ws.fileupload.scanning',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Antivirus scan is IN PROGRESS for an uploaded file — distinct from the existing ws.upload.scanned declaration, which reports the scan OUTCOME (clean/infected). The scanning-vs-scanned naming tension is documented per Wave A2, not renamed.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: (0, _shared_1.inboundSchema)('fileupload:scanning', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
    }, ['channel', 'id']),
};
/** Consumed by useFileUpload: cancel acknowledged. */
exports.wsFileuploadCancelled = {
    namespace: 'ws',
    name: 'ws.fileupload.cancelled',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Acknowledgement that a client-requested upload cancellation completed (useFileUpload.cancel round-trip). Part of the fileupload:* hook contract — see ws.fileupload.progress for the upload-vs-fileupload naming note.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'fileupload', 'client-contract'],
    schema: (0, _shared_1.inboundSchema)('fileupload:cancelled', {
        channel: { type: 'string' },
        id: { type: 'string', description: 'client-generated upload id' },
    }, ['channel', 'id']),
};
// --- videohangout ------------------------------------------------------------
/** Consumed by useVideoHangout: a participant joined or updated. */
exports.wsVideohangoutParticipant = {
    namespace: 'ws',
    name: 'ws.videohangout.participant',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Participant joined or updated in a hangout session, carrying the full HangoutParticipant. NOTE: the gateway currently signals hangout/call invites via type:"call" frames (ws.call.*); videohangout:* is the useVideoHangout hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'videohangout', 'client-contract'],
    schema: (0, _shared_1.inboundSchema)('videohangout:participant', {
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
exports.wsVideohangoutMedia = {
    namespace: 'ws',
    name: 'ws.videohangout.media',
    transport: 'signal',
    producer: _shared_1.GATEWAY_PRODUCER,
    description: 'Media-state change for a hangout participant (video/audio toggled). Part of the videohangout:* hook contract — see ws.videohangout.participant for the videohangout-vs-ws.call.* naming note.',
    tags: [..._shared_1.GATEWAY_BASE_TAGS, 'videohangout', 'client-contract'],
    schema: (0, _shared_1.inboundSchema)('videohangout:media', {
        channel: { type: 'string' },
        clientId: { type: 'string' },
        videoOn: { type: 'boolean' },
        audioOn: { type: 'boolean' },
    }, ['channel', 'clientId', 'videoOn', 'audioOn']),
};
//# sourceMappingURL=inbound-media.js.map