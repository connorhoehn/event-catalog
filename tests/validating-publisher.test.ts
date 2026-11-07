// tests/validating-publisher.test.ts
//
// Tests for createValidatingPublisher and createPublisher — the producer-side
// pre-flight validation wrapper.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
  createValidatingPublisher,
  createPublisher,
  ValidationError,
} from '../src/utils/validating-publisher.js';

/** Build a Registry with a simple schema-bearing event pre-declared. */
function makeRegistry() {
  const reg = new Registry();
  reg.declare({
    name: 'orders.created',
    transport: 'durable',
    producer: 'order-service',
    schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['orderId', 'amount'],
    },
  });
  return reg;
}

describe('createValidatingPublisher', () => {
  const VALID_PAYLOAD = { orderId: 'o-1', amount: 42 };
  const INVALID_PAYLOAD = { orderId: 123 }; // orderId wrong type + amount missing

  describe("mode: 'off'", () => {
    it('passes the payload through without calling validate', async () => {
      const reg = makeRegistry();
      const validateSpy = vi.spyOn(reg, 'validate');
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'off',
      });

      await publish(INVALID_PAYLOAD as never);

      expect(publishFn).toHaveBeenCalledOnce();
      expect(publishFn).toHaveBeenCalledWith(INVALID_PAYLOAD);
      expect(validateSpy).not.toHaveBeenCalled();
    });

    it('calls publishFn with a valid payload', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'off',
      });

      await publish(VALID_PAYLOAD);
      expect(publishFn).toHaveBeenCalledWith(VALID_PAYLOAD);
    });
  });

  describe("mode: 'warn' (explicit)", () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('calls publishFn even when validation fails', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'warn',
      });

      await publish(INVALID_PAYLOAD as never);

      expect(publishFn).toHaveBeenCalledOnce();
    });

    it('fires onValidationError callback on failure', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});
      const onValidationError = vi.fn();

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'warn',
        onValidationError,
      });

      await publish(INVALID_PAYLOAD as never);

      expect(onValidationError).toHaveBeenCalledOnce();
      const [name, errors, payload] = onValidationError.mock.calls[0];
      expect(name).toBe('orders.created');
      expect(Array.isArray(errors)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(payload).toBe(INVALID_PAYLOAD);
    });

    it('does NOT fire onValidationError on a valid payload', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});
      const onValidationError = vi.fn();

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'warn',
        onValidationError,
      });

      await publish(VALID_PAYLOAD);

      expect(onValidationError).not.toHaveBeenCalled();
      expect(publishFn).toHaveBeenCalledWith(VALID_PAYLOAD);
    });

    it('calls publishFn for a valid payload', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'warn',
      });

      await publish(VALID_PAYLOAD);
      expect(publishFn).toHaveBeenCalledWith(VALID_PAYLOAD);
    });

    it('defaults to strict mode when no mode is provided', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});
      const onValidationError = vi.fn();

      // No mode option → defaults to 'strict': the invalid payload is refused.
      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        onValidationError,
      });

      await expect(publish(INVALID_PAYLOAD as never)).rejects.toBeInstanceOf(ValidationError);

      expect(onValidationError).toHaveBeenCalledOnce();
      expect(publishFn).not.toHaveBeenCalled();
    });

    it('warns about unknown event names but still publishes', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});
      const onValidationError = vi.fn();

      const publish = createValidatingPublisher(reg, 'unknown.event', publishFn, {
        mode: 'warn',
        onValidationError,
      });

      await publish({} as never);

      // unknown event is an error from the registry
      expect(onValidationError).toHaveBeenCalledOnce();
      expect(publishFn).toHaveBeenCalledOnce();
    });
  });

  describe("mode: 'strict'", () => {
    it('throws ValidationError on invalid payload', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'strict',
      });

      await expect(publish(INVALID_PAYLOAD as never)).rejects.toThrow(ValidationError);
      expect(publishFn).not.toHaveBeenCalled();
    });

    it('ValidationError carries eventName and validationErrors', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'strict',
      });

      let caught: ValidationError | undefined;
      try {
        await publish(INVALID_PAYLOAD as never);
      } catch (e) {
        caught = e as ValidationError;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught!.eventName).toBe('orders.created');
      expect(Array.isArray(caught!.validationErrors)).toBe(true);
      expect(caught!.validationErrors.length).toBeGreaterThan(0);
    });

    it('fires onValidationError before throwing', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});
      const onValidationError = vi.fn();

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'strict',
        onValidationError,
      });

      await expect(publish(INVALID_PAYLOAD as never)).rejects.toThrow(ValidationError);
      expect(onValidationError).toHaveBeenCalledOnce();
    });

    it('calls publishFn for a valid payload', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'strict',
      });

      await publish(VALID_PAYLOAD);
      expect(publishFn).toHaveBeenCalledWith(VALID_PAYLOAD);
    });

    it('does NOT fire onValidationError for a valid payload', async () => {
      const reg = makeRegistry();
      const publishFn = vi.fn(async () => {});
      const onValidationError = vi.fn();

      const publish = createValidatingPublisher(reg, 'orders.created', publishFn, {
        mode: 'strict',
        onValidationError,
      });

      await publish(VALID_PAYLOAD);
      expect(onValidationError).not.toHaveBeenCalled();
    });
  });
});

describe('createPublisher', () => {
  it('uses the provided registry instance', async () => {
    const reg = makeRegistry();
    const validateSpy = vi.spyOn(reg, 'validate');
    const publishFn = vi.fn(async () => {});

    const publish = createPublisher('orders.created', publishFn, {
      registry: reg,
      mode: 'strict',
    });

    await publish({ orderId: 'o-1', amount: 10 });

    expect(validateSpy).toHaveBeenCalledWith('orders.created', { orderId: 'o-1', amount: 10 });
    expect(publishFn).toHaveBeenCalledOnce();
  });

  it('falls back to a fresh in-memory Registry when no registry is provided', async () => {
    const publishFn = vi.fn(async () => {});

    // No registry supplied — fresh registry has no declarations, so
    // 'warn' mode fires onValidationError but still publishes.
    const onValidationError = vi.fn();
    const publish = createPublisher('unknown.event', publishFn, {
      mode: 'warn',
      onValidationError,
    });

    await publish({ foo: 'bar' });

    expect(publishFn).toHaveBeenCalledOnce();
    expect(onValidationError).toHaveBeenCalledOnce();
  });

  it('respects ValidationMode passed through options', async () => {
    const reg = makeRegistry();
    const publishFn = vi.fn(async () => {});

    const publish = createPublisher('orders.created', publishFn, {
      registry: reg,
      mode: 'strict',
    });

    await expect(
      publish({ orderId: 999 } as never),
    ).rejects.toThrow(ValidationError);
    expect(publishFn).not.toHaveBeenCalled();
  });

  it('passes valid payload through in off mode', async () => {
    const reg = makeRegistry();
    const publishFn = vi.fn(async () => {});

    const publish = createPublisher('orders.created', publishFn, {
      registry: reg,
      mode: 'off',
    });

    await publish({ orderId: 'x', amount: 5 });
    expect(publishFn).toHaveBeenCalledOnce();
  });
});
