import type { EventDeclaration } from '../../types/index';
/** Acknowledgement that the gateway received a file upload request and is issuing a presigned URL. */
export declare const wsUploadRequested: EventDeclaration;
/** Presigned upload URL issued to the requesting client. */
export declare const wsUploadUrlIssued: EventDeclaration;
/** Broadcast to the channel when a file upload completes successfully. */
export declare const wsUploadCompleted: EventDeclaration;
/** Sent to the uploading client when a file upload fails. */
export declare const wsUploadFailed: EventDeclaration;
/** Sent to the channel after a security scan completes on the uploaded file. */
export declare const wsUploadScanned: EventDeclaration;
/**
 * Sent to the uploading client when a security scan finds a threat and the
 * file is quarantined. The presigned download URL is revoked; the client
 * should display an error and optionally prompt for re-upload.
 */
export declare const wsUploadScanQuarantined: EventDeclaration;
/**
 * Sent to the uploading client when a previously issued presigned download
 * URL is explicitly revoked (e.g. after quarantine, policy change, or TTL
 * expiry before download).
 */
export declare const wsUploadUrlRevoked: EventDeclaration;
//# sourceMappingURL=upload.d.ts.map