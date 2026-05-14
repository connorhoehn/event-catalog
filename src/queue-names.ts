// src/queue-names.ts
//
// Shared MQ queue-name constants (wave7-d).
//
// Single source of truth for message-queue queue names used across services.
// Both producers (pipeline-worker) and consumers (gateway) import from here
// so a rename is caught at compile time rather than silently at runtime.
//
// DO NOT duplicate these strings in any service. Import this module instead.

/**
 * Canonical message-queue queue names used across platform services.
 *
 * All values match the literal queue names created by the MQ service at
 * runtime — changing a value here IS a breaking rename and must be
 * coordinated with the MQ operator config.
 */
export const MQ_QUEUE_NAMES = {
  /** Pipeline lifecycle + approval events (M4.4). Producer: pipeline-worker. Consumer: gateway. */
  PIPELINE_EVENTS: 'pipeline-events',
} as const;

export type MQQueueName = (typeof MQ_QUEUE_NAMES)[keyof typeof MQ_QUEUE_NAMES];
