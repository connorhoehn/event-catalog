"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogWriter = exports.consoleLogger = void 0;
exports.errorMessage = errorMessage;
/**
 * The default sink, and the exact behaviour every call site had before the
 * logger existed: `console.warn` / `console.error`, with any trailing detail
 * value passed as a second console argument rather than folded into the
 * message.
 *
 * Referenced by identity in {@link LogWriter} — passing this object
 * explicitly is the same as passing nothing.
 */
exports.consoleLogger = {
    warn(message, fields) {
        if (fields === undefined)
            console.warn(message);
        else
            console.warn(message, fields);
    },
    error(message, fields) {
        if (fields === undefined)
            console.error(message);
        else
            console.error(message, fields);
    },
    info(message, fields) {
        if (fields === undefined)
            console.log(message);
        else
            console.log(message, fields);
    },
};
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
class LogWriter {
    sink;
    /** True when the sink is the console default, so raw console args apply. */
    rawConsole;
    constructor(logger) {
        this.sink = logger ?? exports.consoleLogger;
        this.rawConsole = logger === undefined || logger === exports.consoleLogger;
    }
    warn(message, fields, ...consoleTail) {
        if (this.rawConsole) {
            console.warn(message, ...consoleTail);
            return;
        }
        this.sink.warn(message, fields);
    }
    error(message, fields, ...consoleTail) {
        if (this.rawConsole) {
            console.error(message, ...consoleTail);
            return;
        }
        this.sink.error(message, fields);
    }
    /**
     * Lifecycle lines the server used to send to `console.log`. Same
     * byte-identical guarantee on the default path; on an injected sink it
     * prefers `info`, falls back to `debug`, and is dropped if the sink
     * implements neither (see {@link CatalogLogger.info}).
     */
    info(message, fields, ...consoleTail) {
        if (this.rawConsole) {
            console.log(message, ...consoleTail);
            return;
        }
        const sink = this.sink.info ?? this.sink.debug;
        sink?.call(this.sink, message, fields);
    }
}
exports.LogWriter = LogWriter;
/** Normalise a caught value to something worth putting in a log field. */
function errorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
//# sourceMappingURL=logger.js.map