import type { EventDeclaration } from '../../types/index';
/**
 * MEETING_ID_PATTERN, plus the server's refusal of the breakout-lobby
 * separator `~breakout~` (a meeting id holding it would read as another
 * meeting's breakout lobby).
 */
export declare const MEETING_ID_SCHEMA_PATTERN = "^(?!.*~breakout~)[A-Za-z0-9:_.~-]{1,200}$";
/** BREAKOUT_ROOM_ID_PATTERN — a room id becomes part of an LVS lobby name. */
export declare const BREAKOUT_ROOM_ID_SCHEMA_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
export declare const clientMeetingSubscribe: EventDeclaration;
export declare const clientMeetingUnsubscribe: EventDeclaration;
export declare const clientMeetingHandRaise: EventDeclaration;
export declare const clientMeetingHandLower: EventDeclaration;
export declare const clientMeetingHandLowerAll: EventDeclaration;
export declare const clientMeetingBreakoutConfigure: EventDeclaration;
export declare const clientMeetingBreakoutAddRoom: EventDeclaration;
export declare const clientMeetingBreakoutRename: EventDeclaration;
export declare const clientMeetingBreakoutAssign: EventDeclaration;
export declare const clientMeetingBreakoutAutoAssign: EventDeclaration;
export declare const clientMeetingBreakoutOpen: EventDeclaration;
export declare const clientMeetingBreakoutClose: EventDeclaration;
export declare const clientMeetingBreakoutTimer: EventDeclaration;
export declare const clientMeetingBreakoutBroadcast: EventDeclaration;
export declare const clientMeetingBreakoutJoin: EventDeclaration;
export declare const clientMeetingBreakoutLeave: EventDeclaration;
export declare const clientMeetingBreakoutEnd: EventDeclaration;
/** Every outbound `meeting` frame, in MEETING_ACTIONS order. */
export declare const clientMeetingDeclarations: EventDeclaration[];
//# sourceMappingURL=outbound-meeting.d.ts.map