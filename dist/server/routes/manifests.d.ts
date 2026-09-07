import type { Request, Response } from '../http-router.js';
import type { ManifestStore } from '../manifest-store.js';
import { type RoutesDeps } from './_shared.js';
export declare function createManifestHandlers(deps: RoutesDeps, manifestStore: ManifestStore): {
    put: (req: Request, res: Response) => Promise<void>;
    list: (_req: Request, res: Response) => Promise<void>;
    get: (req: Request, res: Response) => Promise<void>;
    remove: (req: Request, res: Response) => Promise<void>;
    checkAll: (_req: Request, res: Response) => Promise<void>;
};
//# sourceMappingURL=manifests.d.ts.map