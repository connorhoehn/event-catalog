import type { Request, Response } from './http-router.js';
/**
 * Default ceiling on concurrent SSE streams across BOTH endpoints.
 * Override with `EVENT_CATALOG_MAX_SSE_STREAMS` (0 disables the cap).
 * 256 is far above any real admin-UI fan-out — the point is to have a
 * finite number, not to be generous.
 */
export declare const DEFAULT_MAX_SSE_STREAMS = 256;
/**
 * Default ceiling on a single stream's unflushed write backlog, in
 * bytes. Crossing it means the peer is not reading; the stream is
 * destroyed rather than buffering indefinitely. Override with
 * `EVENT_CATALOG_SSE_BACKLOG_BYTES`.
 */
export declare const DEFAULT_SSE_BACKLOG_BYTES: number;
/** Comment frame interval — keeps proxies from idle-timing the stream out. */
export declare const SSE_HEARTBEAT_MS = 30000;
/** Handle returned to a route for a successfully opened stream. */
export interface SseStream {
    /** Write one pre-formatted SSE frame. Returns false once closed. */
    write(frame: string): boolean;
    /** True once the stream has been closed (by peer, backlog, or shutdown). */
    readonly closed: boolean;
    /** Close the stream and run its teardown exactly once. */
    close(): void;
}
export interface SseLimits {
    /** Max concurrent streams; 0 or negative disables the cap. */
    maxStreams: number;
    /** Max unflushed bytes per stream before it is dropped. */
    backlogBytes: number;
}
/**
 * Process-wide registry of open SSE streams. A singleton because the
 * cap is a property of the process's memory and socket budget, not of
 * either individual route.
 */
export declare class SseRegistry {
    private readonly streams;
    private limits;
    constructor(limits?: Partial<SseLimits>);
    /** Number of currently open streams. */
    get size(): number;
    /** Current limits (read-only view). */
    getLimits(): SseLimits;
    /** Replace the limits — used by startServer and by tests. */
    configure(limits: Partial<SseLimits>): void;
    /**
     * Open a managed SSE stream for `req`/`res`.
     *
     * Returns null — having already answered with 503 — when the process
     * is at its concurrent-stream ceiling. The caller must return
     * immediately in that case and must NOT have written anything to the
     * response beforehand.
     *
     * `onClose` runs exactly once, whichever way the stream ends (peer
     * disconnect, backlog drop, or `closeAll()` during shutdown); routes
     * use it to detach their emitter listener.
     */
    open(req: Request, res: Response, onClose: () => void): SseStream | null;
    /**
     * Close every open stream. Called from the shutdown path so
     * `AdmissionHttpServer.stop()` (i.e. `http.Server.close()`) is not
     * blocked forever by streams that never end on their own.
     *
     * Returns how many streams were closed.
     */
    closeAll(): number;
}
/** Module singleton shared by /api/flow and /api/audit. */
export declare const sseRegistry: SseRegistry;
//# sourceMappingURL=sse.d.ts.map