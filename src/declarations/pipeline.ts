// src/declarations/pipeline.ts
//
// Wave 1 / track EC-1 — canonical pipeline event declarations.
//
// Cross-service pipeline events that flow off `distributed-core`'s
// `PipelineExecutor` (a library, not a runtime service) and need a
// declaration somewhere so that consumers (gateway, platform-api,
// pipeline-worker) get a single source of truth for the wire shape.
//
// Producer is recorded as `distributed-core` for the colon-form signal
// emissions; durable counterparts (forwarded by platform-api in M4.4 v2)
// list `platform-api` as the durable producer.
//
// These three are the P0 set unblocking M4.4 v2 approval forwarding via
// the durable bus, identified in
// `websocket-gateway/.agent/EVENT_CATALOG_GAPS.md`. Subsequent EC tracks
// will declare the remaining ~27 colon-form pipeline events.

import type { EventDeclaration } from '../types/index';
import { annotateDeclarations, type FieldGlossary } from './field-glossary';

/**
 * Field meanings specific to the approval/checkpoint surface. Everything
 * else (runId, stepId, at, context …) comes from the common glossary.
 */
const FIELDS: FieldGlossary = {
  approvers: 'Approver descriptors eligible to act on this gate — `{type: user|role, value}`, NOT bare user ids. At least one. This is the field PipelineExecutor actually sends.',
  'approvers.type': 'Whether this approver is an individual user or a role/team.',
  'approvers.value': 'The user id or role name this approver resolves to.',
  'approvers.userId': 'Convenience alias for `value` when type is `user`; populated by UI surfaces that filter approval queues by user identity.',
  approverIds: 'User ids of every approver eligible to act on this gate. At least one. NEVER EMITTED — PipelineExecutor sends `approvers`.',
  approver: 'User id of the approver who recorded this decision. NEVER EMITTED — PipelineExecutor sends `userId`; kept declared because removal is breaking.',
  approvalId: 'Identifier of the approval gate that was resolved.',
  decision: 'The recorded outcome of the approval.',
  comment: 'Optional free-text reviewer note attached to the decision.',
  requestedAt: 'Epoch milliseconds at which the approval was requested. NEVER EMITTED — PipelineExecutor sends an ISO `at`.',
  decidedAt: 'Epoch milliseconds at which the approver recorded the decision. NEVER EMITTED — PipelineExecutor sends an ISO `at`.',
  resolvedAt: 'Epoch milliseconds at which the gate reached its final decision.',
  currentStepIds: 'Step ids on the run frontier — the steps in flight when the checkpoint was taken.',
};

/**
 * `pipeline.approval.requested` — emitted by `PipelineExecutor` when an
 * approval node is entered. Dual-transport: signal (in-process bus →
 * gateway WS frame) AND durable (M4.4 v2 forwards via SQS so workers
 * can pick up the request after a restart).
 *
 * The signal-side emission today uses the colon-form name
 * `pipeline:approval:requested` (PipelineExecutor.ts:1933) with payload
 * `{ runId, stepId, approvers, at }`. The durable wire-shape is the
 * canonical contract declared here.
 */
export const pipelineApprovalRequested: EventDeclaration = {
  namespace: 'pipeline',
  name: 'pipeline.approval.requested',
  description:
    'A pipeline approval node has been entered and is awaiting one or more '
    + 'approvers. Emitted on the in-process bus by distributed-core; forwarded '
    + 'onto the durable bus by platform-api (M4.4 v2) so workers and audit '
    + 'consumers receive it across restarts.',
  transport: 'both',
  producer: ['distributed-core', 'platform-api'],
  tags: ['pipeline', 'approval', 'p0'],
  schema: {
    type: 'object',
    properties: {
      runId: { type: 'string' },
      stepId: { type: 'string' },
      // What PipelineExecutor actually emits (:3088): `approvers` and an ISO
      // `at`. `approverIds`/`requestedAt` were declared and required, and are
      // sent by nothing — so this schema rejected the only payload that
      // exists, on both transports. They stay declared-but-optional because
      // removing a property is breaking under this repo's own compat gate.
      approvers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['user', 'role'] },
            value: { type: 'string' },
            userId: { type: 'string' },
          },
          required: ['type', 'value'],
          additionalProperties: true,
        },
        minItems: 1,
      },
      at: { type: 'string', format: 'date-time' },
      approverIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
      },
      requestedAt: { type: 'number' },
    },
    required: ['runId', 'stepId'],
    additionalProperties: true,
  },
  aliases: [
    { name: 'pipeline:approval:requested', deprecated: true },
  ],
};

/**
 * `pipeline.approval.recorded` — emitted when an approver records a
 * decision (approve / reject) against a pending approval. Dual-transport
 * for the same reason as `pipeline.approval.requested`.
 *
 * Signal-side emission uses colon-form `pipeline:approval:recorded`
 * (PipelineExecutor.ts:521/544/1979) with payload
 * `{ runId, stepId, userId, decision, comment?, reason?, at }`.
 */
