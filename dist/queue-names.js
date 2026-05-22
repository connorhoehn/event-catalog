"use strict";
// src/queue-names.ts
//
// Shared MQ queue-name constants (wave7-d).
//
// Single source of truth for message-queue queue names used across services.
// Both producers (platform-api) and consumers (gateway) import from here
// so a rename is caught at compile time rather than silently at runtime.
//
// DO NOT duplicate these strings in any service. Import this module instead.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVITY_RECORDED = exports.MQ_QUEUE_NAMES = void 0;
/**
 * Canonical message-queue queue names used across platform services.
 *
 * All values match the literal queue names created by the MQ service at
 * runtime — changing a value here IS a breaking rename and must be
 * coordinated with the MQ operator config.
 */
exports.MQ_QUEUE_NAMES = {
    /** Pipeline lifecycle + approval events (M4.4). Producer: platform-api. Consumer: gateway. */
    PIPELINE_EVENTS: 'pipeline-events',
    /**
     * Activity recording events (Block A.1). Producer: gateway (ActivityService).
     * Multi-consumer: platform-api + any analytics consumer (e.g. orgiq-analytics-group).
     * Registering here makes multi-consumer fan-out first-class and prevents
     * silent string drift between producer and consumer config.
     */
    ACTIVITY_RECORDED: 'activity.recorded',
};
/**
 * Standalone re-export for callers that only need the activity.recorded
 * constant without importing the full MQ_QUEUE_NAMES map.
 */
exports.ACTIVITY_RECORDED = exports.MQ_QUEUE_NAMES.ACTIVITY_RECORDED;
//# sourceMappingURL=queue-names.js.map