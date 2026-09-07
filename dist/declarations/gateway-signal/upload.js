"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsUploadUrlRevoked = exports.wsUploadScanQuarantined = exports.wsUploadScanned = exports.wsUploadFailed = exports.wsUploadCompleted = exports.wsUploadUrlIssued = exports.wsUploadRequested = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// UPLOAD frames — presigned URL upload lifecycle pushed via WebSocket
// ===========================================================================
/** Acknowledgement that the gateway received a file upload request and is issuing a presigned URL. */
exports.wsUploadRequested = {
    namespace: 'ws',
    name: 'ws.upload.requested',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Acknowledgement sent when the gateway receives a file upload request from a client.',
    tags: [..._shared_1.BASE_TAGS, 'upload'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'requested' },
        data: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                channel: { type: 'string' },
                filename: { type: 'string' },
                size: { type: 'number' },
                mimeType: { type: 'string' },
            },
            required: ['clientId', 'channel', 'filename'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Presigned upload URL issued to the requesting client. */
exports.wsUploadUrlIssued = {
    namespace: 'ws',
    name: 'ws.upload.url-issued',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Presigned S3 upload URL issued to the client so they can PUT the file directly.',
    tags: [..._shared_1.BASE_TAGS, 'upload'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'url-issued' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                presignedUrl: { type: 'string' },
                expiresAt: { type: 'string', description: 'ISO-8601 timestamp after which the presigned URL stops working.' },
            },
            required: ['uploadId', 'presignedUrl', 'expiresAt'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to the channel when a file upload completes successfully. */
exports.wsUploadCompleted = {
    namespace: 'ws',
    name: 'ws.upload.completed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to the channel when a file upload completes and a download URL is available.',
    tags: [..._shared_1.BASE_TAGS, 'upload'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'completed' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                downloadUrl: { type: 'string' },
            },
            required: ['uploadId', 'downloadUrl'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Sent to the uploading client when a file upload fails. */
exports.wsUploadFailed = {
    namespace: 'ws',
    name: 'ws.upload.failed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Sent to the uploading client when the file upload fails at any stage.',
    tags: [..._shared_1.BASE_TAGS, 'upload'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'failed' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                error: { type: 'string' },
            },
            required: ['uploadId', 'error'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Sent to the channel after a security scan completes on the uploaded file. */
exports.wsUploadScanned = {
    namespace: 'ws',
    name: 'ws.upload.scanned',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Sent to the channel after a security scan completes on the uploaded file, reporting clean or infected status.',
    tags: [..._shared_1.BASE_TAGS, 'upload'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'scanned' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                status: { type: 'string', enum: ['clean', 'infected'] },
            },
            required: ['uploadId', 'status'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/**
 * Sent to the uploading client when a security scan finds a threat and the
 * file is quarantined. The presigned download URL is revoked; the client
 * should display an error and optionally prompt for re-upload.
 */
exports.wsUploadScanQuarantined = {
    namespace: 'ws',
    name: 'ws.upload.scan-quarantined',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Sent to the uploading client when a security scan detects a threat. The file is quarantined and the download URL is revoked.',
    tags: [..._shared_1.BASE_TAGS, 'upload', 'security'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'scan-quarantined' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                reason: { type: 'string', description: 'Human-readable quarantine reason (e.g. threat name)' },
            },
            required: ['uploadId', 'reason'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/**
 * Sent to the uploading client when a previously issued presigned download
 * URL is explicitly revoked (e.g. after quarantine, policy change, or TTL
 * expiry before download).
 */
exports.wsUploadUrlRevoked = {
    namespace: 'ws',
    name: 'ws.upload.url-revoked',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Sent to the uploading client when a presigned download URL is explicitly revoked. Clients should discard any cached URL.',
    tags: [..._shared_1.BASE_TAGS, 'upload', 'security'],
    schema: (0, _shared_1.wsSchema)('upload', {
        action: { type: 'string', const: 'url-revoked' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                reason: { type: 'string', description: 'Reason for revocation (e.g. "quarantine", "policy", "expired")' },
            },
            required: ['uploadId', 'reason'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
//# sourceMappingURL=upload.js.map