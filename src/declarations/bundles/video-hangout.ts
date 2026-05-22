// src/declarations/bundles/video-hangout.ts
//
// "video-hangout" FeatureBundle — LVS video session lifecycle via WebSocket.
//
// These events coordinate session lifecycle (join, leave, end) and participant
// media state (video on/off). Actual media streaming uses WHIP/WHEP through
// LVS directly — not these WS events.
//
// The ws.call.* events in gateway-signal.ts are the closest existing names for
// session lifecycle. ws.call.video-on / ws.call.video-off do not exist yet.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'video-hangout',
  version: '1.0.0',
  transport: 'signal',
  description: 'LVS video session lifecycle — invite, accept, decline, cancel, and end video calls over WebSocket. Media streaming is WHIP/WHEP via LVS.',
  events: [
    // Session lifecycle — mapped to ws.call.* (closest existing names)
    { name: 'ws.call.invite',      required: true  },   // session.created / session.invited
    { name: 'ws.call.accepted',    required: true  },   // session.joined
    { name: 'ws.call.declined',    required: true  },   // session.declined
    { name: 'ws.call.cancelled',   required: true  },   // session.cancelled
    { name: 'ws.call.ended',       required: true  },   // session.ended / session.left
    // TODO: ws.call.video-on not yet declared in gateway-signal.ts (participant.video-on)
    // { name: 'ws.call.video-on',   required: false },
    // TODO: ws.call.video-off not yet declared in gateway-signal.ts (participant.video-off)
    // { name: 'ws.call.video-off',  required: false },
    { name: 'ws.error',            required: false },
  ],
};

export const videoHangoutBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
