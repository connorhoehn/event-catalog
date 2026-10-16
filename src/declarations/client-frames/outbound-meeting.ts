// src/declarations/client-frames/outbound-meeting.ts
//
// OUTBOUND (client → gateway) frames for the `meeting` service (2026-10-16):
// raised hands and breakout rooms for a call already running on LVS.
// Coordination state only — no media.
//
// Source: realtime-modules src/client/meeting/useMeeting.ts (the frames) and
// src/meeting/MeetingService.ts `handleAction` / `apply` (what the server
// reads from each). Every frame is `{ service: 'meeting', action, meetingId,
// ...fields }`. The server answers a refused verb with ws.meeting.error to the
// sender only; an accepted one fans out ws.meeting.hands.changed and/or
// ws.meeting.breakout.changed to everyone subscribed.
//
// Organizer-only verbs (ORGANIZER_ACTIONS) say so in their description. The
// organizer is whoever the host's `isOrganizer` hook says, or by default the
// meeting's first subscriber.
//
// Event names mirror the wire `action` verbatim (`hand.lowerAll`,
// `breakout.addRoom`, `breakout.autoAssign`), like client.chat.addMembers.
//
// Limits are the server's defaults: MEETING_ID_PATTERN,
// BREAKOUT_ROOM_ID_PATTERN, MAX_ROOM_NAME_LENGTH (80),
// MAX_ANNOUNCEMENT_LENGTH (500), MAX_DISPLAY_NAME_LENGTH (80). `maxRooms`
// (default 50) and `maxTimerMs` (default 4 h) are host config, so they are
// described, not pinned in the schema.

import type { EventDeclaration } from '../../types/index';
import { CLIENT_PRODUCER, CLIENT_BASE_TAGS, clientFrameSchema } from './_shared';

const TAGS = [...CLIENT_BASE_TAGS, 'meeting'];
const ORGANIZER_TAGS = [...TAGS, 'organizer-only'];

/**
 * MEETING_ID_PATTERN, plus the server's refusal of the breakout-lobby
 * separator `~breakout~` (a meeting id holding it would read as another
 * meeting's breakout lobby).
 */
export const MEETING_ID_SCHEMA_PATTERN = '^(?!.*~breakout~)[A-Za-z0-9:_.~-]{1,200}$';
/** BREAKOUT_ROOM_ID_PATTERN — a room id becomes part of an LVS lobby name. */
export const BREAKOUT_ROOM_ID_SCHEMA_PATTERN = '^[A-Za-z0-9_-]{1,64}$';

function meetingIdField(): Record<string, unknown> {
    return {
        type: 'string',
        pattern: MEETING_ID_SCHEMA_PATTERN,
        description: 'The meeting this frame addresses. It is also the main call\'s LVS lobby name: 1–200 of A-Z a-z 0-9 : _ . ~ -, never containing "~breakout~".',
    };
}

function roomIdField(what: string): Record<string, unknown> {
    return { type: 'string', pattern: BREAKOUT_ROOM_ID_SCHEMA_PATTERN, description: `${what} 1–64 of A-Z a-z 0-9 _ -.` };
}

function roomNameField(description: string): Record<string, unknown> {
    return { type: 'string', minLength: 1, maxLength: 80, description };
}

function immediateField(): Record<string, unknown> {
    return {
        type: 'boolean',
        description: 'Skip the host\'s closing grace and close at once. Only `true` changes anything; a second close or end during the grace also closes at once.',
    };
}

function roomIdsField(description: string): Record<string, unknown> {
    return { type: 'array', items: { type: 'string', description: 'A breakout room id.' }, description };
}

function meetingFrame(
    action: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return clientFrameSchema('meeting', action, { meetingId: meetingIdField(), ...extra }, ['meetingId', ...required]);
}

function decl(name: string, description: string, schema: Record<string, unknown>, organizerOnly = false): EventDeclaration {
    return {
        namespace: 'client',
        name,
        transport: 'signal',
        producer: CLIENT_PRODUCER,
        description,
        tags: organizerOnly ? ORGANIZER_TAGS : TAGS,
        schema,
    };
}

// --- subscription -----------------------------------------------------------

export const clientMeetingSubscribe = decl(
    'client.meeting.subscribe',
    'Join a meeting\'s coordination channel. The gateway replies to the sender only with ws.meeting.meeting.snapshot (or ws.meeting.error FORBIDDEN when the channel guard refuses). The first subscriber becomes the default organizer. Sent again after every reconnect.',
    meetingFrame('subscribe'),
);

