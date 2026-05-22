// src/declarations/orgiq-signal.ts
//
// OrgIQ channel event declarations — channel-scoped signal events for the
// OrgIQ newsroom portal (aws-agentcore).
//
// OrgIQ consumes the following gateway channels:
//
//   newsroom-researcher  — researcher assistant page; presence + activity
//   newsroom-briefs      — briefs generation page; presence only
//   search               — global semantic search; presence only
//   invoke               — direct agent invocation page; presence only
//   newsroom-articles    — article detail page; reactions
//
// These declarations bind the existing generic ws.* signal events to
// OrgIQ-specific channel names so drift detection and the registry
// snapshot capture OrgIQ's surface area explicitly.  Each entry uses
// the channel-scoped naming convention:
//
//   orgiq.<channel>.<capability>
//
// Transport: 'signal' — all frames are ephemeral WS push.
// Producer:  'orgiq-middleware' — the orgiq-middleware Express service
//             writes presence/activity events via publishToChannel; the
//             gateway fan-out service generates the ws.* frames that reach
//             the portal.
//
// Cross-reference: portal/src/pages/newsroom/*.tsx, portal/src/pages/*.tsx

import type { EventDeclaration } from '../types/index';

const PRODUCER = 'orgiq-middleware';
const TAGS_BASE = ['orgiq', 'signal', `producer:${PRODUCER}`];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal signal-frame schema with an explicit `type` field. */
function orgiqSchema(
    typeLiteral: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            type:      { type: 'string', const: typeLiteral },
            channel:   { type: 'string', description: 'Gateway channel name' },
            timestamp: { type: 'string', description: 'ISO-8601' },
            ...extra,
        },
        required: ['type', 'channel', ...required],
        additionalProperties: true,
    };
}

// ===========================================================================
// newsroom-researcher channel
// ===========================================================================

/**
 * Presence subscription on the newsroom-researcher channel.
 * Fired by usePresence('newsroom-researcher') in ResearcherPage.
 */
export const orgiqResearcherPresence: EventDeclaration = {
    namespace: 'orgiq',
    name: 'orgiq.newsroom-researcher.presence',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presence roster for the newsroom researcher assistant page. Consumed by usePresence("newsroom-researcher") in ResearcherPage.',
    tags: [...TAGS_BASE, 'presence', 'newsroom'],
    schema: orgiqSchema('presence', {
        action: { type: 'string', enum: ['set', 'update', 'subscribed', 'unsubscribed', 'offline'] },
        userId: { type: 'string' },
    }),
};

/**
 * Activity feed events on the newsroom-researcher channel.
 * Fired by useActivity('newsroom-researcher') in ResearcherPage.
 */
export const orgiqResearcherActivity: EventDeclaration = {
    namespace: 'orgiq',
    name: 'orgiq.newsroom-researcher.activity',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Activity feed events for the newsroom researcher channel. Consumed by useActivity("newsroom-researcher") in ResearcherPage.',
    tags: [...TAGS_BASE, 'activity', 'newsroom'],
    schema: orgiqSchema('activity', {
        action: { type: 'string', enum: ['subscribed', 'unsubscribed', 'event', 'history', 'published'] },
        eventType: { type: 'string', description: 'Application-level activity event type, e.g. search.started' },
        userId:    { type: 'string' },
    }),
};

// ===========================================================================
// newsroom-briefs channel
// ===========================================================================

/**
 * Presence subscription on the newsroom-briefs channel.
 * Fired by usePresence('newsroom-briefs') in BriefsPage.
 */
export const orgiqBriefsPresence: EventDeclaration = {
    namespace: 'orgiq',
    name: 'orgiq.newsroom-briefs.presence',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presence roster for the newsroom briefs generation page. Consumed by usePresence("newsroom-briefs") in BriefsPage.',
    tags: [...TAGS_BASE, 'presence', 'newsroom'],
    schema: orgiqSchema('presence', {
        action: { type: 'string', enum: ['set', 'update', 'subscribed', 'unsubscribed', 'offline'] },
        userId: { type: 'string' },
    }),
};

// ===========================================================================
// search channel
// ===========================================================================

/**
 * Presence subscription on the search channel.
 * Fired by usePresence('search') in SearchPage.
 */
export const orgiqSearchPresence: EventDeclaration = {
    namespace: 'orgiq',
    name: 'orgiq.search.presence',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presence roster for the global semantic search page. Consumed by usePresence("search") in SearchPage.',
    tags: [...TAGS_BASE, 'presence'],
    schema: orgiqSchema('presence', {
        action: { type: 'string', enum: ['set', 'update', 'subscribed', 'unsubscribed', 'offline'] },
        userId: { type: 'string' },
    }),
};

// ===========================================================================
// invoke channel
// ===========================================================================

/**
 * Presence subscription on the invoke channel.
 * Fired by usePresence('invoke') in InvokePage.
 */
export const orgiqInvokePresence: EventDeclaration = {
    namespace: 'orgiq',
    name: 'orgiq.invoke.presence',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presence roster for the direct agent invocation page. Consumed by usePresence("invoke") in InvokePage.',
    tags: [...TAGS_BASE, 'presence'],
    schema: orgiqSchema('presence', {
        action: { type: 'string', enum: ['set', 'update', 'subscribed', 'unsubscribed', 'offline'] },
        userId: { type: 'string' },
    }),
};

// ===========================================================================
// newsroom-articles channel  (reactions — Phase 1.4 Gap 4)
// ===========================================================================

/**
 * Reaction events on the newsroom-articles channel.
 * Fired by useReactions('newsroom-articles') in ArticleDetailPage.
 * Each reaction carries the articleId as the targetId field so the portal
 * can filter per-article reactions from the shared channel reaction stream.
 */
export const orgiqArticlesReactions: EventDeclaration = {
    namespace: 'orgiq',
    name: 'orgiq.newsroom-articles.reactions',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emoji reactions on newsroom articles. Consumed by useReactions("newsroom-articles") in ArticleDetailPage; targetId carries the article ID.',
    tags: [...TAGS_BASE, 'reactions', 'newsroom'],
    schema: orgiqSchema('reaction', {
        action:   { type: 'string', enum: ['subscribed', 'received', 'removed', 'list', 'sent'] },
        emoji:    { type: 'string', description: 'Single emoji character, e.g. "👍"' },
        targetId: { type: 'string', description: 'Article ID this reaction is attached to' },
        userId:   { type: 'string' },
    }),
};

// ===========================================================================
// Aggregate export
// ===========================================================================

/** All OrgIQ channel-scoped signal declarations. */
export const orgiqSignalDeclarations: readonly EventDeclaration[] = [
    orgiqResearcherPresence,
    orgiqResearcherActivity,
    orgiqBriefsPresence,
    orgiqSearchPresence,
    orgiqInvokePresence,
    orgiqArticlesReactions,
];
