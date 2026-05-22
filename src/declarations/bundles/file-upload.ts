// src/declarations/bundles/file-upload.ts
//
// "file-upload" FeatureBundle — file upload lifecycle.
//
// Transport is 'both': presigned URL issuance is REST (durable side),
// upload progress and scan results are delivered via WebSocket (signal side).
//
// No ws.upload.* events are declared in the catalog yet — all event refs are
// marked required: false with TODO comments so the bundle compiles cleanly.
// Declare the events in gateway-signal.ts to promote them to required: true.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'file-upload',
  version: '1.0.0',
  // Transport intent is 'both' but no events are registered yet so transport
  // coherence cannot be checked. Set to 'signal' as the primary delivery
  // channel until ws.upload.* events are declared.
  transport: 'signal',
  description: 'File upload lifecycle — presigned URL flow (REST) with upload progress and scan-result delivery via WebSocket.',
  events: [
    // TODO: ws.upload.requested not yet declared in gateway-signal.ts
    // { name: 'ws.upload.requested',    required: false },
    // TODO: ws.upload.url-issued not yet declared in gateway-signal.ts
    // { name: 'ws.upload.url-issued',   required: false },
    // TODO: ws.upload.completed not yet declared in gateway-signal.ts
    // { name: 'ws.upload.completed',    required: false },
    // TODO: ws.upload.failed not yet declared in gateway-signal.ts
    // { name: 'ws.upload.failed',       required: false },
    // TODO: ws.upload.scanned not yet declared in gateway-signal.ts
    // { name: 'ws.upload.scanned',      required: false },
    { name: 'ws.error',                  required: false },
  ],
};

export const fileUploadBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
