// src/declarations/bundles/sfu-control-plane.ts
//
// "sfu-control-plane" FeatureBundle — everything on the SFU's `stream-events`
// Redis hub.
//
// Two families share this bus and share consumers, so they share a bundle:
//   * control-plane state   (src/declarations/sfu/control-plane.ts, 7 events)
//   * recording compose job (src/declarations/sfu/recording-compose.ts, 5)
//
// They are not split because the recordings dashboard SSE stream
// `GET /api/recordings/events` forwards every hub message whose type starts
// with `recording.` — that is `sfu.recording.state.changed` from the
// control-plane family PLUS the whole compose family. A consumer of one is a
// consumer of the other; two bundles here would be a boundary nobody
// subscribes along.
//
// The compose family is marked optional: composition is a background ffmpeg
// job that a deployment can run with `composePerPeer` off and never see.
//
// Transport: 'signal' — every member rides `streamEventsHub.emit`.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'sfu-control-plane',
  version: '1.0.0',
  transport: 'signal',
  description:
    'SFU control-plane signal surface — the `stream-events` Redis hub: producer and recording '
    + 'state changes, participant/member events, and the optional background recording-compose '
    + 'job lifecycle. Pair with sfu-webhooks for the durable half of the sfu.* namespace.',
  events: [
    // Control plane — channel/participant state
    { name: 'sfu.producer.added',                 required: true  },
    { name: 'sfu.producer.removed',               required: true  },
    { name: 'sfu.producer.state-changed',         required: true  },
    { name: 'sfu.recording.state.changed',        required: true  },
    { name: 'sfu.participant.disconnected',       required: true  },
    { name: 'sfu.member.owner.changed',           required: true  },
    { name: 'sfu.chat.event',                     required: true  },
    // Recording compose job — optional, ffmpeg composition may be disabled
    { name: 'sfu.recording.compose.queued',       required: false },
    { name: 'sfu.recording.compose.started',      required: false },
    { name: 'sfu.recording.compose.progress',     required: false },
    { name: 'sfu.recording.compose.failed',       required: false },
    { name: 'sfu.recording.compose.completed',    required: false },
  ],
};

export const sfuControlPlaneBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
