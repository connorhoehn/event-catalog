// src/server/sse.ts
//
// Bounded lifecycle management for the server's Server-Sent-Events
// streams (`GET /api/flow`, `GET /api/audit`).
//
// Why this exists — three problems the routes had when each of them
// hand-rolled its own stream:
//
//   1. No cap on concurrency. Both routes registered one listener on a
//      process-singleton EventEmitter per connection and returned
//      immediately, so distributed-core's admission control released the
//      slot the moment the handler resolved (AdmissionHttpServer.dispatch
//      releases in a `finally` after `await onRequest`). Concurrency
//      control therefore never applied to SSE at all: one client could
//      hold thousands of open streams, each with a socket, a 30s
//      heartbeat timer and an emitter listener, and each receiving a
//      serialized copy of every event the catalog observes.
//
//   2. No backpressure. `res.write()`'s return value was discarded, so a
//      client that opens a stream and never reads accumulates frames in
//      the process's socket buffer without limit — a slow-reader OOM.
//
//   3. Nothing closed them on shutdown. `AdmissionHttpServer.stop()` is
//      `server.close()`, which waits for every open connection to end.
//      A single live SSE stream made the SIGTERM path in `startServer`'s
//      `shutdown()` hang forever, so Redis was never disconnected and the
//      process died to SIGKILL instead of draining.
//
// Every stream now goes through `sseRegistry.open()`: capacity is checked
// before the preamble is written, writes are dropped (and the client
// disconnected) once its socket backlog crosses a limit, and `closeAll()`
// gives the shutdown path a way to end them deterministically.

import type { Request, Response } from './http-router.js';
import { LogThrottle } from '../utils/bounded.js';
import { LogWriter, type CatalogLogger, errorMessage } from '../utils/logger.js';

/**
 * Default ceiling on concurrent SSE streams across BOTH endpoints.
 * Override with `EVENT_CATALOG_MAX_SSE_STREAMS` (0 disables the cap).
 * 256 is far above any real admin-UI fan-out — the point is to have a
 * finite number, not to be generous.
 */
export const DEFAULT_MAX_SSE_STREAMS = 256;

/**
 * Default ceiling on a single stream's unflushed write backlog, in
 * bytes. Crossing it means the peer is not reading; the stream is
 * destroyed rather than buffering indefinitely. Override with
 * `EVENT_CATALOG_SSE_BACKLOG_BYTES`.
 */
export const DEFAULT_SSE_BACKLOG_BYTES = 4 * 1024 * 1024;

/** Comment frame interval — keeps proxies from idle-timing the stream out. */
export const SSE_HEARTBEAT_MS = 30_000;

/**
 * Rate ceiling on the two stream-lifecycle warnings.
 *
 * Both fire per stream, and the cap is 256 concurrent — a client that
 * reconnects in a loop while its socket is backed up (the exact
 * behaviour that trips the backlog drop) reopens and gets dropped as
 * fast as the network allows. Five lines a minute is the sample; the
 * `sse_streams` gauge is the real signal.
 */
const SSE_LOG_WINDOW_MS = 60_000;
const SSE_LOGS_PER_WINDOW = 5;

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

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/** Write the SSE preamble headers and flush them. */
function writePreamble(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Defeats nginx / proxies that would otherwise buffer the response.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

class ManagedStream implements SseStream {
  private isClosed = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly res: Response,
    private readonly backlogBytes: number,
    private readonly teardown: () => void,
    private readonly log: LogWriter,
    private readonly warnings: LogThrottle,
  ) {}

  startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      this.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, SSE_HEARTBEAT_MS);
    // Never let a heartbeat keep the process (or a test runner) alive.
    this.heartbeat.unref?.();
  }

  get closed(): boolean {
    return this.isClosed;
  }

  write(frame: string): boolean {
    if (this.isClosed) return false;
    // A peer that has stopped reading shows up as a growing unflushed
    // backlog. Drop it rather than buffering the whole event stream in
    // this process's memory on its behalf.
    if (this.backlogBytes > 0 && this.res.raw.writableLength > this.backlogBytes) {
      const suppressed = this.warnings.attempt('backlog');
      if (suppressed !== null) {
        this.log.warn(
          '[sse] dropping a stream whose write backlog exceeded'
          + LogThrottle.suffix(suppressed),
          {
            component: 'sse',
            reason: 'backlog-exceeded',
            backlogBytes: this.backlogBytes,
            unflushedBytes: this.res.raw.writableLength,
            suppressed,
          },
          `${this.backlogBytes} bytes — client is not reading`,
        );
      }
      this.close();
      return false;
    }
    try {
      this.res.write(frame);
    } catch {
      // Peer vanished between the close event and this write.
      this.close();
      return false;
    }
    return true;
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    try {
      this.teardown();
    } catch (err) {
      const suppressed = this.warnings.attempt('teardown');
      if (suppressed !== null) {
        this.log.warn(
          '[sse] stream teardown threw' + LogThrottle.suffix(suppressed) + ':',
          {
            component: 'sse',
            reason: 'teardown-threw',
            error: errorMessage(err),
            suppressed,
          },
          (err as Error).message,
        );
      }
    }
    try {
      this.res.end();
    } catch {
      // already destroyed
    }
    // end() alone leaves a keep-alive socket open, which is exactly what
    // stalls server.close() on shutdown. Destroy the underlying socket.
    try {
      this.res.raw.destroy();
    } catch {
      // already destroyed
    }
  }
}

