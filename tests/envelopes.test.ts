import { describe, it, expect } from 'vitest';
import {
  buildChannelMessageEnvelope,
  buildSignalMessage,
  isChannelMessageEnvelope,
  channelMessageRedisChannel,
  channelNodesRedisKey,
} from '../src/types/envelopes';

describe('buildSignalMessage', () => {
  it('produces the canonical inner shape with defaults', () => {
    const msg = buildSignalMessage({
      eventName: 'social:post',
      channel: 'room-1',
      payload: { id: 'p-1' },
    });
    expect(msg.type).toBe('social:post');
    expect(msg.channel).toBe('room-1');
    expect(msg.payload).toEqual({ id: 'p-1' });
    expect(typeof msg.timestamp).toBe('string');
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('respects an explicit timestamp', () => {
    const ts = '2026-05-13T00:00:00.000Z';
    const msg = buildSignalMessage({
      eventName: 'doc:section_updated',
      channel: 'doc-7',
      payload: {},
      timestamp: ts,
    });
    expect(msg.timestamp).toBe(ts);
  });
});

describe('buildChannelMessageEnvelope', () => {
  it('produces the canonical envelope shape with defaults', () => {
    const env = buildChannelMessageEnvelope({
      channel: 'room-1',
      message: { type: 'chat', channel: 'room-1', payload: {}, timestamp: '' },
      fromNode: 'platform-api',
    });
    expect(env.type).toBe('channel_message');
    expect(env.channel).toBe('room-1');
    expect(env.fromNode).toBe('platform-api');
    expect(env.seq).toBe(0);
    expect(env.excludeClientId).toBeNull();
    expect(env.targetNodes).toBeUndefined();
    expect(typeof env.timestamp).toBe('string');
  });

  it('includes targetNodes when provided', () => {
    const env = buildChannelMessageEnvelope({
      channel: 'room-1',
      message: { type: 'chat', channel: 'room-1', payload: {}, timestamp: '' },
      fromNode: 'platform-api',
      targetNodes: ['node-A', 'node-B'],
    });
    expect(env.targetNodes).toEqual(['node-A', 'node-B']);
  });

  it('passes through seq, excludeClientId, timestamp when provided', () => {
    const env = buildChannelMessageEnvelope({
      channel: 'room-1',
      message: 'inner' as unknown,
      fromNode: 'gateway-node-7',
      seq: 42,
      excludeClientId: 'client-9',
      timestamp: '2026-05-13T10:00:00.000Z',
    });
    expect(env.seq).toBe(42);
    expect(env.excludeClientId).toBe('client-9');
    expect(env.timestamp).toBe('2026-05-13T10:00:00.000Z');
  });
});

describe('isChannelMessageEnvelope', () => {
  it('recognises a valid envelope', () => {
    const env = buildChannelMessageEnvelope({
      channel: 'r',
      message: { type: 'x', channel: 'r', payload: {}, timestamp: '' },
      fromNode: 'gw',
    });
    expect(isChannelMessageEnvelope(env)).toBe(true);
  });

  it('rejects non-channel_message shapes', () => {
    expect(isChannelMessageEnvelope(null)).toBe(false);
    expect(isChannelMessageEnvelope(undefined)).toBe(false);
    expect(isChannelMessageEnvelope({})).toBe(false);
    expect(isChannelMessageEnvelope({ type: 'other' })).toBe(false);
    expect(isChannelMessageEnvelope({
      type: 'channel_message', channel: 'r', message: 'string-not-object',
      fromNode: 'x', seq: 0, timestamp: '',
    })).toBe(false);
  });
});

describe('redis key helpers', () => {
  it('builds the channel publish key', () => {
    expect(channelMessageRedisChannel('room-1')).toBe('websocket:route:room-1');
  });
  it('builds the channel-nodes set key', () => {
    expect(channelNodesRedisKey('room-1')).toBe('websocket:channel:room-1:nodes');
  });
});
