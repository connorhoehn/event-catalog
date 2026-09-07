import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createNamespaceHandlers(deps: RoutesDeps): {
    list: (_req: Request, res: Response) => void;
    summary: (req: Request, res: Response) => void;
    topology: (req: Request, res: Response) => void;
};
//# sourceMappingURL=namespaces.d.ts.map