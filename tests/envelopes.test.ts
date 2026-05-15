import { describe, it, expect } from 'vitest';
import { JsonSchemaValidator } from 'distributed-core/messaging-queue';
import {
  buildChannelMessageEnvelope,
  buildSignalMessage,
  isChannelMessageEnvelope,
  channelMessageRedisChannel,
  channelNodesRedisKey,
  signalMessageSchema,
  channelMessageEnvelopeSchema,
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

describe('JSON Schemas (Phase E2.1 close-out)', () => {
  const validator = new JsonSchemaValidator({ mode: 'auto' });

  const canonicalSignalMessage = {
    type: 'social:post',
    channel: 'room-1',
    payload: { id: 'p-1' },
    timestamp: '2026-05-15T12:00:00.000Z',
  };
  const canonicalEnvelope = {
    type: 'channel_message',
    channel: 'room-1',
    message: canonicalSignalMessage,
    excludeClientId: null,
    fromNode: 'platform-api',
    seq: 0,
    timestamp: '2026-05-15T12:00:00.000Z',
  };

  describe('signalMessageSchema', () => {
    it('accepts the canonical builder output', () => {
      const out = buildSignalMessage({ eventName: 'doc:edit', channel: 'd-1', payload: { x: 1 } });
      const r = validator.validate(signalMessageSchema as unknown as Record<string, unknown>, out);
      expect(r.ok).toBe(true);
    });

    it('rejects missing `type`', () => {
      const r = validator.validate(
        signalMessageSchema as unknown as Record<string, unknown>,
        { channel: 'r', payload: {}, timestamp: '2026-05-15T00:00:00.000Z' },
      );
      expect(r.ok).toBe(false);
    });

    it('rejects non-string `channel`', () => {
      const r = validator.validate(
        signalMessageSchema as unknown as Record<string, unknown>,
        { ...canonicalSignalMessage, channel: 42 },
      );
      expect(r.ok).toBe(false);
    });
  });

  describe('channelMessageEnvelopeSchema', () => {
    it('accepts the canonical builder output', () => {
      const env = buildChannelMessageEnvelope({
        channel: 'room-1',
        message: canonicalSignalMessage,
        fromNode: 'platform-api',
        timestamp: '2026-05-15T12:00:00.000Z',
      });
      const r = validator.validate(channelMessageEnvelopeSchema as unknown as Record<string, unknown>, env);
      expect(r.ok).toBe(true);
    });

    it('accepts an envelope with targetNodes (optional field)', () => {
      const env = buildChannelMessageEnvelope({
        channel: 'room-1',
        message: canonicalSignalMessage,
        fromNode: 'platform-api',
        targetNodes: ['node-A', 'node-B'],
      });
      const r = validator.validate(channelMessageEnvelopeSchema as unknown as Record<string, unknown>, env);
      expect(r.ok).toBe(true);
    });

    it('rejects envelope missing required `fromNode`', () => {
      const broken = { ...canonicalEnvelope } as Record<string, unknown>;
      delete broken.fromNode;
      const r = validator.validate(channelMessageEnvelopeSchema as unknown as Record<string, unknown>, broken);
      expect(r.ok).toBe(false);
    });

    it('rejects envelope with non-number `seq`', () => {
      const r = validator.validate(
        channelMessageEnvelopeSchema as unknown as Record<string, unknown>,
        { ...canonicalEnvelope, seq: '0' },
      );
      expect(r.ok).toBe(false);
    });

    it('rejects envelope with `excludeClientId` of wrong type', () => {
      const r = validator.validate(
        channelMessageEnvelopeSchema as unknown as Record<string, unknown>,
        { ...canonicalEnvelope, excludeClientId: 42 },
      );
      expect(r.ok).toBe(false);
    });

    it('rejects envelope where `type` is not the const "channel_message"', () => {
      const r = validator.validate(
        channelMessageEnvelopeSchema as unknown as Record<string, unknown>,
        { ...canonicalEnvelope, type: 'direct_message' },
      );
      expect(r.ok).toBe(false);
    });

    it('rejects envelope with `targetNodes` of wrong item type', () => {
      const r = validator.validate(
        channelMessageEnvelopeSchema as unknown as Record<string, unknown>,
        { ...canonicalEnvelope, targetNodes: [1, 2, 3] },
      );
      expect(r.ok).toBe(false);
    });

    it('rejects envelope with extra top-level fields (additionalProperties: false)', () => {
      const r = validator.validate(
        channelMessageEnvelopeSchema as unknown as Record<string, unknown>,
        { ...canonicalEnvelope, unexpected: 'value' },
      );
      expect(r.ok).toBe(false);
    });
  });
});
