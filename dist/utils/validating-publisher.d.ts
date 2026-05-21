import { Registry } from '../registry/index';
export type ValidationMode = 'strict' | 'warn' | 'off';
export interface ValidatingPublisherOptions {
    /** default: 'warn' */
    mode?: ValidationMode;
    /**
     * Called on any validation failure, in both 'warn' and 'strict' modes.
     * In 'strict' mode this fires before the ValidationError is thrown.
     */
    onValidationError?: (eventName: string, errors: string[], payload: unknown) => void;
}
/**
 * Thrown by createValidatingPublisher / createPublisher when the mode is
 * 'strict' and the payload does not pass registry validation.
 */
export declare class ValidationError extends Error {
    readonly eventName: string;
    readonly validationErrors: string[];
    constructor(eventName: string, errors: string[]);
}
/**
 * Wraps a publish function with pre-flight schema validation against the
 * event-catalog registry. Fail-open by default: in 'warn' mode errors are
 * logged but the publish still proceeds. In 'strict' mode a ValidationError
 * is thrown on schema mismatch. In 'off' mode the payload is passed through
 * without any validation.
 */
export declare function createValidatingPublisher<T>(registry: Registry, eventName: string, publishFn: (payload: T) => Promise<void>, options?: ValidatingPublisherOptions): (payload: T) => Promise<void>;
/**
 * Convenience wrapper. Creates a validated publisher for a specific event
 * using a registry instance (typically a singleton). When `options.registry`
 * is omitted a fresh in-memory Registry is used (useful in tests; real
 * callers should always supply their configured registry instance).
 */
export declare function createPublisher<T>(eventName: string, publishFn: (payload: T) => Promise<void>, options?: ValidatingPublisherOptions & {
    registry?: Registry;
}): (payload: T) => Promise<void>;
//# sourceMappingURL=validating-publisher.d.ts.map