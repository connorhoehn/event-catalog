// src/declarations/bundles/index.ts
//
// Aggregate re-export for all declared FeatureBundles.
// Importing this module at boot time registers the bundles in the
// module-level singleton via registerFeatureBundle().

export { chatBundle } from './chat.js';
export { presenceBundle } from './presence.js';
export { cursorBundle } from './cursor.js';
export { reactionsBundle } from './reactions.js';
export { activityBundle } from './activity.js';
// Deprecated: use agenticPipelineSignalBundle + agenticPipelineDurableBundle instead.
export { agenticPipelineBundle } from './agentic-pipeline.js';
export { agenticPipelineSignalBundle } from './agentic-pipeline-signal.js';
export { agenticPipelineDurableBundle } from './agentic-pipeline-durable.js';
export { crdtDocumentBundle, crdtDocumentDurabilityBundle } from './crdt-document.js';
export { videoHangoutBundle } from './video-hangout.js';
export { documentCallsBundle, documentCallsModerationBundle } from './document-calls.js';
export { meetingBundle } from './meeting.js';
export { fileUploadBundle } from './file-upload.js';
export { notificationsBundle } from './notifications.js';
export { orgiqNewsroomBundle } from './orgiq-newsroom.js';
export { agUiStreamBundle } from './ag-ui-stream.js';
export { callCaptionsBundle } from './call-captions.js';
export { sfuWebhooksBundle } from './sfu-webhooks.js';
export { sfuControlPlaneBundle } from './sfu-control-plane.js';
export { sfuChatBundle } from './sfu-chat.js';
export { gatewaySessionBundle } from './gateway-session.js';

import { registerFeatureBundle } from '../../bundles/FeatureBundle.js';
import { chatBundle } from './chat.js';
import { presenceBundle } from './presence.js';
import { cursorBundle } from './cursor.js';
import { reactionsBundle } from './reactions.js';
import { activityBundle } from './activity.js';
import { agenticPipelineBundle } from './agentic-pipeline.js';
import { agenticPipelineSignalBundle } from './agentic-pipeline-signal.js';
import { agenticPipelineDurableBundle } from './agentic-pipeline-durable.js';
import { crdtDocumentBundle, crdtDocumentDurabilityBundle } from './crdt-document.js';
import { videoHangoutBundle } from './video-hangout.js';
import { documentCallsBundle, documentCallsModerationBundle } from './document-calls.js';
import { meetingBundle } from './meeting.js';
import { fileUploadBundle } from './file-upload.js';
import { notificationsBundle } from './notifications.js';
import { gatewaySessionBundle } from './gateway-session.js';
import { orgiqNewsroomBundle } from './orgiq-newsroom.js';
import { agUiStreamBundle } from './ag-ui-stream.js';
import { callCaptionsBundle } from './call-captions.js';
import { sfuWebhooksBundle } from './sfu-webhooks.js';
import { sfuControlPlaneBundle } from './sfu-control-plane.js';
import { sfuChatBundle } from './sfu-chat.js';

/** All v1 bundle definitions, in declaration order. */
export const allBundles = [
  chatBundle,
  presenceBundle,
  cursorBundle,
  reactionsBundle,
  activityBundle,
  agenticPipelineBundle,        // deprecated — kept for fingerprint backward compat
  agenticPipelineSignalBundle,
  agenticPipelineDurableBundle,
  crdtDocumentBundle,
  crdtDocumentDurabilityBundle,
  videoHangoutBundle,
  fileUploadBundle,
  notificationsBundle,
  gatewaySessionBundle,
  orgiqNewsroomBundle,
  agUiStreamBundle,
  callCaptionsBundle,
  sfuWebhooksBundle,
  sfuControlPlaneBundle,
  sfuChatBundle,
  documentCallsBundle,
  documentCallsModerationBundle,
  meetingBundle,
] as const;

// Register each bundle in the module-level singleton at import time.
// Idempotent: re-importing this module after the first load is a no-op
// because registerFeatureBundle() silently ignores identical re-registrations.
for (const bundle of allBundles) {
  registerFeatureBundle(bundle);
}
