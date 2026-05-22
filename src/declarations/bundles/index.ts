// src/declarations/bundles/index.ts
//
// Aggregate re-export for all declared FeatureBundles.
// Importing this module at boot time registers the bundles in the
// module-level singleton via registerFeatureBundle().

export { chatBundle } from './chat.js';
export { presenceBundle } from './presence.js';

import { registerFeatureBundle } from '../../bundles/FeatureBundle.js';
import { chatBundle } from './chat.js';
import { presenceBundle } from './presence.js';

/** All v1 bundle definitions, in declaration order. */
export const allBundles = [chatBundle, presenceBundle] as const;

// Register each bundle in the module-level singleton at import time.
// Idempotent: re-importing this module after the first load is a no-op
// because registerFeatureBundle() silently ignores identical re-registrations.
for (const bundle of allBundles) {
  registerFeatureBundle(bundle);
}
