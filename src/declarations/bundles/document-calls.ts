// src/declarations/bundles/document-calls.ts
//
// "document-calls" FeatureBundle (2026-09-24) — a call that belongs to a
// document review: live meta (title, review documents, presenter, per-person
// ring state), per-target ring expiry and the in-call roster frames.
//
// Separate from video-hangout on purpose: that bundle's fingerprint is pinned
// by adopters, and a gateway without a document-call meta store sends none of
// these. Adopting this bundle means adopting video-hangout too.
//
// Source: realtime-modules src/call/CallService.ts (producer: the gateway's
// `call` service) and src/client/video/useDocumentCall.ts (client frames).

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'document-calls',
  version: '1.0.0',
  transport: 'signal',
  description:
    'Document-review calls — live call meta (title, review documents, presenter, ring state per '
    + 'person), per-person ring expiry, and the in-call participant roster. Builds on video-hangout.',
  events: [
    { name: 'ws.call.call-meta',          required: true  },
    { name: 'ws.call.invite-expired',     required: true  },
    { name: 'ws.call.participant-state',  required: true  },
    { name: 'ws.call.user-status',        required: true  },
    { name: 'client.call.meta',           required: true  },
    { name: 'client.call.set-documents',  required: true  },
    { name: 'client.call.present',        required: true  },
    { name: 'client.call.set-title',      required: false },
  ],
};

export const documentCallsBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
