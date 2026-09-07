// src/declarations/bundles/activity.ts
//
// "activity" FeatureBundle — activity feed: live updates via WS signal +
// durable replay via MQ ACTIVITY_RECORDED queue.
//
// Signal events match ws.activity.* declarations in gateway-signal.ts.
// All declared ws.activity.* events are transport: 'signal'.
//
// The durable side IS now declared: `activity.recorded` (transport 'both',
// gateway-durable.ts, ACTIVITY_RECORDED queue). It is deliberately NOT a
// member of this bundle — adding it would change the bundle fingerprint and
// break every CRD pinned to activity@1.0.0, so it belongs in an
// activity@2.0.0 alongside the other ws.activity.* gaps. Until an operator
// asks for that bump, this bundle is the signal surface only.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'activity',
  version: '1.0.0',
  transport: 'signal',
  description: 'Activity feed — live activity events via WebSocket signal. Durable replay rides the separately-declared `activity.recorded` event (ACTIVITY_RECORDED queue), which is not a member of this bundle.',
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
