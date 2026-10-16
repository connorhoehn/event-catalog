import type { EventDeclaration } from '../../types/index';
/** MeetingErrorCode, in source order. */
export declare const MEETING_ERROR_CODES: readonly ["INVALID_ACTION", "INVALID_PAYLOAD", "UNAUTHENTICATED", "FORBIDDEN", "NOT_SUBSCRIBED", "NOT_FOUND", "CONFLICT", "RATE_LIMITED"];
/** How many announcements BreakoutState.announcements keeps (realtime-modules MAX_ANNOUNCEMENT_HISTORY, 0.130.0). */
export declare const MAX_ANNOUNCEMENT_HISTORY = 20;
export declare const wsMeetingSnapshot: EventDeclaration;
export declare const wsMeetingHandsChanged: EventDeclaration;
export declare const wsMeetingBreakoutChanged: EventDeclaration;
export declare const wsMeetingBreakoutAnnouncement: EventDeclaration;
export declare const wsMeetingUnsubscribed: EventDeclaration;
export declare const wsMeetingError: EventDeclaration;
/** Every inbound `meeting` frame, in MeetingServerFrame order. */
export declare const wsMeetingDeclarations: EventDeclaration[];
//# sourceMappingURL=meeting.d.ts.map