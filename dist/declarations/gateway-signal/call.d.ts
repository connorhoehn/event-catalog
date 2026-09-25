import type { EventDeclaration } from '../../types/index';
export declare const wsCallInvite: EventDeclaration;
export declare const wsCallAccepted: EventDeclaration;
export declare const wsCallDeclined: EventDeclaration;
export declare const wsCallCancelled: EventDeclaration;
export declare const wsCallEnded: EventDeclaration;
/** Broadcast when a participant enables their video feed. */
export declare const wsCallVideoOn: EventDeclaration;
/** Broadcast when a participant disables their video feed. */
export declare const wsCallVideoOff: EventDeclaration;
/** Broadcast to all call participants when server-side recording begins. */
export declare const wsCallRecordingStarted: EventDeclaration;
/** Broadcast to all call participants when server-side recording finishes and a download is available. */
export declare const wsCallRecordingCompleted: EventDeclaration;
/** The full meta of a document call, after a `meta` query and after every change. */
export declare const wsCallCallMeta: EventDeclaration;
/** One target's ring timed out; sent by the sweep leader to the inviter's clients. */
export declare const wsCallInviteExpired: EventDeclaration;
/** In-call media flags of one participant, relayed to the others. */
export declare const wsCallParticipantState: EventDeclaration;
/** Presence of one participant in the call. `reconnecting` (2026-09-24) covers the rejoin grace. */
export declare const wsCallUserStatus: EventDeclaration;
//# sourceMappingURL=call.d.ts.map