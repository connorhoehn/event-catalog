import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createDlqHandlers(deps: RoutesDeps): {
    list: (req: Request, res: Response) => Promise<void>;
    remove: (req: Request, res: Response) => Promise<void>;
    replayBatch: (req: Request, res: Response) => Promise<void>;
    clear: (req: Request, res: Response) => Promise<void>;
    replay: (req: Request, res: Response) => Promise<void>;
};
//# sourceMappingURL=dlq.d.ts.map