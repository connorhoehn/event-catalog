// src/declarations/gateway-signal/meeting.ts
//
// INBOUND (gateway → client) frames of the `meeting` service (2026-10-16):
// raised hands and breakout rooms. Source: realtime-modules
// src/meeting/types.ts `MeetingServerFrame` and src/meeting/MeetingService.ts.
//
// Envelope: `{ type: 'meeting', action, meetingId, data, timestamp }`, except
// the error frame, which carries `error` instead of `data` and a nullable
// meetingId. Event names are `ws.meeting.<action>` with the wire action
// verbatim, so `meeting.snapshot` is ws.meeting.meeting.snapshot.
//
// Every change frame carries the FULL slice it changed (all hands, or the
// whole breakout state), never a diff, plus the meeting `version`, which is
// bumped on every change so a client can drop an out-of-order frame.
//
// Nested state objects are open (additionalProperties: true): the producer
// has already grown `breakout.closing` additively (0.124.0) and readers must
// tolerate the next field.
//
// 1.1.0 additions (realtime-modules 0.130–0.132), all additive so the frames
// stay shared with meeting@1.0.0: `breakout.announcements` (the history) and
// the RATE_LIMITED error code.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

const TAGS = [...BASE_TAGS, 'meeting'];

/** MeetingErrorCode, in source order. */
export const MEETING_ERROR_CODES = [
    'INVALID_ACTION',
    'INVALID_PAYLOAD',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_SUBSCRIBED',
    'NOT_FOUND',
    'CONFLICT',
    'RATE_LIMITED',
] as const;

/** How many announcements BreakoutState.announcements keeps (realtime-modules MAX_ANNOUNCEMENT_HISTORY, 0.130.0). */
export const MAX_ANNOUNCEMENT_HISTORY = 20;

const meetingIdField = (): Record<string, unknown> => ({ type: 'string', description: 'The meeting this frame belongs to; also the main call\'s LVS lobby name.' });
const versionField = (): Record<string, unknown> => ({ type: 'integer', minimum: 0, description: 'Meeting state version, bumped on every change. Drop a frame whose version is not newer than the one you hold.' });

function raisedHandSchema(): Record<string, unknown> {
    return {
        type: 'object',
        description: 'One raised hand.',
        properties: {
            userId: { type: 'string', description: 'The user whose hand is up.' },
            displayName: { type: 'string', description: 'Name shown on the hand (auth context first, else the name the client sent, else the userId).' },
            raisedAt: { type: 'string', description: 'ISO-8601 time the hand went up. The queue is ordered by it, oldest first.' },
        },
        required: ['userId', 'displayName', 'raisedAt'],
        additionalProperties: true,
    };
}

function handsSchema(): Record<string, unknown> {
    return { type: 'array', items: raisedHandSchema(), description: 'Every raised hand, oldest first: the whole queue, not a diff.' };
}

function announcementSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        description,
        properties: {
            message: { type: 'string', description: 'The announcement text, 1–500 characters.' },
            fromUserId: { type: 'string', description: 'userId of the organizer who sent it.' },
            fromDisplayName: { type: 'string', description: 'Display name of the organizer who sent it.' },
            at: { type: 'string', description: 'ISO-8601 time the announcement was sent.' },
        },
        required: ['message', 'fromUserId', 'fromDisplayName', 'at'],
        additionalProperties: true,
    };
}

function breakoutStateSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        description,
        properties: {
            phase: { type: 'string', enum: ['none', 'draft', 'open'], description: 'none: no breakout session; draft: rooms exist, nobody sent yet; open: at least one room is open.' },
            mode: { type: 'string', enum: ['assigned', 'self-select'], description: 'assigned: the organizer places people; self-select: participants pick any open room.' },
            rooms: {
                type: 'array',
                description: 'Every breakout room in order.',
                items: {
                    type: 'object',
                    description: 'One breakout room.',
                    properties: {
                        id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Room id; part of the room\'s LVS lobby name (<meetingId>~breakout~<id>).' },
                        name: { type: 'string', description: 'Room name, 1–80 characters.' },
                        state: { type: 'string', enum: ['open', 'closed'], description: 'Whether the room is open for joining.' },
                        members: {
                            type: 'array',
                            items: { type: 'string', description: 'A userId that belongs in this room.' },
                            description: 'userIds that belong in this room. A user is in at most one room.',
                        },
                    },
                    required: ['id', 'name', 'state', 'members'],
                    additionalProperties: true,
                },
            },
            returned: {
                type: 'array',
                items: { type: 'string', description: 'A userId back in the main meeting.' },
                description: 'userIds who left their room for the main meeting while rooms are open (assigned mode keeps their assignment).',
            },
            endsAt: { type: ['string', 'null'], description: 'ISO-8601 time every room closes (timer or closing grace), or null for no timer.' },
            closing: { type: 'boolean', description: 'True during the closing grace: endsAt is the end of the grace and joins are refused. Absent from older servers; read absent as false.' },
            announcement: {
                ...announcementSchema('The latest organizer announcement, or null.'),
                type: ['object', 'null'],
            },
            announcements: {
                type: 'array',
                maxItems: MAX_ANNOUNCEMENT_HISTORY,
                items: announcementSchema('One past announcement.'),
                description: `The last ${MAX_ANNOUNCEMENT_HISTORY} announcements, oldest first, kept across breakout sessions like chat (configure clears \`announcement\` but not this). \`announcement\` stays the latest. Absent from servers before realtime-modules 0.130.0; read absent as [].`,
            },
            settings: {
                type: 'object',
                description: 'Breakout session settings.',
                properties: {
                    allowReturnToMain: { type: 'boolean', description: 'Whether participants may leave their room for the main meeting. Default true.' },
                },
                required: ['allowReturnToMain'],
                additionalProperties: true,
            },
        },
        required: ['phase', 'mode', 'rooms', 'returned', 'endsAt', 'announcement', 'settings'],
        additionalProperties: true,
    };
}

