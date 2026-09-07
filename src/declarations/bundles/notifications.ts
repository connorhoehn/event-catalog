// src/declarations/bundles/notifications.ts
//
// "notifications" FeatureBundle — the NotificationCenter realtime surface.
//
// Backs the `useNotifications` hook in realtime-modules and the
// NotificationCenter composite in ui-components. Small, but a real
// adoption unit: a deployment either renders a notification centre or it
// does not, and these are the three frames it needs.
//
// Event names match the canonical ws.notification.* declarations in
// src/declarations/gateway-signal.ts.
//
// Transport: 'signal'.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'notifications',
  version: '1.0.0',
  transport: 'signal',
  description:
    'Notification centre — new-notification push, read acknowledgement, and bulk read/dismiss '
    + 'updates over WebSocket. Backs the useNotifications hook and the NotificationCenter composite.',
  events: [
    { name: 'ws.notification.new',          required: true  },
    { name: 'ws.notification.read',         required: true  },
    { name: 'ws.notification.bulk-update',  required: true  },
    // Generic error frame is optional — shared across all bundles.
    { name: 'ws.error',                     required: false },
  ],
};

export const notificationsBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
