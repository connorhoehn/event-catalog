import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// UPLOAD frames — presigned URL upload lifecycle pushed via WebSocket
// ===========================================================================

/** Acknowledgement that the gateway received a file upload request and is issuing a presigned URL. */
export const wsUploadRequested: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.requested',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Acknowledgement sent when the gateway receives a file upload request from a client.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
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
export const wsUploadUrlIssued: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.url-issued',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presigned S3 upload URL issued to the client so they can PUT the file directly.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
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
export const wsUploadCompleted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.completed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to the channel when a file upload completes and a download URL is available.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
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
export const wsUploadFailed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.failed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the uploading client when the file upload fails at any stage.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
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
export const wsUploadScanned: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.scanned',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the channel after a security scan completes on the uploaded file, reporting clean or infected status.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
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
export const wsUploadScanQuarantined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.scan-quarantined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the uploading client when a security scan detects a threat. The file is quarantined and the download URL is revoked.',
    tags: [...BASE_TAGS, 'upload', 'security'],
    schema: wsSchema('upload', {
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
export const wsUploadUrlRevoked: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.url-revoked',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the uploading client when a presigned download URL is explicitly revoked. Clients should discard any cached URL.',
    tags: [...BASE_TAGS, 'upload', 'security'],
    schema: wsSchema('upload', {
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