function meetingFrameSchema(action: string, data: Record<string, unknown>): Record<string, unknown> {
    return wsSchema('meeting', {
        action: { type: 'string', const: action },
        meetingId: meetingIdField(),
        data,
    }, ['action', 'meetingId', 'data', 'timestamp']);
}

function decl(name: string, description: string, schema: Record<string, unknown>): EventDeclaration {
    return { namespace: 'ws', name, transport: 'signal', producer: PRODUCER, description, tags: TAGS, schema };
}

export const wsMeetingSnapshot = decl(
    'ws.meeting.meeting.snapshot',
    'The whole meeting state, sent to the subscribing connection only in reply to client.meeting.subscribe. `you` says who the server thinks you are and whether you are an organizer. Overwrite local state with it.',
    meetingFrameSchema('meeting.snapshot', {
        type: 'object',
        description: 'MeetingState plus `you`.',
        properties: {
            meetingId: meetingIdField(),
            createdBy: { type: ['string', 'null'], description: 'userId of the first subscriber, the default organizer; null when that subscriber was anonymous.' },
            version: versionField(),
            hands: handsSchema(),
            breakout: breakoutStateSchema('The whole breakout session state.'),
            updatedAt: { type: 'string', description: 'ISO-8601 time of the last change to the meeting.' },
            you: {
                type: 'object',
                description: 'The receiving connection as the server sees it.',
                properties: {
                    userId: { type: ['string', 'null'], description: 'Your userId from the connection\'s auth context, or null when anonymous.' },
                    organizer: { type: 'boolean', description: 'Whether you may send the organizer-only verbs.' },
                },
                required: ['userId', 'organizer'],
                additionalProperties: true,
            },
        },
        required: ['meetingId', 'createdBy', 'version', 'hands', 'breakout', 'updatedAt', 'you'],
        additionalProperties: true,
    }),
);

export const wsMeetingHandsChanged = decl(
    'ws.meeting.hands.changed',
    'The raised-hand queue changed (raise, lower, lower all, or a user\'s last connection leaving). Broadcast to every subscriber; carries the whole queue.',
    meetingFrameSchema('hands.changed', {
        type: 'object',
        description: 'The new version and the whole hand queue.',
        properties: { version: versionField(), hands: handsSchema() },
        required: ['version', 'hands'],
        additionalProperties: true,
    }),
);

export const wsMeetingBreakoutChanged = decl(
    'ws.meeting.breakout.changed',
    'The breakout session changed (any breakout verb, the timer or closing grace running out, or a write from another replica). Broadcast to every subscriber; carries the whole breakout state.',
    meetingFrameSchema('breakout.changed', {
        type: 'object',
        description: 'The new version and the whole breakout state.',
        properties: { version: versionField(), breakout: breakoutStateSchema('The whole breakout session state after the change.') },
        required: ['version', 'breakout'],
        additionalProperties: true,
    }),
);

export const wsMeetingBreakoutAnnouncement = decl(
    'ws.meeting.breakout.announcement',
    'An organizer broadcast an announcement to every room (client.meeting.breakout.broadcast). Broadcast to every subscriber right after the ws.meeting.breakout.changed that stores it.',
    meetingFrameSchema('breakout.announcement', announcementSchema('The announcement (BreakoutAnnouncement).')),
);

export const wsMeetingUnsubscribed = decl(
    'ws.meeting.meeting.unsubscribed',
    'Acknowledges client.meeting.unsubscribe, to the sending connection only. Clear local meeting state.',
    meetingFrameSchema('meeting.unsubscribed', {
        type: 'object',
        description: 'Always an empty object.',
        properties: {},
        required: [],
        additionalProperties: false,
    }),
);

export const wsMeetingError = decl(
    'ws.meeting.error',
    'A meeting verb was refused. Sent to the sending connection only; nothing changed. INVALID_ACTION unknown verb; INVALID_PAYLOAD bad meetingId or field; UNAUTHENTICATED no signed-in user; FORBIDDEN channel guard refused, organizer-only verb, wrong room or return to main not allowed; NOT_SUBSCRIBED subscribe first; NOT_FOUND unknown meeting or room; CONFLICT state does not allow it (or the write lost a race); RATE_LIMITED too many writes from this person in this meeting (a token bucket per person per meeting, default burst 20 refilled at 5 per second, host config `rateLimit`; subscribe and unsubscribe are never limited), so wait and retry.',
    wsSchema('meeting', {
        action: { type: 'string', const: 'error' },
        meetingId: { type: ['string', 'null'], description: 'The meeting the refused frame named, or null when it named none.' },
        error: {
            type: 'object',
            description: 'Why the verb was refused.',
            properties: {
                code: { type: 'string', enum: [...MEETING_ERROR_CODES], description: 'MeetingErrorCode — machine-readable refusal reason.' },
                message: { type: 'string', description: 'Human-readable reason, safe to show.' },
                requestAction: { type: 'string', description: 'The action of the refused client frame, verbatim (may be an unknown verb).' },
            },
            required: ['code', 'message', 'requestAction'],
            additionalProperties: true,
        },
    }, ['action', 'meetingId', 'error', 'timestamp']),
);

/** Every inbound `meeting` frame, in MeetingServerFrame order. */
export const wsMeetingDeclarations: EventDeclaration[] = [
    wsMeetingSnapshot,
    wsMeetingHandsChanged,
    wsMeetingBreakoutChanged,
    wsMeetingBreakoutAnnouncement,
    wsMeetingUnsubscribed,
    wsMeetingError,
];
