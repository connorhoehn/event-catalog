import type { Request, Response } from '../http-router.js';
import { type RoutesDeps } from './_shared.js';
export declare function createEventHandlers(deps: RoutesDeps): {
    list: (_req: Request, res: Response) => void;
    listPoisoned: (_req: Request, res: Response) => void;
    get: (req: Request, res: Response) => void;
    checkSchema: (req: Request, res: Response) => void;
    stats: (req: Request, res: Response) => void;
    history: (req: Request, res: Response) => Promise<void>;
    declare: (req: Request, res: Response) => Promise<void>;
    declareBulk: (req: Request, res: Response) => void;
    observedProducers: (req: Request, res: Response) => void;
    clearPoison: (req: Request, res: Response) => void;
    exportBulk: (req: Request, res: Response) => void;
    remove: (req: Request, res: Response) => void;
};
//# sourceMappingURL=events.d.ts.map