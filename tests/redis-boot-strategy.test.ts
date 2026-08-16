import { describe, it, expect } from 'vitest';
import {
  createBootBoundedReconnectStrategy,
  resolveBootConnectAttempts,
  formatRedisError,
  DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS,
} from '../src/utils/redis-boot-strategy';

describe('resolveBootConnectAttempts()', () => {
  it('defaults when the env var is unset', () => {
    expect(resolveBootConnectAttempts({})).toBe(DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS);
  });

  it('defaults when the env var is empty', () => {
    expect(resolveBootConnectAttempts({ REDIS_BOOT_CONNECT_ATTEMPTS: '' }))
      .toBe(DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS);
  });

  it('honors a valid override', () => {
    expect(resolveBootConnectAttempts({ REDIS_BOOT_CONNECT_ATTEMPTS: '7' })).toBe(7);
  });

  it('floors a fractional override', () => {
    expect(resolveBootConnectAttempts({ REDIS_BOOT_CONNECT_ATTEMPTS: '4.9' })).toBe(4);
  });

  it.each(['garbage', '0', '-3'])('falls back to the default for %o', raw => {
    expect(resolveBootConnectAttempts({ REDIS_BOOT_CONNECT_ATTEMPTS: raw }))
      .toBe(DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS);
  });
});

describe('createBootBoundedReconnectStrategy()', () => {
  it('backs off with retries * baseMs while under the boot budget', () => {
    const { reconnectStrategy } = createBootBoundedReconnectStrategy({
      bootAttempts: 5,
      baseMs: 100,
      maxMs: 3_000,
    });

    expect(reconnectStrategy(0)).toBe(0);
    expect(reconnectStrategy(1)).toBe(100);
    expect(reconnectStrategy(2)).toBe(200);
  });

  it('caps the backoff at maxMs', () => {
    const { reconnectStrategy } = createBootBoundedReconnectStrategy({
      bootAttempts: 1_000,
      baseMs: 100,
      maxMs: 250,
    });

    expect(reconnectStrategy(50)).toBe(250);
  });

  it('returns an Error once the boot budget is exhausted — this is what lets '
    + 'the pending connect() reject so the caller can degrade', () => {
    const { reconnectStrategy } = createBootBoundedReconnectStrategy({
      bootAttempts: 3,
      label: 'registry',
    });

    // retries counts RE-attempts, so retries=2 is the 3rd total attempt.
    expect(reconnectStrategy(0)).toEqual(expect.any(Number));
    expect(reconnectStrategy(1)).toEqual(expect.any(Number));

    const giveUp = reconnectStrategy(2);
    expect(giveUp).toBeInstanceOf(Error);
    expect((giveUp as Error).message).toContain('registry');
    expect((giveUp as Error).message).toContain('3 attempt(s)');
  });

  it('gives up immediately when only one attempt is budgeted', () => {
    const { reconnectStrategy } = createBootBoundedReconnectStrategy({ bootAttempts: 1 });
    expect(reconnectStrategy(0)).toBeInstanceOf(Error);
  });

  it('reverts to infinite capped backoff after markConnected() — a post-boot '
    + 'Redis blip must never kill the process', () => {
    const strategy = createBootBoundedReconnectStrategy({
      bootAttempts: 3,
      baseMs: 100,
      maxMs: 3_000,
    });

    expect(strategy.reconnectStrategy(2)).toBeInstanceOf(Error);

    strategy.markConnected();

    // Same retry count that previously gave up now backs off forever.
    expect(strategy.reconnectStrategy(2)).toBe(200);
    expect(strategy.reconnectStrategy(9_999)).toBe(3_000);
  });

  it('uses the env-resolved budget when bootAttempts is omitted', () => {
    const { reconnectStrategy } = createBootBoundedReconnectStrategy();
    // Default budget is 3, so retries=2 exhausts it.
    expect(reconnectStrategy(DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS - 1)).toBeInstanceOf(Error);
  });
});

describe('formatRedisError()', () => {
  it('uses a non-empty message directly', () => {
    expect(formatRedisError(new Error('boom'))).toBe('boom');
  });

  it('digs causes out of an AggregateError whose own message is empty — the '
    + 'exact shape that produced the blank "registry Redis error:" log line', () => {
    const agg = new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:6379'),
        new Error('connect ECONNREFUSED 127.0.0.1:6379'),
      ],
      '',
    );

    expect(formatRedisError(agg))
      .toBe('connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379');
  });

  it('dedupes identical causes from a dual-stack DNS result', () => {
    const agg = new AggregateError(
      [new Error('connect ECONNREFUSED'), new Error('connect ECONNREFUSED')],
      '',
    );

    expect(formatRedisError(agg)).toBe('connect ECONNREFUSED');
  });

  it('falls back to the errno code when there is no message or cause', () => {
    expect(formatRedisError({ message: '', code: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
  });

  it.each([null, undefined])('handles %o', value => {
    expect(formatRedisError(value)).toBe('unknown error');
  });

  it('never returns an empty string for an opaque object', () => {
    expect(formatRedisError({})).toBe('unknown error');
  });

  it('stringifies a non-Error primitive', () => {
    expect(formatRedisError('plain string failure')).toBe('plain string failure');
  });
});
