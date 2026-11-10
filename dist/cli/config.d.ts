import { type CompressionConfig } from '../server/compression.js';
/** Fully resolved, validated server configuration. */
export interface ResolvedServerConfig {
    /** TCP port to bind. */
    readonly port: number;
    /** Interface to bind. Defaults to 0.0.0.0 so containers are reachable. */
    readonly hostname: string;
    /** redis:// or rediss:// URL for the signal transport + registry. */
    readonly redisUrl: string;
    /** http(s) base URL of the message-queue service. */
    readonly messageQueueUrl: string;
    /** Receiver-specific HMAC secret; never included in configuration diagnostics. */
    readonly messageQueueAuthSecret?: string;
    /** DynamoDB table backing the DLQ store. */
    readonly dlqTableName: string;
    /** Seconds of subscriber silence before a heartbeat is pruned. 0 disables. */
    readonly subscriberTtlSeconds: number;
    /** Bounded connect attempts before boot gives up on Redis and degrades. */
    readonly redisBootConnectAttempts: number;
    /** Reject publishes of undeclared events instead of warning. */
    readonly strict: boolean;
    /** Optional webhook the AlertManager posts health transitions to. */
    readonly alertWebhookUrl: string | undefined;
    /** Optional DynamoDB override (LocalStack / DynamoDB Local). */
    readonly dynamoEndpoint: string | undefined;
    /**
     * Shared secret gating mutating admin-API requests, from
     * `EVENT_CATALOG_AUTH_TOKEN`. `undefined` — the default, and what an
     * unset variable produces — means the API is unauthenticated exactly as
     * it has always been. See `src/server/auth.ts`.
     */
    readonly authToken: string | undefined;
    /**
     * HTTP response compression policy. ON by default — see
     * `src/server/compression.ts` for the negotiation rules and the
     * measured ratios. `EVENT_CATALOG_COMPRESSION=off` restores the old
     * always-identity behavior.
     */
    readonly compression: CompressionConfig;
}
export type ConfigResult = {
    readonly ok: true;
    readonly config: ResolvedServerConfig;
    readonly warnings: string[];
} | {
    readonly ok: false;
    readonly errors: string[];
};
/** CLI flags that override the corresponding environment variables. */
export interface ServerFlagOverrides {
    readonly port?: string;
    readonly 'redis-url'?: string;
    readonly 'message-queue-url'?: string;
}
export declare const DEFAULT_PORT = 3010;
export declare const DEFAULT_HOSTNAME = "127.0.0.1";
export declare const DEFAULT_MESSAGE_QUEUE_URL = "http://localhost:3004";
export declare const DEFAULT_DLQ_TABLE_NAME = "event-catalog-dlq";
export declare const DEFAULT_SUBSCRIBER_TTL_SECONDS = 1800;
export declare const DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS = 3;
type Env = Record<string, string | undefined>;
/**
 * Resolve + validate the server's runtime configuration.
 *
 * Never throws. On failure returns every problem found, each as one line
 * naming the variable (or flag) at fault and what was expected.
 */
export declare function resolveServerConfig(env: Env, flags?: ServerFlagOverrides): ConfigResult;
/** One line per setting, for the startup banner. Never prints credentials. */
export declare function describeConfig(config: ResolvedServerConfig): string[];
/**
 * Strip userinfo from a URL before logging it — `redis://:hunter2@host`
 * in a container log is a credential leak, and Redis URLs routinely
 * carry one.
 */
export declare function redactUrl(raw: string): string;
export {};
//# sourceMappingURL=config.d.ts.map