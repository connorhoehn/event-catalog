// src/declarations/bundles/reactions.ts
//
// "reactions" FeatureBundle — emoji reactions via WebSocket.
//
// Event names match the canonical ws.reaction.* declarations in
// src/declarations/gateway-signal.ts.
//
// Note: ws.reaction.list does not exist in the catalog; closest match is
// ws.reaction.received (inbound delivery). Marked optional with TODO.

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
    // TODO: ws.reaction.removed not yet declared in gateway-signal.ts
    // (design doc calls this "reaction removed"; ws.reaction.received is closest)
    // { name: 'ws.reaction.removed',  required: false },
    // TODO: ws.reaction.list not yet declared in gateway-signal.ts
    // { name: 'ws.reaction.list',     required: false },
    { name: 'ws.error',                required: false },
  ],
};

export const reactionsBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
