"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = void 0;
exports.createValidatingPublisher = createValidatingPublisher;
exports.createPublisher = createPublisher;
const index_1 = require("../registry/index");
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
 * event-catalog registry. Fail-open by default: in 'warn' mode errors are
 * logged but the publish still proceeds. In 'strict' mode a ValidationError
 * is thrown on schema mismatch. In 'off' mode the payload is passed through
 * without any validation.
 */
function createValidatingPublisher(registry, eventName, publishFn, options) {
    const mode = options?.mode ?? 'warn';
    const onError = options?.onValidationError;
    if (mode === 'off') {
        return (payload) => publishFn(payload);
    }
    return async (payload) => {
        const result = registry.validate(eventName, payload);
        if (!result.valid) {
            const errors = (result.errors ?? []).map(e => e.path ? `${e.path}: ${e.message}` : e.message);
            if (onError) {
                onError(eventName, errors, payload);
            }
            if (mode === 'strict') {
                throw new ValidationError(eventName, errors);
            }
            // 'warn' — log and fall through to publish
            console.warn(`[event-catalog] Validation warning for "${eventName}": ${errors.join('; ')}`);
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