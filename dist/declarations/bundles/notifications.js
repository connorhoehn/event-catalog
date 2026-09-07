"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'notifications',
    version: '1.0.0',
    transport: 'signal',
    description: 'Notification centre — new-notification push, read acknowledgement, and bulk read/dismiss '
        + 'updates over WebSocket. Backs the useNotifications hook and the NotificationCenter composite.',
    events: [
        { name: 'ws.notification.new', required: true },
        { name: 'ws.notification.read', required: true },
        { name: 'ws.notification.bulk-update', required: true },
        // Generic error frame is optional — shared across all bundles.
        { name: 'ws.error', required: false },
    ],
};
exports.notificationsBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=notifications.js.map