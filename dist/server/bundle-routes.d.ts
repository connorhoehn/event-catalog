import type { FeatureBundleRegistry } from '../bundles/FeatureBundle.js';
import type { IRegistry } from '../registry/types.js';
export interface BundleRoutesDeps {
    /** Isolated FeatureBundleRegistry instance (DI-friendly). */
    bundleRegistry: FeatureBundleRegistry;
    /** Event registry for validate endpoint transport/version checks. */
    registry: IRegistry;
}
export declare function createBundleRoutes(deps: BundleRoutesDeps): Router;
//# sourceMappingURL=bundle-routes.d.ts.map