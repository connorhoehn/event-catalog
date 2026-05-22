import { EventEmitter } from 'node:events';
export type AuditEventKind = 'event.declared' | 'event.version.bumped' | 'event.removed' | 'event.deprecated' | 'event.undeprecated' | 'event.poisoned' | 'event.poison.cleared' | 'subscriber.added' | 'subscriber.removed' | 'event.manifest.drift';
export interface AuditEvent {
    kind: AuditEventKind;
    /** ISO 8601 timestamp at observation. */
    timestamp: string;
    /** Event name the mutation applies to. */
    eventName: string;
    /** Namespace from the canonical RegistryEntry (when known). */
    namespace?: string;
    /** Version number on event.declared / event.version.bumped. */
    version?: number;
    /** sha256 fingerprint when relevant (declared / version-bumped). */
    fingerprint?: string;
    /** Service name on subscriber.added / subscriber.removed. */
    serviceName?: string;
    /** Compat-violation list when a version bump landed in warn mode. */
    violations?: string[];
    /** wave25-a — operator-supplied reason on event.deprecated. */
    reason?: string;
    /** wave25-a — `by` field on event.deprecated (who marked it). */
    by?: string;
    /** wave23-c — consumer names + their now-stale pinned fingerprints. */
    affectedConsumers?: Array<{
        consumerName: string;
        pinnedFingerprint: string;
    }>;
}
export interface AuditFilter {
    kind?: AuditEventKind;
    eventName?: string;
    namespace?: string;
    serviceName?: string;
}
export declare function matchesAuditFilter(event: AuditEvent, filter: AuditFilter): boolean;
declare class AuditEmitter extends EventEmitter {
    publish(event: AuditEvent): void;
}
/** Module-singleton audit emitter. setMaxListeners(0) for SSE clients. */
export declare const auditEmitter: AuditEmitter;
export {};
//# sourceMappingURL=audit-emitter.d.ts.map