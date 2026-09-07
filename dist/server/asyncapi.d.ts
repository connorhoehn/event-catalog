import type { Registry } from '../registry/index.js';
export interface AsyncApiBuildOpts {
    /** AsyncAPI `info.title`. Defaults to "event-catalog". */
    title?: string;
    /** AsyncAPI `info.version`. Defaults to package version when known. */
    version?: string;
    /** Optional namespace filter — restrict output to one namespace. */
    namespace?: string;
    /**
     * Namespaces to drop from the output.
     *
     * Used by `scripts/generate-asyncapi.ts` to exclude `client` / `ws` — the
     * gateway frames, which are multiplexed over one WebSocket and have no
     * broker address, so describing them as Redis channels here would be a
     * lie. They get their own document (`contracts/asyncapi.yaml`).
     */
    excludeNamespaces?: string[];
    /** Override `info.description`. */
    description?: string;
    /**
     * Extra `x-`-prefixed members to merge into `info`. The offline generator
     * uses this to stamp a machine-readable coverage statement onto the
     * committed artifact, so a reader learns the document's scope from the
     * document itself rather than from a README they may never open.
     */
    infoExtensions?: Record<string, unknown>;
    /** Optional `externalDocs` block (e.g. pointing at the companion document). */
    externalDocs?: {
        description?: string;
        url: string;
    };
}
/**
 * Server keys. Exported so a generator can assert it referenced the servers
 * it thinks it did.
 */
export declare const ASYNCAPI_SERVER_KEYS: {
    readonly signal: "signalRedis";
    readonly durable: "durableMessageQueue";
};
export declare function buildAsyncApiSpec(registry: Registry, opts?: AsyncApiBuildOpts): Record<string, unknown>;
//# sourceMappingURL=asyncapi.d.ts.map