export const clientMeetingUnsubscribe = decl(
    'client.meeting.unsubscribe',
    'Leave a meeting\'s coordination channel. The gateway replies with ws.meeting.meeting.unsubscribed; when this was the user\'s last connection in the meeting their raised hand goes down (ws.meeting.hands.changed).',
    meetingFrame('unsubscribe'),
);

// --- hands ------------------------------------------------------------------

export const clientMeetingHandRaise = decl(
    'client.meeting.hand.raise',
    'Raise your own hand. Any subscribed, signed-in participant. A hand already raised is a no-op; otherwise broadcasts ws.meeting.hands.changed.',
    meetingFrame('hand.raise', {
        displayName: {
            type: 'string',
            description: 'Name shown on your hand when the server\'s auth context carries none; the server prefers its own, trims it and keeps the first 80 characters.',
        },
    }),
);

export const clientMeetingHandLower = decl(
    'client.meeting.hand.lower',
    'Lower your own hand (no userId), or someone else\'s — organizer only when userId names another user (ws.meeting.error FORBIDDEN otherwise). A hand not raised is a no-op; otherwise broadcasts ws.meeting.hands.changed.',
    meetingFrame('hand.lower', {
        userId: { type: 'string', description: 'Whose hand to lower; omit for your own. Naming anyone else is organizer only.' },
    }),
);

export const clientMeetingHandLowerAll = decl(
    'client.meeting.hand.lowerAll',
    'Organizer only. Lower every raised hand. Broadcasts ws.meeting.hands.changed unless no hand was up.',
    meetingFrame('hand.lowerAll'),
    true,
);

// --- breakout rooms ---------------------------------------------------------

export const clientMeetingBreakoutConfigure = decl(
    'client.meeting.breakout.configure',
    'Organizer only. Replace the breakout plan: rooms (all closed), mode and settings; clears the timer, returned list and announcement. Refused with CONFLICT while rooms are open. At most maxRooms rooms (host config, default 50). An empty list ends the session (phase none). Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.configure', {
        rooms: {
            type: 'array',
            description: 'The new rooms in order. Duplicate ids are refused; a user listed in two rooms stays in the first.',
            items: {
                type: 'object',
                description: 'One room draft.',
                properties: {
                    id: roomIdField('Room id to keep or create; omit to have the server mint one.'),
                    name: { type: 'string', description: 'Room name; trimmed and cut to 80 characters. Blank or missing becomes "Room N".' },
                    members: {
                        type: 'array',
                        items: { type: 'string', description: 'A userId placed in this room.' },
                        description: 'userIds placed in this room. Omit to keep the members a room with the same id already had.',
                    },
                },
                required: [],
                additionalProperties: true,
            },
        },
        mode: {
            type: 'string',
            enum: ['assigned', 'self-select'],
            description: 'assigned: the organizer places people and a participant may join only their own room; self-select: anyone may join any open room. Omit to keep the current mode.',
        },
        allowReturnToMain: {
            type: 'boolean',
            description: 'Whether participants may leave their room for the main meeting. Omit to keep the current setting (default true).',
        },
    }, ['rooms']),
    true,
);

export const clientMeetingBreakoutAddRoom = decl(
    'client.meeting.breakout.addRoom',
    'Organizer only. Add one closed room in any phase (open it with client.meeting.breakout.open and its id). CONFLICT at maxRooms (default 50) or on a duplicate id. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.addRoom', {
        id: roomIdField('Room id; omit to have the server mint one.'),
        name: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 80,
            description: 'Room name, 1–80 characters after trimming. Omit or null for the next free "Room N".',
        },
    }),
    true,
);

export const clientMeetingBreakoutRename = decl(
    'client.meeting.breakout.rename',
    'Organizer only. Rename a room in any phase. NOT_FOUND for an unknown room; the same name is a no-op. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.rename', {
        roomId: roomIdField('The room to rename.'),
        name: roomNameField('The new name, 1–80 characters after trimming.'),
    }, ['roomId', 'name']),
    true,
);

export const clientMeetingBreakoutAssign = decl(
    'client.meeting.breakout.assign',
    'Organizer only. Place or unplace people: each entry moves that user to the room (out of any other) or, with null, out of every room. An unknown room id is INVALID_PAYLOAD. Assigned users drop off the returned list. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.assign', {
        assignments: {
            type: 'object',
            description: 'userId → roomId, or null to unassign.',
            properties: {},
            additionalProperties: { type: ['string', 'null'], description: 'Target room id, or null to take the user out of every room.' },
        },
    }, ['assignments']),
    true,
);

