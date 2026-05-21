import { Registry } from '../registry/index';
import type { DLQManager } from '../dlq/DLQManager.js';

export type ValidationMode = 'strict' | 'warn' | 'off';

export interface ValidatingPublisherOptions {
  /** default: 'warn' */
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
}

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
 * event-catalog registry. Fail-open by default: in 'warn' mode errors are
 * logged but the publish still proceeds. In 'strict' mode a ValidationError
 * is thrown on schema mismatch. In 'off' mode the payload is passed through
 * without any validation.
 */
export function createValidatingPublisher<T>(
  registry: Registry,
  eventName: string,
  publishFn: (payload: T) => Promise<void>,
  options?: ValidatingPublisherOptions,
): (payload: T) => Promise<void> {
  const mode: ValidationMode = options?.mode ?? 'warn';
  const onError = options?.onValidationError;

  if (mode === 'off') {
    return (payload: T) => publishFn(payload);
  }

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
      console.warn(
        `[event-catalog] Validation warning for "${eventName}": ${errors.join('; ')}`,
      );
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
