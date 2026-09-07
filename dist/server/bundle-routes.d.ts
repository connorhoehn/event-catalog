import { type HttpRouter } from './http-router.js';
import type { FeatureBundleRegistry } from '../bundles/FeatureBundle.js';
import type { IRegistry } from '../registry/types.js';
import type { CatalogLogger } from '../utils/logger.js';
export interface BundleRoutesDeps {
    /** Isolated FeatureBundleRegistry instance (DI-friendly). */
    bundleRegistry: FeatureBundleRegistry;
    /** Event registry for validate endpoint transport/version checks. */
    registry: IRegistry;
    /**
     * Diagnostics sink for the router's uncaught-handler warning. These
     * handlers log nothing themselves; without this the bundle router
     * would be the one route table still writing to bare console.
     */
    logger?: CatalogLogger;
}
export declare function createBundleRoutes(deps: BundleRoutesDeps): HttpRouter;
//# sourceMappingURL=bundle-routes.d.ts.map