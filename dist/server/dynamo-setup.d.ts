import { type CatalogLogger } from '../utils/logger.js';
/**
 * Provision the DLQ table if it is missing. Runs once at boot.
 *
 * `logger` is threaded from `ServerConfig`; omitted, the two lines below
 * go to `console.log` exactly as they always did.
 */
export declare function ensureTable(logger?: CatalogLogger): Promise<void>;
//# sourceMappingURL=dynamo-setup.d.ts.map