export const clientMeetingBreakoutAutoAssign = decl(
    'client.meeting.breakout.autoAssign',
    'Organizer only. Replace every room\'s members by dealing the listed users round-robin across the rooms in order; clears the returned list. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.autoAssign', {
        userIds: {
            type: 'array',
            items: { type: 'string', description: 'A userId to deal into a room.' },
            description: 'Users to spread across the rooms; duplicates and empty strings are dropped. Missing means nobody, which empties every room.',
        },
    }),
    true,
);

export const clientMeetingBreakoutOpen = decl(
    'client.meeting.breakout.open',
    'Organizer only. Open the listed rooms, or all of them. Cancels a closing countdown. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.open', {
        roomIds: roomIdsField('Rooms to open; omit for every room.'),
    }),
    true,
);

export const clientMeetingBreakoutClose = decl(
    'client.meeting.breakout.close',
    'Organizer only. Close the listed rooms at once, or all of them. Closing all while rooms are open starts the host\'s closing grace (breakout.closing true, endsAt the end of the grace) unless immediate is set or a grace is already running. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.close', {
        roomIds: roomIdsField('Rooms to close at once; omit to close every room (subject to the closing grace).'),
        immediate: immediateField(),
    }),
    true,
);

export const clientMeetingBreakoutTimer = decl(
    'client.meeting.breakout.timer',
    'Organizer only. Start a timer that closes every room when it runs out, or clear it with null. A duration needs open rooms (CONFLICT otherwise) and must be above 0 and at most maxTimerMs (host config, default 4 h = 14400000; INVALID_PAYLOAD otherwise). Cancels a closing countdown. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.timer', {
        durationMs: {
            type: ['number', 'null'],
            description: 'Milliseconds from now until the rooms close (greater than 0), or null to clear the timer.',
        },
    }),
    true,
);

export const clientMeetingBreakoutBroadcast = decl(
    'client.meeting.breakout.broadcast',
    'Organizer only. Send an announcement to every room and the main meeting. Stored as breakout.announcement and broadcast as ws.meeting.breakout.changed then ws.meeting.breakout.announcement.',
    meetingFrame('breakout.broadcast', {
        message: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'The announcement, 1–500 characters after trimming (MAX_ANNOUNCEMENT_LENGTH).',
        },
        displayName: {
            type: 'string',
            description: 'Sender name when the server\'s auth context carries none; the server prefers its own, trims it and keeps the first 80 characters.',
        },
    }, ['message']),
    true,
);

export const clientMeetingBreakoutJoin = decl(
    'client.meeting.breakout.join',
    'Move yourself into an open room. Any participant in self-select mode; in assigned mode only your own room (FORBIDDEN otherwise) — organizers may visit any room. NOT_FOUND for an unknown room, CONFLICT when it is closed or the rooms are closing. Rejoining your assigned room after returning to main takes you off the returned list. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.join', {
        roomId: roomIdField('The room to join.'),
    }, ['roomId']),
);

export const clientMeetingBreakoutLeave = decl(
    'client.meeting.breakout.leave',
    'Return from your room to the main meeting. FORBIDDEN when settings.allowReturnToMain is false (organizers exempt). In self-select mode you leave the room; in assigned mode you stay assigned and join the returned list. Not in a room is a no-op. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.leave'),
);

export const clientMeetingBreakoutEnd = decl(
    'client.meeting.breakout.end',
    'Organizer only. End the breakout session: every room closes and everyone returns to the main meeting (rooms are kept as a draft). While rooms are open this starts the host\'s closing grace unless immediate is set or a grace is already running. No session is a no-op. Broadcasts ws.meeting.breakout.changed.',
    meetingFrame('breakout.end', {
        immediate: immediateField(),
    }),
    true,
);

/** Every outbound `meeting` frame, in MEETING_ACTIONS order. */
export const clientMeetingDeclarations: EventDeclaration[] = [
    clientMeetingSubscribe,
    clientMeetingUnsubscribe,
    clientMeetingHandRaise,
    clientMeetingHandLower,
    clientMeetingHandLowerAll,
    clientMeetingBreakoutConfigure,
    clientMeetingBreakoutAddRoom,
    clientMeetingBreakoutRename,
    clientMeetingBreakoutAssign,
    clientMeetingBreakoutAutoAssign,
    clientMeetingBreakoutOpen,
    clientMeetingBreakoutClose,
    clientMeetingBreakoutTimer,
    clientMeetingBreakoutBroadcast,
    clientMeetingBreakoutJoin,
    clientMeetingBreakoutLeave,
    clientMeetingBreakoutEnd,
];
