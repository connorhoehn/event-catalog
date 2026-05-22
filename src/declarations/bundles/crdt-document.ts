// src/declarations/bundles/crdt-document.ts
//
// "crdt-document" FeatureBundle — collaborative document editing via Y.js / CRDT.
//
// Y.js handles conflict resolution internally; these events are coordination
// frames exchanged over the WebSocket signal channel.
// Event names match the canonical ws.crdt.* declarations in gateway-signal.ts.
//
// Note: ws.crdt.sync-request and ws.crdt.sync-response are not declared yet.
// ws.crdt.snapshot serves as the sync handshake entry point.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'crdt-document',
  version: '1.0.0',
  transport: 'signal',
  description: 'Collaborative document editing via Y.js/CRDT — subscribe, snapshot, incremental updates, and document replacement over WebSocket.',
  events: [
    { name: 'ws.crdt.subscribed',      required: true  },
    { name: 'ws.crdt.unsubscribed',    required: true  },
    { name: 'ws.crdt.snapshot',        required: true  },
    { name: 'ws.crdt.update',          required: true  },
    { name: 'ws.crdt.doc-replaced',    required: true  },
    // TODO: ws.crdt.sync-request not yet declared in gateway-signal.ts
    // { name: 'ws.crdt.sync-request',  required: false },
    // TODO: ws.crdt.sync-response not yet declared in gateway-signal.ts
    // { name: 'ws.crdt.sync-response', required: false },
    { name: 'ws.error',                required: false },
  ],
};

export const crdtDocumentBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
