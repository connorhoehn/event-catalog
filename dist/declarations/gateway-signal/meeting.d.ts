import type { EventDeclaration } from '../../types/index';
/** MeetingErrorCode, in source order. */
export declare const MEETING_ERROR_CODES: readonly ["INVALID_ACTION", "INVALID_PAYLOAD", "UNAUTHENTICATED", "FORBIDDEN", "NOT_SUBSCRIBED", "NOT_FOUND", "CONFLICT"];
export declare const wsMeetingSnapshot: EventDeclaration;
export declare const wsMeetingHandsChanged: EventDeclaration;
export declare const wsMeetingBreakoutChanged: EventDeclaration;
export declare const wsMeetingBreakoutAnnouncement: EventDeclaration;
export declare const wsMeetingUnsubscribed: EventDeclaration;
export declare const wsMeetingError: EventDeclaration;
/** Every inbound `meeting` frame, in MeetingServerFrame order. */
export declare const wsMeetingDeclarations: EventDeclaration[];
//# sourceMappingURL=meeting.d.ts.map