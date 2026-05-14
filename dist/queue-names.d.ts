/**
 * Canonical message-queue queue names used across platform services.
 *
 * All values match the literal queue names created by the MQ service at
 * runtime — changing a value here IS a breaking rename and must be
 * coordinated with the MQ operator config.
 */
export declare const MQ_QUEUE_NAMES: {
    /** Pipeline lifecycle + approval events (M4.4). Producer: pipeline-worker. Consumer: gateway. */
    readonly PIPELINE_EVENTS: "pipeline-events";
};
export type MQQueueName = (typeof MQ_QUEUE_NAMES)[keyof typeof MQ_QUEUE_NAMES];
//# sourceMappingURL=queue-names.d.ts.map