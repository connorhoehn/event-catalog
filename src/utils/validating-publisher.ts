import { Registry } from '../registry/index';
import type { DLQManager } from '../dlq/DLQManager.js';
import { LogThrottle } from './bounded.js';
import { LogWriter, type CatalogLogger } from './logger.js';

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
export class ValidationError extends Error {
  readonly eventName: string;
  readonly validationErrors: string[];

  constructor(eventName: string, errors: string[]) {
    super(
      `[event-catalog] Payload for "${eventName}" failed validation: ${errors.join('; ')}`,
    );
    this.name = 'ValidationError';
    this.eventName = eventName;
    this.validationErrors = errors;
  }
}

/**
 * Wraps a publish function with pre-flight schema validation against the
 * event-catalog registry. Fail-closed by default: in 'strict' mode (the
 * default) a ValidationError is thrown on schema mismatch, or the record is
 * routed to `dlq` when one is supplied. In 'warn' mode, which callers must
 * ask for explicitly, errors are logged but the publish still proceeds. In
 * 'off' mode the payload is passed through without any validation.
 */
export function createValidatingPublisher<T>(
  registry: Registry,
  eventName: string,
  publishFn: (payload: T) => Promise<void>,
  options?: ValidatingPublisherOptions,
): (payload: T) => Promise<void> {
  const mode: ValidationMode = options?.mode ?? 'strict';
  const onError = options?.onValidationError;

  if (mode === 'off') {
    return (payload: T) => publishFn(payload);
  }

  const log = new LogWriter(options?.logger);
  const warnings = new LogThrottle({
    keyIntervalMs: WARN_MODE_LOG_WINDOW_MS,
    maxPerWindow: WARN_MODE_LOGS_PER_WINDOW,
  });

  return async (payload: T): Promise<void> => {
    const result = registry.validate(eventName, payload);

    if (!result.valid) {
      const errors = (result.errors ?? []).map(e =>
        e.path ? `${e.path}: ${e.message}` : e.message,
      );

      if (onError) {
        onError(eventName, errors, payload);
      }

      if (mode === 'strict') {
        if (options?.dlq) {
          // Route to DLQ instead of throwing — caller can inspect and replay.
          await options.dlq.append(
            eventName,
            payload,
            'VALIDATION_FAILED',
            errors.join('; '),
          );
          return;
        }
        throw new ValidationError(eventName, errors);
      }

      // 'warn' — log and fall through to publish
      const suppressed = warnings.attempt(eventName);
      if (suppressed !== null) {
        log.warn(
          `[event-catalog] Validation warning for "${eventName}": ${errors.join('; ')}`
          + LogThrottle.suffix(suppressed),
          {
            eventName,
            mode,
            errors,
            suppressed,
          },
        );
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
export function createPublisher<T>(
  eventName: string,
  publishFn: (payload: T) => Promise<void>,
  options?: ValidatingPublisherOptions & { registry?: Registry },
): (payload: T) => Promise<void> {
  const registry = options?.registry ?? new Registry();
  const { registry: _omit, ...publisherOptions } = options ?? {};
  return createValidatingPublisher<T>(registry, eventName, publishFn, publisherOptions);
}
