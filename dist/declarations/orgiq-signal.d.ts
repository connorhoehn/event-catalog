import type { EventDeclaration } from '../types/index';
/**
 * Presence subscription on the newsroom-researcher channel.
 * Fired by usePresence('newsroom-researcher') in ResearcherPage.
 */
export declare const orgiqResearcherPresence: EventDeclaration;
/**
 * Activity feed events on the newsroom-researcher channel.
 * Fired by useActivity('newsroom-researcher') in ResearcherPage.
 */
export declare const orgiqResearcherActivity: EventDeclaration;
/**
 * Presence subscription on the newsroom-briefs channel.
 * Fired by usePresence('newsroom-briefs') in BriefsPage.
 */
export declare const orgiqBriefsPresence: EventDeclaration;
/**
 * Presence subscription on the search channel.
 * Fired by usePresence('search') in SearchPage.
 */
export declare const orgiqSearchPresence: EventDeclaration;
/**
 * Presence subscription on the invoke channel.
 * Fired by usePresence('invoke') in InvokePage.
 */
export declare const orgiqInvokePresence: EventDeclaration;
/**
 * Reaction events on the newsroom-articles channel.
 * Fired by useReactions('newsroom-articles') in ArticleDetailPage.
 * Each reaction carries the articleId as the targetId field so the portal
 * can filter per-article reactions from the shared channel reaction stream.
 */
export declare const orgiqArticlesReactions: EventDeclaration;
/** All OrgIQ channel-scoped signal declarations. */
export declare const orgiqSignalDeclarations: readonly EventDeclaration[];
//# sourceMappingURL=orgiq-signal.d.ts.map