// src/declarations/bundles/presence.ts
//
// "presence" FeatureBundle — client presence tracking via WebSocket.
//
// Event names match the canonical ws.presence.* declarations in
// src/declarations/gateway-signal.ts.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'presence',
  version: '1.0.0',
  transport: 'signal',
  description: 'Client presence tracking — set, broadcast, subscribe/unsubscribe, and offline eviction.',
  events: [
    { name: 'ws.presence.set',           required: true  },
    { name: 'ws.presence.update',        required: true  },
    { name: 'ws.presence.subscribed',    required: true  },
    { name: 'ws.presence.unsubscribed',  required: true  },
    { name: 'ws.presence.data',          required: true  },
    { name: 'ws.presence.offline',       required: true  },
    // Generic error frame is optional — shared across all bundles.
    { name: 'ws.error',                  required: false },
  ],
};

export const presenceBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
