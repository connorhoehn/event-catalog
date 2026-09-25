// src/declarations/client-frames/outbound-call.ts
//
// OUTBOUND (client → gateway) frames for document calls (2026-09-24),
// sent by realtime-modules useDocumentCall. The gateway's `call` service
// answers each with ws.call.call-meta.

import type { EventDeclaration } from '../../types/index';
import { CLIENT_PRODUCER, CLIENT_BASE_TAGS, clientFrameSchema } from './_shared';

/** Ask for a document call's meta (participants only). */
export const clientCallMeta: EventDeclaration = {
    namespace: 'client',
    name: 'client.call.meta',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Ask for a document call\'s live meta. The gateway replies to the sender only with ws.call.call-meta.',
    tags: [...CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: clientFrameSchema('call', 'meta', { callId: { type: 'string' } }, ['callId']),
};

/** Replace the review-document list (any participant). */
export const clientCallSetDocuments: EventDeclaration = {
    namespace: 'client',
    name: 'client.call.set-documents',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Replace a document call\'s review documents (host document stays first). Any participant. Broadcasts ws.call.call-meta.',
    tags: [...CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: clientFrameSchema('call', 'set-documents', {
        callId: { type: 'string' },
        documentIds: { type: 'array', items: { type: 'string' }, description: 'The new review list; the server puts the host document first.' },
        documentTitles: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional document id → title map for the list.' },
    }, ['callId', 'documentIds']),
};

/** Start (documentId) or stop (null) presenting. */
export const clientCallPresent: EventDeclaration = {
    namespace: 'client',
    name: 'client.call.present',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Present a review document, or stop with documentId null. Only the current presenter or the host may replace a presenter. Broadcasts ws.call.call-meta.',
    tags: [...CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: clientFrameSchema('call', 'present', {
        callId: { type: 'string' },
        documentId: { type: ['string', 'null'], description: 'Review document to present, or null to stop presenting.' },
    }, ['callId']),
};

/** Rename the call (host only). */
export const clientCallSetTitle: EventDeclaration = {
    namespace: 'client',
    name: 'client.call.set-title',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Rename a document call. Host only. Broadcasts ws.call.call-meta.',
    tags: [...CLIENT_BASE_TAGS, 'call', 'document-call'],
    schema: clientFrameSchema('call', 'set-title', {
        callId: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 200 },
    }, ['callId', 'title']),
};
