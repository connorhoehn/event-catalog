// src/declarations/bundles/activity.ts
//
// "activity" FeatureBundle — activity feed: live updates via WS signal +
// durable replay via MQ ACTIVITY_RECORDED queue.
//
// Signal events match ws.activity.* declarations in gateway-signal.ts.
// All declared ws.activity.* events are transport: 'signal'; the MQ durable
// relay (ACTIVITY_RECORDED queue) is an infrastructure concern not reflected
// in per-event transport declarations yet. Bundle transport is 'signal'.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'activity',
  version: '1.0.0',
  transport: 'signal',
  description: 'Activity feed — live activity events via WebSocket signal. Durable replay is MQ-backed (ACTIVITY_RECORDED queue) and is an infrastructure concern separate from these signal declarations.',
  events: [
    { name: 'ws.activity.subscribed',    required: true  },
    { name: 'ws.activity.unsubscribed',  required: true  },
    { name: 'ws.activity.published',     required: true  },
    { name: 'ws.activity.history',       required: true  },
    { name: 'ws.activity.event',         required: true  },
    { name: 'ws.error',                  required: false },
  ],
};

export const activityBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
