import type * as http from 'node:http';
import { type CompressionConfig } from './compression.js';
/**
 * The shape distributed-core's `serveStatic` returns: `true` when the
 * request was answered, `false` when the caller should fall through.
 * Restated here so this module does not depend on the exact name the
 * upstream `.d.ts` exports.
 */
export type StaticHandler = (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
/**
 * Total bytes (raw + compressed, summed) the variant cache may hold.
 * The whole admin bundle is ~630 KiB raw and ~200 KiB compressed, so
 * 8 MiB is "the build fits, several times over" rather than a tuning
 * knob anyone should need to touch.
 */
export declare const DEFAULT_STATIC_CACHE_BYTES: number;
/**
 * Insertion-ordered, byte-bounded cache of compressed static variants.
 *
 * Keyed on request path + coding. A hit is only used when the raw bytes
 * still match, so the cache cannot outlive a rebuild — `index.html` is
 * not content-hashed and is the one asset whose bytes change under a
 * stable name.
 */
export declare class StaticCompressionCache {
    private readonly maxBytes;
    private readonly entries;
    private bytes;
    constructor(maxBytes?: number);
    /** Current occupancy, for tests and diagnostics. */
    get size(): number;
    get byteLength(): number;
    get(key: string, raw: Buffer): Buffer | undefined;
    /** `key` already encodes the coding, so the variant stores only bytes. */
    set(key: string, raw: Buffer, compressed: Buffer): void;
    clear(): void;
}
/**
 * Negotiate + write one fully-buffered static body to the socket.
 *
 * Shared by the `serveStatic` wrapper and the SPA `index.html` fallback,
 * which bypasses `serveStatic` entirely and would otherwise be the one
 * remaining uncompressed path.
 */
export declare function sendStaticBuffer(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: Buffer, headers: ReadonlyMap<string, number | string | readonly string[]>, compression: CompressionConfig | undefined, cache?: StaticCompressionCache): void;
export interface StaticCompressionOptions {
    /** Server-wide policy. Undefined or disabled ⇒ `handler` is returned as-is. */
    readonly compression: CompressionConfig | undefined;
    /**
     * Cache for compressed variants. Pass `null` to disable caching (tests
     * that assert compression actually ran); omit for a default-sized one.
     */
    readonly cache?: StaticCompressionCache | null;
}
/**
 * Wrap a `serveStatic` handler so its responses are content-negotiated.
 *
 * The returned handler keeps the wrapped one's true/false contract
 * exactly: a request `serveStatic` declines (returns false) is never
 * touched, and nothing is written to the socket for it.
 */
export declare function withStaticCompression(handler: StaticHandler, options: StaticCompressionOptions): StaticHandler;
//# sourceMappingURL=static-compression.d.ts.map