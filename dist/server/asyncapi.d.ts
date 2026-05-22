import type { Registry } from '../registry/index.js';
export interface AsyncApiBuildOpts {
    /** AsyncAPI `info.title`. Defaults to "event-catalog". */
    title?: string;
    /** AsyncAPI `info.version`. Defaults to package version when known. */
    version?: string;
    /** Optional namespace filter — restrict output to one namespace. */
    namespace?: string;
}
export declare function buildAsyncApiSpec(registry: Registry, opts?: AsyncApiBuildOpts): Record<string, unknown>;
//# sourceMappingURL=asyncapi.d.ts.map