"use strict";
// src/declarations/bundles/orgiq-newsroom.ts
//
// "orgiq-newsroom" FeatureBundle — the combined realtime surface used by the
// OrgIQ newsroom portal for collaborative research and article workflows.
//
// Channels:
//   newsroom-researcher  presence + activity  (ResearcherPage)
//   newsroom-briefs      presence             (BriefsPage)
//   search               presence             (SearchPage)
//   invoke               presence             (InvokePage)
//   newsroom-articles    reactions            (ArticleDetailPage)
//
// This bundle references ONLY the *generic* ws.* event names from
// gateway-signal.ts.
//
// The six channel-scoped `orgiq.*` declarations in orgiq-signal.ts are NOT
// members. An earlier version of this comment claimed the two "together give
// drift-detection full coverage" — nothing enforced that, and the orgiq.*
// events belong to no bundle at all today. Adding them would change this
// bundle's fingerprint and break CRDs pinned to orgiq-newsroom@1.0.0, so it
// is an orgiq-newsroom@2.0.0 decision, not a silent edit. Flagged in the
// bundle-layer audit; awaiting an operator call.
//
// Transport: 'signal' — all frames are ephemeral WS push via websocket-gateway.
// Version bump policy: bump whenever OrgIQ adopts a new gateway channel or
// realtime-modules hook (e.g. useChat, useFileUpload in Phase 2).
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgiqNewsroomBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'orgiq-newsroom',
    version: '1.0.0',
    transport: 'signal',
    description: 'OrgIQ newsroom realtime surface — presence on 4 channels (newsroom-researcher, newsroom-briefs, search, invoke), activity feed on newsroom-researcher, and emoji reactions on newsroom-articles.',
    events: [
        // presence — all four channels use these frames
        { name: 'ws.presence.set', required: true },
        { name: 'ws.presence.update', required: true },
        { name: 'ws.presence.subscribed', required: true },
        { name: 'ws.presence.unsubscribed', required: true },
        { name: 'ws.presence.data', required: true },
        { name: 'ws.presence.offline', required: true },
        // activity — newsroom-researcher channel
        { name: 'ws.activity.subscribed', required: true },
        { name: 'ws.activity.unsubscribed', required: true },
        { name: 'ws.activity.published', required: true },
        { name: 'ws.activity.history', required: true },
        { name: 'ws.activity.event', required: true },
        // reactions — newsroom-articles channel
        { name: 'ws.reaction.subscribed', required: true },
        { name: 'ws.reaction.sent', required: true },
        { name: 'ws.reaction.received', required: true },
        { name: 'ws.reaction.removed', required: true },
        { name: 'ws.reaction.list', required: true },
        // shared error frame
        { name: 'ws.error', required: false },
    ],
};
exports.orgiqNewsroomBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=orgiq-newsroom.js.map