/**
 * Process-wide registry of open SSE streams. A singleton because the
 * cap is a property of the process's memory and socket budget, not of
 * either individual route.
 */
export class SseRegistry {
  private readonly streams = new Set<ManagedStream>();
  private limits: SseLimits;
  private log = new LogWriter();
  private readonly warnings = new LogThrottle({
    keyIntervalMs: SSE_LOG_WINDOW_MS,
    maxPerWindow: SSE_LOGS_PER_WINDOW,
  });

  constructor(limits?: Partial<SseLimits>, logger?: CatalogLogger) {
    if (logger !== undefined) this.log = new LogWriter(logger);
    this.limits = {
      maxStreams: limits?.maxStreams
        ?? envInt('EVENT_CATALOG_MAX_SSE_STREAMS', DEFAULT_MAX_SSE_STREAMS),
      backlogBytes: limits?.backlogBytes
        ?? envInt('EVENT_CATALOG_SSE_BACKLOG_BYTES', DEFAULT_SSE_BACKLOG_BYTES),
    };
  }

  /** Number of currently open streams. */
  get size(): number {
    return this.streams.size;
  }

  /** Current limits (read-only view). */
  getLimits(): SseLimits {
    return { ...this.limits };
  }

  /** Replace the limits — used by startServer and by tests. */
  configure(limits: Partial<SseLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  /**
   * Point stream diagnostics at an operator-supplied sink.
   *
   * A setter rather than a constructor argument because this class is a
   * process singleton created at module load, long before `startServer`
   * has resolved its config. Passing `undefined` restores the console
   * default.
   */
  /**
   * Called when a stream is refused at the cap. PromMetrics.recordSseRejected
   * existed with ZERO callers, so `sse_streams_rejected_total` was never
   * registered or rendered and saturation was only inferable from
   * `active === max` happening to land on a scrape.
   */
  private onReject?: () => void;

  useRejectionHook(hook?: () => void): void {
    this.onReject = hook;
  }

  useLogger(logger?: CatalogLogger): void {
    this.log = new LogWriter(logger);
  }

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
  open(req: Request, res: Response, onClose: () => void): SseStream | null {
    const { maxStreams, backlogBytes } = this.limits;
    if (maxStreams > 0 && this.streams.size >= maxStreams) {
      this.onReject?.();
      res.status(503).json({
        error: 'TooManyStreams',
        message: `server is at its concurrent event-stream limit (${maxStreams})`,
      });
      return null;
    }

    writePreamble(res);

    const stream = new ManagedStream(res, backlogBytes, () => {
      this.streams.delete(stream);
      onClose();
    }, this.log, this.warnings);
    this.streams.add(stream);
    stream.startHeartbeat();

    req.on('close', () => stream.close());
    res.raw.on('close', () => stream.close());
    res.raw.on('error', () => stream.close());

    return stream;
  }

  /**
   * Close every open stream. Called from the shutdown path so
   * `AdmissionHttpServer.stop()` (i.e. `http.Server.close()`) is not
   * blocked forever by streams that never end on their own.
   *
   * Returns how many streams were closed.
   */
  closeAll(): number {
    const closed = this.streams.size;
    for (const stream of [...this.streams]) {
      stream.close();
    }
    this.streams.clear();
    return closed;
  }
}

/** Module singleton shared by /api/flow and /api/audit. */
export const sseRegistry = new SseRegistry();
