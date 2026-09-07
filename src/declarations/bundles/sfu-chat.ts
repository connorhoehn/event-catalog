// src/declarations/bundles/sfu-chat.ts
//
// "sfu-chat" FeatureBundle — the SFU's in-channel chat bus.
//
// These five events travel the Redis channel `chat-bus:<channelArn>`
// (src/declarations/sfu/chat-bus.ts). They are a separate bus from the
// `stream-events` hub covered by sfu-control-plane, and a separate
// adoption decision: a deployment can run SFU video with chat disabled.
//
// NOTE for consumers: this is the SFU's IVS-compatible chat, NOT the
// gateway's `ws.chat.*` chat (the `chat` bundle). The two are unrelated
// wire protocols with different key casing — see the header of
// src/declarations/sfu/chat-bus.ts.
//
// Transport: 'signal'.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'sfu-chat',
  version: '1.0.0',
  transport: 'signal',
  description:
    'SFU in-channel chat bus (Redis `chat-bus:<channelArn>`) — IVS-wire-protocol messages, '
    + 'deletions, and moderation events. Distinct from the gateway `chat` bundle (ws.chat.*); '
    + 'the two are different protocols and are not interchangeable.',
  events: [
    { name: 'sfu.chat.message',            required: true  },
    { name: 'sfu.chat.message_deleted',    required: true  },
    { name: 'sfu.chat.user_disconnected',  required: true  },
    // Moderation — optional, only emitted when moderation is enabled
    { name: 'sfu.chat.user.banned',        required: false },
    { name: 'sfu.chat.user.unbanned',      required: false },
  ],
};

export const sfuChatBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
