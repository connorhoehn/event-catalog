import { Registry } from '../registry/index';
import type { DLQManager } from '../dlq/DLQManager.js';
import { type CatalogLogger } from './logger.js';
export type ValidationMode = 'strict' | 'warn' | 'off';
export interface ValidatingPublisherOptions {
    /**
     * default: 'strict' — an invalid payload is never published. Pass
     * 'warn' explicitly to log and publish anyway, or 'off' to skip
     * validation.
     */
    mode?: ValidationMode;
    /**
     * Called on any validation failure, in both 'warn' and 'strict' modes.
     * In 'strict' mode this fires before the ValidationError is thrown
     * (unless dlq is provided, in which case the record is routed to the
     * DLQ instead of throwing).
     */
    onValidationError?: (eventName: string, errors: string[], payload: unknown) => void;
    /**
     * E5 DLQ integration. When provided and mode is 'strict', validation
     * failures are routed to the DLQ instead of throwing a ValidationError.
     * Valid payloads are still published normally.
     */
    dlq?: DLQManager;
    /**
     * Where the 'warn'-mode advisory goes. Defaults to `console.warn`,
     * byte-for-byte as before.
     *
     * This module takes its own options object, which is why it was the one
     * call site the client-side logger pass missed: `SignalTransport` and
     * `DurableTransport` read `logger` off their transport options and
     * nothing reaches this wrapper from there. It is a publish-path
     * warning like the rest of them and belongs on the same sink.
     */
    logger?: CatalogLogger;
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
 * event-catalog registry. Fail-closed by default: in 'strict' mode (the
 * default) a ValidationError is thrown on schema mismatch, or the record is
 * routed to `dlq` when one is supplied. In 'warn' mode, which callers must
 * ask for explicitly, errors are logged but the publish still proceeds. In
 * 'off' mode the payload is passed through without any validation.
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