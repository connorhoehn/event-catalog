import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createAuditHandlers(deps: RoutesDeps): {
    stream: (req: Request, res: Response) => Promise<void>;
    recent: (req: Request, res: Response) => Promise<void>;
};
//# sourceMappingURL=audit.d.ts.map