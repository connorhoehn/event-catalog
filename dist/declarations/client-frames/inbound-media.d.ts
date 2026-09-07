import type { EventDeclaration } from '../../types/index';
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
export declare const wsFileuploadComplete: EventDeclaration;
/**
 * Consumed by useFileUpload: a transfer failed. Sent to the requesting client
 * (realtime-modules:src/fileupload/FileUploadService.ts:292 and :319).
 */
export declare const wsFileuploadFailed: EventDeclaration;
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
export declare const wsFileuploadUrl: EventDeclaration;
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
export declare const wsFileuploadStarted: EventDeclaration;
/** Consumed by useFileUpload: optional server-side upload progress. */
export declare const wsFileuploadProgress: EventDeclaration;
/** Consumed by useFileUpload: antivirus scan in progress. */
export declare const wsFileuploadScanning: EventDeclaration;
/** Consumed by useFileUpload: cancel acknowledged. */
export declare const wsFileuploadCancelled: EventDeclaration;
/** Consumed by useVideoHangout: a participant joined or updated. */
export declare const wsVideohangoutParticipant: EventDeclaration;
/** Consumed by useVideoHangout: a participant toggled video/audio. */
export declare const wsVideohangoutMedia: EventDeclaration;
//# sourceMappingURL=inbound-media.d.ts.map