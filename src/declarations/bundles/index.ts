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
export { agenticPipelineBundle } from './agentic-pipeline.js';
export { crdtDocumentBundle } from './crdt-document.js';
export { videoHangoutBundle } from './video-hangout.js';
export { fileUploadBundle } from './file-upload.js';

import { registerFeatureBundle } from '../../bundles/FeatureBundle.js';
import { chatBundle } from './chat.js';
import { presenceBundle } from './presence.js';
import { cursorBundle } from './cursor.js';
import { reactionsBundle } from './reactions.js';
import { activityBundle } from './activity.js';
import { agenticPipelineBundle } from './agentic-pipeline.js';
import { crdtDocumentBundle } from './crdt-document.js';
import { videoHangoutBundle } from './video-hangout.js';
import { fileUploadBundle } from './file-upload.js';

/** All v1 bundle definitions, in declaration order. */
export const allBundles = [
  chatBundle,
  presenceBundle,
  cursorBundle,
  reactionsBundle,
  activityBundle,
  agenticPipelineBundle,
  crdtDocumentBundle,
  videoHangoutBundle,
  fileUploadBundle,
] as const;

// Register each bundle in the module-level singleton at import time.
// Idempotent: re-importing this module after the first load is a no-op
// because registerFeatureBundle() silently ignores identical re-registrations.
for (const bundle of allBundles) {
  registerFeatureBundle(bundle);
}
