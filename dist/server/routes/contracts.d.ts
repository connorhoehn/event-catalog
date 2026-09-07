import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createContractHandlers(deps: RoutesDeps): {
    asyncapi: (req: Request, res: Response) => void;
    fingerprints: (req: Request, res: Response) => void;
    freshness: (req: Request, res: Response) => void;
};
//# sourceMappingURL=contracts.d.ts.map