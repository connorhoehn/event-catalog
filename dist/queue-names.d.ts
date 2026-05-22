/**
 * Canonical message-queue queue names used across platform services.
 *
 * All values match the literal queue names created by the MQ service at
 * runtime — changing a value here IS a breaking rename and must be
 * coordinated with the MQ operator config.
 */
export declare const MQ_QUEUE_NAMES: {
    /** Pipeline lifecycle + approval events (M4.4). Producer: platform-api. Consumer: gateway. */
    readonly PIPELINE_EVENTS: "pipeline-events";
    /**
     * Activity recording events (Block A.1). Producer: gateway (ActivityService).
     * Multi-consumer: platform-api + any analytics consumer (e.g. orgiq-analytics-group).
     * Registering here makes multi-consumer fan-out first-class and prevents
     * silent string drift between producer and consumer config.
     */
    readonly ACTIVITY_RECORDED: "activity.recorded";
};
export type MQQueueName = (typeof MQ_QUEUE_NAMES)[keyof typeof MQ_QUEUE_NAMES];
/**
 * Standalone re-export for callers that only need the activity.recorded
 * constant without importing the full MQ_QUEUE_NAMES map.
 */
export declare const ACTIVITY_RECORDED: "activity.recorded";
//# sourceMappingURL=queue-names.d.ts.map