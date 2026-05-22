import type { RedisClientType } from 'redis';
import { type AuditEvent } from './audit-emitter.js';
export interface AuditLogOptions {
    redis: RedisClientType;
    cap?: number;
}
/**
 * Wires the in-memory auditEmitter to a capped Redis list. Returns
 * an object with `recent(limit)` for HTTP queries and a `stop()` to
 * detach the listener on shutdown. Idempotent — calling twice
 * registers two listeners (caller's responsibility).
 */
export declare function startAuditLog(opts: AuditLogOptions): {
    recent(limit?: number): Promise<AuditEvent[]>;
    stop(): void;
};
//# sourceMappingURL=audit-log.d.ts.map