export const pipelineApprovalRecorded: EventDeclaration = {
  namespace: 'pipeline',
  name: 'pipeline.approval.recorded',
  description:
    'An approver has recorded a decision against a pending pipeline '
    + 'approval. `decision` is the recorded outcome; `comment` carries an '
    + 'optional reviewer note. Dual-emitted on signal + durable so audit '
    + 'and worker consumers both see the decision.',
  transport: 'both',
  producer: ['distributed-core', 'platform-api'],
  tags: ['pipeline', 'approval', 'p0'],
  schema: {
    type: 'object',
    properties: {
      runId: { type: 'string' },
      stepId: { type: 'string' },
      // What PipelineExecutor actually emits (:1033, :1056): `userId` and an
      // ISO `at`, plus an optional `reason`. `approver`/`decidedAt` were
      // declared and REQUIRED and are sent by nothing, so this schema
      // rejected the only payload that exists — and being transport:'both'
      // meant the durable path could never publish it at all. The unused
      // pair stays declared-but-optional: removing a property is breaking
      // under this repo's own compat gate.
      userId: { type: 'string' },
      at: { type: 'string', format: 'date-time' },
      reason: { type: 'string' },
      approver: { type: 'string' },
      decision: { type: 'string', enum: ['approve', 'reject'] },
      comment: { type: 'string' },
      decidedAt: { type: 'number' },
    },
    required: ['runId', 'stepId', 'decision'],
    additionalProperties: true,
  },
  aliases: [
    { name: 'pipeline:approval:recorded', deprecated: true },
  ],
};

/**
 * `pipeline.approval.resolved` — emitted when the approval gate is fully
 * resolved: all required approvers have acted AND the aggregate decision
 * (approve or reject) is final. Distinct from `pipeline.approval.recorded`
 * which fires per-approver; this fires once per gate closure.
 *
 * Dual-transport (same reasoning as `.requested`): signal for real-time
 * dashboard updates, durable so downstream workers see the gate outcome
 * after a restart.
 */
export const pipelineApprovalResolved: EventDeclaration = {
  namespace: 'pipeline',
  name: 'pipeline.approval.resolved',
  description:
    'An approval gate has reached a final decision (all required approvers '
    + 'have acted). `decision` is the aggregate outcome; `by` is the deciding '
    + 'approver ID for single-approver gates or the last to vote for '
    + 'multi-approver gates.',
  transport: 'both',
  producer: ['distributed-core', 'platform-api'],
  tags: ['pipeline', 'approval', 'p0'],
  schema: {
    type: 'object',
    properties: {
      runId: { type: 'string' },
      stepId: { type: 'string' },
      approvalId: { type: 'string' },
      decision: { type: 'string', enum: ['approved', 'rejected'] },
      by: { type: 'string', description: 'User ID of the deciding (last) approver' },
      reason: { type: 'string', description: 'Optional human-readable rationale' },
      resolvedAt: { type: 'number' },
    },
    required: ['runId', 'stepId', 'approvalId', 'decision', 'by', 'resolvedAt'],
    additionalProperties: true,
  },
  aliases: [
    { name: 'pipeline:approval:resolved', deprecated: true },
  ],
};

/**
 * `pipeline.run.checkpoint` — signal-only. Emitted by `PipelineExecutor`
 * after every N successful steps (cadence configured per-executor) as a
 * WAL-replayable snapshot of the in-flight run. Consumed by audit
 * subscribers; not currently a candidate for the durable bus (snapshots
 * are large and recoverable from step-completion events).
 *
 * Emission site: PipelineExecutor.ts:2316 — payload
 * `{ runId, context, currentStepIds, sequenceNumber, at }`. `at` is an
 * ISO-8601 timestamp string (not a number) on the colon-form side.
 */
export const pipelineRunCheckpoint: EventDeclaration = {
  namespace: 'pipeline',
  name: 'pipeline.run.checkpoint',
  description:
    'A periodic snapshot of a running pipeline\'s execution context + '
    + 'frontier, emitted on the signal bus by distributed-core for audit '
    + 'and replay. Signal-only — durable replay relies on step-completion '
    + 'events, not the checkpoint stream.',
  transport: 'signal',
  producer: 'distributed-core',
  tags: ['pipeline', 'checkpoint', 'p0', 'audit'],
  schema: {
    type: 'object',
    properties: {
      runId: { type: 'string' },
      context: { type: 'object', additionalProperties: true },
      currentStepIds: {
        type: 'array',
        items: { type: 'string' },
      },
      sequenceNumber: { type: 'number' },
      at: { type: 'string' },
    },
    required: ['runId', 'context', 'currentStepIds', 'sequenceNumber', 'at'],
    additionalProperties: true,
  },
  aliases: [
    { name: 'pipeline:run:checkpoint', deprecated: true },
  ],
};

/**
 * All pipeline declarations exported by this module. Consumers can
 * iterate this list to bulk-register, or import the individual constants
 * for selective use.
 */
export const pipelineDeclarations: EventDeclaration[] = [
  pipelineApprovalRequested,
  pipelineApprovalRecorded,
  pipelineApprovalResolved,
  pipelineRunCheckpoint,
];

// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
annotateDeclarations(pipelineDeclarations, FIELDS);
