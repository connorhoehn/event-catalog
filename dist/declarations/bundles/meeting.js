"use strict";
// src/declarations/bundles/meeting.ts
//
// "meeting" FeatureBundle (2026-10-16) — raised hands and breakout rooms for
// a call that is already running on LVS. Coordination state only: a breakout
// room is an ordinary hangout lobby (`<meetingId>~breakout~<roomId>`), and
// the client moves its own media there.
//
// Required: subscribing, the snapshot and both change frames, the error
// frame, and the hand verbs every participant sends. Optional: the
// organizer's breakout controls and the participant's join/leave, which a
// hands-only adopter never sends, plus the announcement (also carried inside
// breakout.changed).
//
// Source: realtime-modules src/meeting/types.ts + MeetingService.ts
// (producer: the gateway's `meeting` service) and
// src/client/meeting/useMeeting.ts (client frames).
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'meeting',
    version: '1.0.0',
    transport: 'signal',
    description: 'Meeting rooms — a raised-hand queue and breakout rooms (configure, assign, open/close, timer, '
        + 'announcements, join/return) for a call already running on LVS. Builds on video-hangout.',
    events: [
        { name: 'ws.meeting.meeting.snapshot', required: true },
        { name: 'ws.meeting.hands.changed', required: true },
        { name: 'ws.meeting.breakout.changed', required: true },
        { name: 'ws.meeting.breakout.announcement', required: false },
        { name: 'ws.meeting.meeting.unsubscribed', required: true },
        { name: 'ws.meeting.error', required: true },
        { name: 'client.meeting.subscribe', required: true },
        { name: 'client.meeting.unsubscribe', required: true },
        { name: 'client.meeting.hand.raise', required: true },
        { name: 'client.meeting.hand.lower', required: true },
        { name: 'client.meeting.hand.lowerAll', required: false },
        { name: 'client.meeting.breakout.configure', required: false },
        { name: 'client.meeting.breakout.addRoom', required: false },
        { name: 'client.meeting.breakout.rename', required: false },
        { name: 'client.meeting.breakout.assign', required: false },
        { name: 'client.meeting.breakout.autoAssign', required: false },
        { name: 'client.meeting.breakout.open', required: false },
        { name: 'client.meeting.breakout.close', required: false },
        { name: 'client.meeting.breakout.timer', required: false },
        { name: 'client.meeting.breakout.broadcast', required: false },
        { name: 'client.meeting.breakout.join', required: false },
        { name: 'client.meeting.breakout.leave', required: false },
        { name: 'client.meeting.breakout.end', required: false },
    ],
};
exports.meetingBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=meeting.js.map