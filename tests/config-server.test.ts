// tests/config-server.test.ts
//
// The validated boot-config gate (src/cli/config.ts). Each case below is a
// real misconfiguration that previously reached the runtime: NaN ports,
// an unset REDIS_URL quietly dialling localhost from inside a container,
// `SUBSCRIBER_TTL_SECONDS=abc` producing a NaN sweep window, and
// `EVENT_CATALOG_STRICT=1` silently meaning "not strict".

import { describe, it, expect } from 'vitest';
import {
  resolveServerConfig,
  describeConfig,
  redactUrl,
  DEFAULT_PORT,
  DEFAULT_MESSAGE_QUEUE_URL,
  DEFAULT_DLQ_TABLE_NAME,
  DEFAULT_SUBSCRIBER_TTL_SECONDS,
  DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS,
} from '../src/cli/config.js';

const REDIS = 'redis://localhost:6379';

it('resolves MQ signing separately and never includes the secret in diagnostics', () => {
  const secret = '  test-receiver-specific-secret  ';
  const result = resolveServerConfig({ REDIS_URL: REDIS, MQ_SERVICE_AUTH_SECRET: secret });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected valid config');
  expect(result.config.messageQueueAuthSecret).toBe(secret);
  expect(describeConfig(result.config).join('\n')).not.toContain(secret);
});

/** Minimum viable environment — everything else is defaulted. */
function baseEnv(extra: Record<string, string | undefined> = {}) {
  return { REDIS_URL: REDIS, ...extra };
}

function expectOk(result: ReturnType<typeof resolveServerConfig>) {
  if (!result.ok) throw new Error(`expected ok, got errors:\n${result.errors.join('\n')}`);
  return result;
}

function expectErrors(result: ReturnType<typeof resolveServerConfig>): string[] {
  if (result.ok) throw new Error('expected failure, got a resolved config');
  return result.errors;
}

describe('resolveServerConfig() — defaults', () => {
  it('resolves with only REDIS_URL set', () => {
    const { config, warnings } = expectOk(resolveServerConfig(baseEnv()));
    expect(config).toMatchObject({
      port: DEFAULT_PORT,
      hostname: '127.0.0.1',
      redisUrl: REDIS,
      messageQueueUrl: DEFAULT_MESSAGE_QUEUE_URL,
      dlqTableName: DEFAULT_DLQ_TABLE_NAME,
      subscriberTtlSeconds: DEFAULT_SUBSCRIBER_TTL_SECONDS,
      redisBootConnectAttempts: DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS,
      strict: false,
    });
    // Defaulting the durable transport is a warning, never a failure.
    expect(warnings.join('\n')).toContain('MESSAGE_QUEUE_URL');
  });

  it('binds loopback by default; HOST=0.0.0.0 opens it for a container', () => {
    expect(expectOk(resolveServerConfig(baseEnv())).config.hostname).toBe('127.0.0.1');
    expect(expectOk(resolveServerConfig(baseEnv({ HOST: '0.0.0.0' }))).config.hostname)
      .toBe('0.0.0.0');
  });

  it('treats an empty env var as unset rather than as a value', () => {
    const { config } = expectOk(resolveServerConfig(baseEnv({ PORT: '   ', HOST: '' })));
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.hostname).toBe('127.0.0.1');
  });
});

describe('resolveServerConfig() — REDIS_URL is required', () => {
  it('fails with an actionable message when unset', () => {
    const errors = expectErrors(resolveServerConfig({}));
    const joined = errors.join('\n');
    expect(joined).toContain('$REDIS_URL is required');
    expect(joined).toContain('--redis-url');
    expect(joined).toContain('redis://');
  });

  it('fails when set to something that is not a URL', () => {
    expect(expectErrors(resolveServerConfig({ REDIS_URL: 'localhost:6379' })).join('\n'))
      .toContain('$REDIS_URL');
  });

  it('rejects a non-redis scheme instead of handing it to node-redis', () => {
    const joined = expectErrors(resolveServerConfig({ REDIS_URL: 'http://localhost:6379' })).join('\n');
    expect(joined).toContain('redis://');
    expect(joined).toContain('http://');
  });

  it('accepts rediss:// for TLS', () => {
    expect(expectOk(resolveServerConfig({ REDIS_URL: 'rediss://cache.internal:6380' })).config.redisUrl)
      .toBe('rediss://cache.internal:6380');
  });

  it('is satisfied by --redis-url with no env var at all', () => {
    expect(expectOk(resolveServerConfig({}, { 'redis-url': REDIS })).config.redisUrl).toBe(REDIS);
  });
});

describe('resolveServerConfig() — port', () => {
  it.each(['abc', '', ' ', '80.5', '1e3', '0x50', '-1', '65536', 'NaN'])(
    'rejects --port=%o instead of binding NaN',
    raw => {
      const errors = expectErrors(resolveServerConfig(baseEnv(), { port: raw }));
      expect(errors.join('\n')).toContain('--port');
    },
  );

  it('names $PORT when the bad value came from the environment', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ PORT: 'abc' }))).join('\n'))
      .toContain('$PORT');
  });

  it('accepts 0 (ephemeral port, used by the test harness)', () => {
    expect(expectOk(resolveServerConfig(baseEnv(), { port: '0' })).config.port).toBe(0);
  });

  it('honours $EVENT_CATALOG_PORT, the name the deploy docs use', () => {
    expect(expectOk(resolveServerConfig(baseEnv({ EVENT_CATALOG_PORT: '4010' }))).config.port)
      .toBe(4010);
  });

  it('validates $EVENT_CATALOG_PORT by that name', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ EVENT_CATALOG_PORT: 'abc' }))).join('\n'))
      .toContain('$EVENT_CATALOG_PORT');
  });

  it('prefers $PORT and warns when the two disagree', () => {
    const { config, warnings } = expectOk(
      resolveServerConfig(baseEnv({ PORT: '3010', EVENT_CATALOG_PORT: '4010' })),
    );
    expect(config.port).toBe(3010);
    expect(warnings.join('\n')).toContain('EVENT_CATALOG_PORT');
  });

  it('lets --port win over $PORT', () => {
    expect(expectOk(resolveServerConfig(baseEnv({ PORT: '3010' }), { port: '4000' })).config.port)
      .toBe(4000);
  });
});

