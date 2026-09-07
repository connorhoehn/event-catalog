import { type HttpRouter } from './http-router.js';
import type { FeatureBundleRegistry } from '../bundles/FeatureBundle.js';
import type { IRegistry } from '../registry/types.js';
export interface BundleRoutesDeps {
    /** Isolated FeatureBundleRegistry instance (DI-friendly). */
    bundleRegistry: FeatureBundleRegistry;
    /** Event registry for validate endpoint transport/version checks. */
    registry: IRegistry;
}
export declare function createBundleRoutes(deps: BundleRoutesDeps): HttpRouter;
//# sourceMappingURL=bundle-routes.d.ts.map