import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createDeprecationHandlers(deps: RoutesDeps): {
    deprecate: (req: Request, res: Response) => void;
    undeprecate: (req: Request, res: Response) => void;
    list: (_req: Request, res: Response) => void;
    deprecateBulk: (req: Request, res: Response) => void;
};
//# sourceMappingURL=deprecation.d.ts.map