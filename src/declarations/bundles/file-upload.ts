// src/declarations/bundles/file-upload.ts
//
// "file-upload" FeatureBundle — file upload lifecycle.
//
// Transport is 'signal': presigned URL issuance acknowledgement and all
// upload progress / scan results are delivered via WebSocket push frames.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'file-upload',
  version: '1.0.0',
  transport: 'signal',
  description: 'File upload lifecycle — presigned URL flow (REST) with upload progress and scan-result delivery via WebSocket.',
  events: [
    { name: 'ws.upload.requested',        required: true  },
    { name: 'ws.upload.url-issued',       required: true  },
    { name: 'ws.upload.completed',        required: true  },
    { name: 'ws.upload.failed',           required: true  },
    { name: 'ws.upload.scanned',          required: true  },
    // Security enforcement outcomes
    { name: 'ws.upload.scan-quarantined', required: true  },
    { name: 'ws.upload.url-revoked',      required: true  },
    { name: 'ws.error',                   required: false },
  ],
};

export const fileUploadBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