describe('resolveServerConfig() — message-queue URL', () => {
  it('rejects a non-http scheme', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ MESSAGE_QUEUE_URL: 'redis://mq:3004' }))).join('\n'))
      .toContain('$MESSAGE_QUEUE_URL');
  });

  it('rejects a bare host:port', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ MESSAGE_QUEUE_URL: 'mq:3004' }))).join('\n'))
      .toContain('$MESSAGE_QUEUE_URL');
  });

  it('does not warn once it is set explicitly', () => {
    const { warnings } = expectOk(
      resolveServerConfig(baseEnv({ MESSAGE_QUEUE_URL: 'http://message-queue:3004' })),
    );
    expect(warnings.join('\n')).not.toContain('MESSAGE_QUEUE_URL');
  });
});

describe('resolveServerConfig() — numeric knobs', () => {
  it.each(['abc', '-1', '1.5'])('rejects SUBSCRIBER_TTL_SECONDS=%o', raw => {
    expect(expectErrors(resolveServerConfig(baseEnv({ SUBSCRIBER_TTL_SECONDS: raw }))).join('\n'))
      .toContain('$SUBSCRIBER_TTL_SECONDS');
  });

  it('accepts 0 as "sweeper disabled"', () => {
    expect(expectOk(resolveServerConfig(baseEnv({ SUBSCRIBER_TTL_SECONDS: '0' }))).config
      .subscriberTtlSeconds).toBe(0);
  });

  it.each(['abc', '0', '-3'])('rejects REDIS_BOOT_CONNECT_ATTEMPTS=%o', raw => {
    expect(expectErrors(resolveServerConfig(baseEnv({ REDIS_BOOT_CONNECT_ATTEMPTS: raw }))).join('\n'))
      .toContain('$REDIS_BOOT_CONNECT_ATTEMPTS');
  });
});

describe('resolveServerConfig() — booleans and optional URLs', () => {
  it.each([['true', true], ['1', true], ['YES', true], ['on', true],
    ['false', false], ['0', false], ['off', false]] as const)(
    'reads EVENT_CATALOG_STRICT=%o as %o',
    (raw, expected) => {
      expect(expectOk(resolveServerConfig(baseEnv({ EVENT_CATALOG_STRICT: raw }))).config.strict)
        .toBe(expected);
    },
  );

  it('rejects an ambiguous EVENT_CATALOG_STRICT rather than guessing', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ EVENT_CATALOG_STRICT: 'maybe' }))).join('\n'))
      .toContain('$EVENT_CATALOG_STRICT');
  });

  it('rejects a malformed ALERT_WEBHOOK_URL', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ ALERT_WEBHOOK_URL: 'not a url' }))).join('\n'))
      .toContain('$ALERT_WEBHOOK_URL');
  });

  it('rejects a malformed DYNAMODB_ENDPOINT and names that variable', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ DYNAMODB_ENDPOINT: 'localhost:4566' }))).join('\n'))
      .toContain('$DYNAMODB_ENDPOINT');
  });

  it('falls back to LOCALSTACK_ENDPOINT and names it in the error', () => {
    expect(expectErrors(resolveServerConfig(baseEnv({ LOCALSTACK_ENDPOINT: 'nope' }))).join('\n'))
      .toContain('$LOCALSTACK_ENDPOINT');
  });
});

describe('resolveServerConfig() — reporting', () => {
  it('reports every problem at once so one restart surfaces them all', () => {
    const errors = expectErrors(resolveServerConfig({
      PORT: 'abc',
      SUBSCRIBER_TTL_SECONDS: 'nope',
      EVENT_CATALOG_STRICT: 'sometimes',
    }));
    const joined = errors.join('\n');
    expect(errors.length).toBe(4);
    for (const name of ['$PORT', '$REDIS_URL', '$SUBSCRIBER_TTL_SECONDS', '$EVENT_CATALOG_STRICT']) {
      expect(joined).toContain(name);
    }
  });

  it('never throws, whatever the input', () => {
    expect(() => resolveServerConfig({ REDIS_URL: '://', PORT: ' ' })).not.toThrow();
  });
});

describe('describeConfig() / redactUrl()', () => {
  it('keeps Redis credentials out of the startup banner', () => {
    const { config } = expectOk(
      resolveServerConfig({ REDIS_URL: 'redis://admin:hunter2@cache:6379' }),
    );
    const banner = describeConfig(config).join('\n');
    expect(banner).not.toContain('hunter2');
    expect(banner).not.toContain('admin');
    expect(banner).toContain('cache:6379');
  });

  it('leaves a credential-free URL alone', () => {
    expect(redactUrl('http://message-queue:3004')).toContain('message-queue:3004');
  });

  it('returns unparseable input unchanged rather than throwing', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});
