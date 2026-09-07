import type { EventDeclaration } from '../../types/index';
/**
 * Generic error frame sent when any service encounters a client-visible error.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): the gateway dist
 * services emit TWO error-envelope shapes on the wire, both modelled here:
 *   - NESTED (chat / reaction / cursor / crdt): { type:'error', service,
 *     error:{ code, message, service, clientId, timestamp } } — via
 *     createErrorResponse/sendError.
 *   - FLAT (presence / activity): { type:'error', service, message } — these
 *     services have no ErrorCodes/createErrorResponse and send a bare message.
 * Both top-level `message` (flat) and the nested `error` object are therefore
 * declared optional; `service` names the originating service in both shapes.
 */
export declare const wsError: EventDeclaration;
//# sourceMappingURL=error.d.ts.map