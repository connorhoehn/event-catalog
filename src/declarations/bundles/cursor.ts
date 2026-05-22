// src/declarations/bundles/cursor.ts
//
// "cursor" FeatureBundle — collaborative cursor presence via WebSocket.
//
// Event names match the canonical ws.cursor.* declarations in
// src/declarations/gateway-signal.ts.
//
// Note: ws.cursor.clear and ws.cursor.batch do not exist in the catalog yet.
// They are marked required: false with TODO comments below.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'cursor',
  version: '1.0.0',
  transport: 'signal',
  description: 'Collaborative cursor presence — track, broadcast, and remove cursor positions via WebSocket.',
  events: [
    { name: 'ws.cursor.subscribed',    required: true  },
    { name: 'ws.cursor.unsubscribed',  required: true  },
    { name: 'ws.cursor.update',        required: true  },
    { name: 'ws.cursor.remove',        required: true  },
    { name: 'ws.cursor.cursors',       required: true  },
    { name: 'ws.cursor.modes',         required: true  },
    // TODO: ws.cursor.clear not yet declared in gateway-signal.ts
    // { name: 'ws.cursor.clear',      required: false },
    // TODO: ws.cursor.batch not yet declared in gateway-signal.ts
    // { name: 'ws.cursor.batch',      required: false },
    { name: 'ws.error',                required: false },
  ],
};

export const cursorBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
