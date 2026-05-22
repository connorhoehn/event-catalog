// src/declarations/bundles/chat.ts
//
// "chat" FeatureBundle — real-time chat messaging via WebSocket.
//
// Event names match the canonical ws.chat.* declarations in
// src/declarations/gateway-signal.ts.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'chat',
  version: '1.0.0',
  transport: 'signal',
  description: 'Real-time chat messaging via WebSocket.',
  events: [
    { name: 'ws.chat.joined',   required: true  },
    { name: 'ws.chat.left',     required: true  },
    { name: 'ws.chat.message',  required: true  },
    { name: 'ws.chat.sent',     required: true  },
    { name: 'ws.chat.history',  required: true  },
    // Generic error frame is optional — shared across all bundles.
    { name: 'ws.error',         required: false },
  ],
};

export const chatBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
