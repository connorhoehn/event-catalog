import type { Request, Response } from '../http-router.js';
import type { RoutesDeps } from './_shared.js';
export declare function createTransportHandlers(deps: RoutesDeps): {
    signalChannels: (_req: Request, res: Response) => void;
    durableQueues: (_req: Request, res: Response) => void;
};
//# sourceMappingURL=transports.d.ts.map