import type * as http from 'node:http';
import { type CompressionConfig, type Encoding } from './compression.js';
export interface RouteRequest {
    /** Uppercase HTTP method. */
    method: string;
    /** Path portion of the URL (no query string). */
    path: string;
    /** `:param` captures from the matched route pattern, URL-decoded. */
    params: Record<string, string>;
    /**
     * Parsed query string. Single values are strings; repeated keys
     * become arrays (matching the express behavior the handlers'
     * `typeof x === 'string'` guards were written against).
     */
    query: Record<string, string | string[]>;
    /** Parsed JSON body (undefined when there was none). */
    body?: unknown;
    /** Case-insensitive single-header lookup. */
    header(name: string): string | undefined;
    /** Delegate to the underlying request's event emitter ('close', …). */
    on(event: string, listener: (...args: unknown[]) => void): void;
    /** Underlying Node request. Use sparingly. */
    raw: http.IncomingMessage;
}
export interface RouteResponse {
    /** Set the status code for the next json()/send()/end(). Chainable. */
    status(code: number): RouteResponse;
    /** Send a JSON response (status defaults to 200 or the last status()). */
    json(body: unknown): void;
    /** Send a plain response body with the current status + headers. */
    send(body: string): void;
    setHeader(name: string, value: string): void;
    /** Stream a chunk (SSE). Implicitly flushes headers on first write. */
    write(chunk: string): boolean;
    end(body?: string): void;
    /** Flush headers without a body — used by the SSE routes. */
    flushHeaders(): void;
    readonly headersSent: boolean;
    /** Underlying Node response. Use sparingly. */
    raw: http.ServerResponse;
}
export type RouteHandler = (req: RouteRequest, res: RouteResponse) => void | Promise<void>;
/**
 * Connect-style middleware — the shape `startServer`'s `authMiddleware`
 * config accepts. Call `next()` to continue into the routers; respond
 * on `res` (and don't call next) to short-circuit.
 */
export type Middleware = (req: RouteRequest, res: RouteResponse, next: (err?: unknown) => void) => void;
export type Request = RouteRequest;
export type Response = RouteResponse;
export declare function parseQuery(rawUrl: string): Record<string, string | string[]>;
export declare function makeRouteRequest(nodeReq: http.IncomingMessage, body: unknown): RouteRequest;
/**
 * Per-response compression context: the server-wide policy plus the one
 * coding negotiated from THIS request's `Accept-Encoding`.
 */
export interface ResponseCompression {
    readonly config: CompressionConfig;
    readonly encoding: Encoding;
}
/**
 * Build the compression context for a request. Returns undefined when
 * compression is off, so the response path keeps its old shape exactly.
 */
export declare function compressionFor(nodeReq: http.IncomingMessage, config: CompressionConfig | undefined): ResponseCompression | undefined;
export declare function makeRouteResponse(nodeRes: http.ServerResponse, compression?: ResponseCompression): RouteResponse;
export declare class HttpRouter {
    private readonly routes;
    get(path: string, handler: RouteHandler): this;
    post(path: string, handler: RouteHandler): this;
    put(path: string, handler: RouteHandler): this;
    patch(path: string, handler: RouteHandler): this;
    delete(path: string, handler: RouteHandler): this;
    private add;
    /**
     * Dispatch `req` against the route table using `pathname` (the path
     * AFTER any mount prefix has been stripped — '' or '/' for the mount
     * root). Returns true when a route matched (whether or not its handler
     * has responded yet), false when nothing matched so the caller can
     * fall through. Handler errors send a 500 unless headers are already
     * out (mid-SSE), and never propagate.
     */
    handle(req: RouteRequest, res: RouteResponse, pathname: string): Promise<boolean>;
}
/** Express-style factory so route modules read `const router = Router()`. */
export declare function Router(): HttpRouter;
export type Mount = [prefix: string, router: HttpRouter];
/**
 * Strip `prefix` off `path`. Returns the sub-path ('/' for an exact
 * prefix hit) or null when `path` isn't under `prefix`. '' or '/' as
 * prefix matches everything.
 */
export declare function stripPrefix(path: string, prefix: string): string | null;
/**
 * Dispatch a prepared req/res pair across mounts in order (longest
 * prefix should be listed first when mounts nest). Returns true when
 * some router handled the request.
 */
export declare function dispatchMounts(req: RouteRequest, res: RouteResponse, mounts: Mount[]): Promise<boolean>;
/**
 * Build a plain `http.RequestListener` over a set of mounts — buffers +
 * JSON-parses the body itself. This is the unit-test harness (supertest
 * accepts a listener directly); production traffic instead arrives
 * through distributed-core's AdmissionHttpServer, which does its own
 * bounded body read before `startServer`'s onRequest builds the same
 * req/res adapters.
 */
export interface RequestListenerOptions {
    /** Response-compression policy. Omitted ⇒ no compression, as before. */
    compression?: CompressionConfig;
}
export declare function createRequestListener(...mounts: Mount[]): http.RequestListener;
export declare function createRequestListener(options: RequestListenerOptions, ...mounts: Mount[]): http.RequestListener;
//# sourceMappingURL=http-router.d.ts.map