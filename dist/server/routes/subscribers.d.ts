import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createSubscriberHandlers(deps: RoutesDeps): {
    add: (req: Request, res: Response) => void;
    remove: (req: Request, res: Response) => void;
    heartbeat: (req: Request, res: Response) => void;
    list: (req: Request, res: Response) => void;
};
//# sourceMappingURL=subscribers.d.ts.map