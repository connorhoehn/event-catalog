/**
 * Where the library's own diagnostics go.
 *
 * `src/client/**` runs inside every consumer service, and until now every
 * line it emitted went straight to `console.warn`/`console.error`: no level
 * control, no correlation ids, no structured fields, and invisible to
 * whatever log pipeline the host process has configured. This module is the
 * seam — a consumer supplies a sink, the library writes through it.
 *
 * Deliberately not a logging framework: two required methods, one optional,
 * both taking `(message, fields?)`. Adapting pino/bunyan/console is a
 * three-line object literal (see {@link CatalogLogger}).
 *
 * Rate limiting stays *in front* of this interface. `LogThrottle` guards the
 * per-publish call sites because only the library knows which lines run at
 * the publish rate; a consumer's adapter cannot know that and should not
 * have to.
 */
/**
 * Structured context attached to a log line. Values are whatever the call
 * site knows — an event name, a queue, an attempt number, a status code —
 * and a consumer routing to pino gets them as real fields instead of a
 * sentence to regex.
 */
export interface LogFields {
    readonly [field: string]: unknown;
}
/**
 * The sink the library writes its diagnostics to.
 *
 * ```ts
 * // pino
 * const logger = { warn: (m, f) => log.warn(f ?? {}, m), error: (m, f) => log.error(f ?? {}, m) };
 * // console (this is the default)
 * const logger = { warn: (m, f) => console.warn(m, f), error: (m, f) => console.error(m, f) };
 * ```
 *
 * Implementations must not throw: the library calls them from publish and
 * poll paths that have no useful way to handle a failing logger.
 */
export interface CatalogLogger {
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
    /**
     * Optional. Nothing in the library logs at debug today — the method
     * exists so a sink can accept one without a later breaking change.
     */
    debug?(message: string, fields?: LogFields): void;
}
/**
 * The default sink, and the exact behaviour every call site had before the
 * logger existed: `console.warn` / `console.error`, with any trailing detail
 * value passed as a second console argument rather than folded into the
 * message.
 *
 * Referenced by identity in {@link LogWriter} — passing this object
 * explicitly is the same as passing nothing.
 */
export declare const consoleLogger: CatalogLogger;
/**
 * Internal adapter the transports write through.
 *
 * Each method takes the human-readable message, the structured fields, and
 * — for the default console sink only — the trailing console arguments the
 * call site used to pass (`console.warn(msg, err.message)`). Every such
 * trailing value is also present in `fields`, so a custom sink loses
 * nothing by not receiving them positionally.
 *
 * The console default is written to directly rather than through
 * {@link consoleLogger} so that output stays byte-identical to the
 * pre-logger code: same call count, same argument list.
 */
export declare class LogWriter {
    private readonly sink;
    /** True when the sink is the console default, so raw console args apply. */
    private readonly rawConsole;
    constructor(logger?: CatalogLogger);
    warn(message: string, fields?: LogFields, ...consoleTail: unknown[]): void;
    error(message: string, fields?: LogFields, ...consoleTail: unknown[]): void;
}
/** Normalise a caught value to something worth putting in a log field. */
export declare function errorMessage(err: unknown): string;
//# sourceMappingURL=logger.d.ts.map