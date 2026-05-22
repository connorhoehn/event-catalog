// src/declarations/bundles/reactions.ts
//
// "reactions" FeatureBundle — emoji reactions via WebSocket.
//
// Event names match the canonical ws.reaction.* declarations in
// src/declarations/gateway-signal.ts.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'reactions',
  version: '1.0.0',
  transport: 'signal',
  description: 'Emoji reactions — subscribe, send, and receive reaction events via WebSocket.',
  events: [
    { name: 'ws.reaction.subscribed',  required: true  },
    { name: 'ws.reaction.sent',        required: true  },
    { name: 'ws.reaction.received',    required: true  },
    { name: 'ws.reaction.removed',     required: true  },
    { name: 'ws.reaction.list',        required: true  },
    { name: 'ws.error',                required: false },
  ],
};

export const reactionsBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
