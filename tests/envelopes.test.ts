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
  buildDirectMessageEnvelope,
  directMessageRedisChannel,
  directMessageEnvelopeSchema,
  buildBroadcastEnvelope,
  broadcastRedisChannel,
  broadcastEnvelopeSchema,
  // wave20-a — decoder primitives + new type guards
  isDirectMessageEnvelope,
  isBroadcastEnvelope,
  decodeChannelMessageEnvelope,
  decodeDirectMessageEnvelope,
  decodeBroadcastEnvelope,
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

describe('buildDirectMessageEnvelope (wave18-b)', () => {
  it('produces the canonical direct-message shape with defaults', () => {
    const env = buildDirectMessageEnvelope({
      clientId: 'client-7',
      message: { kind: 'rpc', payload: { x: 1 } },
      fromNode: 'gw-A',
      targetNode: 'gw-B',
    });
    expect(env.type).toBe('direct_message');
    expect(env.clientId).toBe('client-7');
    expect(env.fromNode).toBe('gw-A');
    expect(env.targetNode).toBe('gw-B');
    expect(env.message).toEqual({ kind: 'rpc', payload: { x: 1 } });
    expect(typeof env.timestamp).toBe('string');
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('respects an explicit timestamp', () => {
    const ts = '2026-05-15T10:00:00.000Z';
    const env = buildDirectMessageEnvelope({
      clientId: 'c',
      message: {},
      fromNode: 'a',
      targetNode: 'b',
      timestamp: ts,
    });
    expect(env.timestamp).toBe(ts);
  });

  it('directMessageRedisChannel builds the per-node channel name', () => {
    expect(directMessageRedisChannel('gw-7')).toBe('websocket:direct:gw-7');
  });
});

describe('buildBroadcastEnvelope (wave18-b)', () => {
  it('produces the canonical broadcast shape with defaults', () => {
    const env = buildBroadcastEnvelope({
      message: { notice: 'system shutdown in 5m' },
      fromNode: 'gw-A',
    });
    expect(env.type).toBe('broadcast');
    expect(env.fromNode).toBe('gw-A');
    expect(env.excludeClientId).toBeNull();
    expect(env.message).toEqual({ notice: 'system shutdown in 5m' });
    expect(typeof env.timestamp).toBe('string');
  });

  it('passes through excludeClientId and timestamp when provided', () => {
    const env = buildBroadcastEnvelope({
      message: {},
      fromNode: 'gw-A',
      excludeClientId: 'client-42',
      timestamp: '2026-05-15T10:00:00.000Z',
    });
    expect(env.excludeClientId).toBe('client-42');
    expect(env.timestamp).toBe('2026-05-15T10:00:00.000Z');
  });

  it('broadcastRedisChannel is the fixed cluster-wide topic', () => {
    expect(broadcastRedisChannel).toBe('websocket:broadcast:all');
  });
});

describe('directMessageEnvelopeSchema + broadcastEnvelopeSchema (wave18-b)', () => {
  const validator = new JsonSchemaValidator({ mode: 'auto' });

  it('accepts canonical direct-message builder output', () => {
    const env = buildDirectMessageEnvelope({
      clientId: 'c-1', message: {}, fromNode: 'gw-A', targetNode: 'gw-B',
    });
    const r = validator.validate(directMessageEnvelopeSchema as unknown as Record<string, unknown>, env);
    expect(r.ok).toBe(true);
  });

  it('rejects direct-message envelope missing required `targetNode`', () => {
    const broken = buildDirectMessageEnvelope({
      clientId: 'c', message: {}, fromNode: 'gw-A', targetNode: 'gw-B',
    }) as Record<string, unknown>;
    delete broken.targetNode;
    const r = validator.validate(directMessageEnvelopeSchema as unknown as Record<string, unknown>, broken);
    expect(r.ok).toBe(false);
  });

  it('rejects direct-message envelope with wrong `type` discriminator', () => {
    const env = buildDirectMessageEnvelope({
      clientId: 'c', message: {}, fromNode: 'a', targetNode: 'b',
    });
    const r = validator.validate(
      directMessageEnvelopeSchema as unknown as Record<string, unknown>,
      { ...env, type: 'broadcast' },
    );
    expect(r.ok).toBe(false);
  });

  it('accepts canonical broadcast builder output', () => {
    const env = buildBroadcastEnvelope({ message: {}, fromNode: 'gw-A' });
    const r = validator.validate(broadcastEnvelopeSchema as unknown as Record<string, unknown>, env);
    expect(r.ok).toBe(true);
  });

  it('rejects broadcast envelope with `excludeClientId` of wrong type', () => {
    const env = buildBroadcastEnvelope({ message: {}, fromNode: 'gw-A' });
    const r = validator.validate(
      broadcastEnvelopeSchema as unknown as Record<string, unknown>,
      { ...env, excludeClientId: 42 },
    );
    expect(r.ok).toBe(false);
  });
});

// ── wave20-a — runtime guards + decoder primitives ────────────────────

describe('isDirectMessageEnvelope (wave20-a)', () => {
  it('accepts canonical direct-message builder output', () => {
    const env = buildDirectMessageEnvelope({
      clientId: 'c1', message: {}, fromNode: 'a', targetNode: 'b',
    });
    expect(isDirectMessageEnvelope(env)).toBe(true);
  });

  it('rejects non-direct shapes', () => {
    expect(isDirectMessageEnvelope(null)).toBe(false);
    expect(isDirectMessageEnvelope({ type: 'broadcast' })).toBe(false);
    expect(isDirectMessageEnvelope({
      type: 'direct_message', clientId: 'c', message: {}, fromNode: 'a',
      /* no targetNode */ timestamp: 't',
    })).toBe(false);
  });
});

describe('isBroadcastEnvelope (wave20-a)', () => {
  it('accepts canonical broadcast builder output', () => {
    const env = buildBroadcastEnvelope({ message: {}, fromNode: 'gw' });
    expect(isBroadcastEnvelope(env)).toBe(true);
  });

  it('rejects non-broadcast shapes', () => {
    expect(isBroadcastEnvelope({ type: 'direct_message' })).toBe(false);
    expect(isBroadcastEnvelope({
      type: 'broadcast', fromNode: 'gw', timestamp: 't',
      /* missing message + excludeClientId */
    })).toBe(false);
    expect(isBroadcastEnvelope({
      type: 'broadcast', fromNode: 'gw', timestamp: 't',
      message: {}, excludeClientId: 42, // wrong type
    })).toBe(false);
  });
});

describe('decode helpers (wave20-a)', () => {
  it('decodeChannelMessageEnvelope returns ok on valid JSON of a valid envelope', () => {
    const env = buildChannelMessageEnvelope({
      channel: 'r',
      message: buildSignalMessage({ eventName: 'x', channel: 'r', payload: {} }),
      fromNode: 'gw',
    });
    const r = decodeChannelMessageEnvelope(JSON.stringify(env));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe('channel_message');
  });

  it('decodeChannelMessageEnvelope returns error on invalid JSON', () => {
    const r = decodeChannelMessageEnvelope('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid JSON/);
  });

  it('decodeChannelMessageEnvelope returns error when shape mismatches', () => {
    const r = decodeChannelMessageEnvelope(JSON.stringify({ type: 'broadcast' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/channel_message envelope/);
  });

  it('decodeDirectMessageEnvelope round-trips builder output', () => {
    const env = buildDirectMessageEnvelope({
      clientId: 'c1', message: { kind: 'rpc' }, fromNode: 'a', targetNode: 'b',
    });
    const r = decodeDirectMessageEnvelope(JSON.stringify(env));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.targetNode).toBe('b');
  });

  it('decodeBroadcastEnvelope round-trips builder output', () => {
    const env = buildBroadcastEnvelope({ message: { notice: 'hi' }, fromNode: 'gw' });
    const r = decodeBroadcastEnvelope(JSON.stringify(env));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.excludeClientId).toBeNull();
  });

  it('decodeBroadcastEnvelope rejects a channel_message envelope', () => {
    const env = buildChannelMessageEnvelope({
      channel: 'r',
      message: buildSignalMessage({ eventName: 'x', channel: 'r', payload: {} }),
      fromNode: 'gw',
    });
    const r = decodeBroadcastEnvelope(JSON.stringify(env));
    expect(r.ok).toBe(false);
  });
});
