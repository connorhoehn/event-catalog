import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createOpsHandlers(deps: RoutesDeps): {
    health: (_req: Request, res: Response) => Promise<void>;
    registryHealth: (_req: Request, res: Response) => Promise<void>;
    snapshot: (_req: Request, res: Response) => void;
    history: (_req: Request, res: Response) => void;
};
//# sourceMappingURL=ops.d.ts.map