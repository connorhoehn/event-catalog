"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = void 0;
exports.createValidatingPublisher = createValidatingPublisher;
exports.createPublisher = createPublisher;
const index_1 = require("../registry/index");
const bounded_js_1 = require("./bounded.js");
const logger_js_1 = require("./logger.js");
/**
 * Rate ceiling for the 'warn'-mode advisory.
 *
 * The line fires on *every* failing publish, and a publisher whose
 * payload shape has drifted fails every publish — so at even a modest
 * publish rate this was tens of thousands of identical lines an hour,
 * from the one code path whose entire purpose is to keep publishing
 * anyway. Five per minute is enough to notice; `onValidationError` is
 * the unthrottled hook for a caller that wants every occurrence.
 */
const WARN_MODE_LOG_WINDOW_MS = 60_000;
const WARN_MODE_LOGS_PER_WINDOW = 5;
/**
 * Thrown by createValidatingPublisher / createPublisher when the mode is
 * 'strict' and the payload does not pass registry validation.
 */
class ValidationError extends Error {
    eventName;
    validationErrors;
    constructor(eventName, errors) {
        super(`[event-catalog] Payload for "${eventName}" failed validation: ${errors.join('; ')}`);
        this.name = 'ValidationError';
        this.eventName = eventName;
        this.validationErrors = errors;
    }
}
exports.ValidationError = ValidationError;
/**
 * Wraps a publish function with pre-flight schema validation against the
 * event-catalog registry. Fail-closed by default: in 'strict' mode (the
 * default) a ValidationError is thrown on schema mismatch, or the record is
 * routed to `dlq` when one is supplied. In 'warn' mode, which callers must
 * ask for explicitly, errors are logged but the publish still proceeds. In
 * 'off' mode the payload is passed through without any validation.
 */
function createValidatingPublisher(registry, eventName, publishFn, options) {
    const mode = options?.mode ?? 'strict';
    const onError = options?.onValidationError;
    if (mode === 'off') {
        return (payload) => publishFn(payload);
    }
    const log = new logger_js_1.LogWriter(options?.logger);
    const warnings = new bounded_js_1.LogThrottle({
        keyIntervalMs: WARN_MODE_LOG_WINDOW_MS,
        maxPerWindow: WARN_MODE_LOGS_PER_WINDOW,
    });
    return async (payload) => {
        const result = registry.validate(eventName, payload);
        if (!result.valid) {
            const errors = (result.errors ?? []).map(e => e.path ? `${e.path}: ${e.message}` : e.message);
            if (onError) {
                onError(eventName, errors, payload);
            }
            if (mode === 'strict') {
                if (options?.dlq) {
                    // Route to DLQ instead of throwing — caller can inspect and replay.
                    await options.dlq.append(eventName, payload, 'VALIDATION_FAILED', errors.join('; '));
                    return;
                }
                throw new ValidationError(eventName, errors);
            }
            // 'warn' — log and fall through to publish
            const suppressed = warnings.attempt(eventName);
            if (suppressed !== null) {
                log.warn(`[event-catalog] Validation warning for "${eventName}": ${errors.join('; ')}`
                    + bounded_js_1.LogThrottle.suffix(suppressed), {
                    eventName,
                    mode,
                    errors,
                    suppressed,
                });
            }
        }
        await publishFn(payload);
    };
}
/**
 * Convenience wrapper. Creates a validated publisher for a specific event
 * using a registry instance (typically a singleton). When `options.registry`
 * is omitted a fresh in-memory Registry is used (useful in tests; real
 * callers should always supply their configured registry instance).
 */
function createPublisher(eventName, publishFn, options) {
    const registry = options?.registry ?? new index_1.Registry();
    const { registry: _omit, ...publisherOptions } = options ?? {};
    return createValidatingPublisher(registry, eventName, publishFn, publisherOptions);
}
//# sourceMappingURL=validating-publisher.js.map