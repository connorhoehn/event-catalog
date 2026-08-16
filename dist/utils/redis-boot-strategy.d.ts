export interface BootBoundedReconnectStrategy {
    /** Pass as `socket.reconnectStrategy` to redis.createClient(). */
    reconnectStrategy: (retries: number) => number | Error;
    /**
     * Call once the client's initial connect() has resolved. Permanently
     * switches the strategy to infinite capped backoff for reconnects.
     */
    markConnected: () => void;
}
/** Default total connect attempts during boot (initial attempt included). */
export declare const DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS = 3;
/**
 * Resolve the boot-time connect-attempt budget from the environment.
 * REDIS_BOOT_CONNECT_ATTEMPTS must be a number >= 1; anything else
 * (unset, garbage, 0, negative) falls back to the default of 3.
 */
export declare function resolveBootConnectAttempts(env?: Record<string, string | undefined>): number;
/**
 * Build a reconnect strategy that is bounded until the first successful
 * connect, then infinite.
 *
 * @param opts.bootAttempts - total socket connect attempts allowed during
 *   boot, INCLUDING the initial one (node-redis's `retries` argument counts
 *   re-attempts after the initial connect, starting at 0 — so we give up
 *   when `retries + 1 >= bootAttempts`). Defaults to the env-resolved budget.
 * @param opts.baseMs - backoff multiplier (delay = retries * baseMs).
 * @param opts.maxMs  - backoff cap.
 * @param opts.label  - client name for the give-up error message.
 */
export declare function createBootBoundedReconnectStrategy(opts?: {
    bootAttempts?: number;
    baseMs?: number;
    maxMs?: number;
    label?: string;
}): BootBoundedReconnectStrategy;
/**
 * node-redis surfaces socket failures as an AggregateError whose own
 * `.message` is the empty string — which is why the boot loop logged
 * `[server] registry Redis error:` with nothing after it. Dig out something
 * an operator can actually act on: the aggregated causes, then the errno
 * code, then the raw stringification.
 */
export declare function formatRedisError(err: unknown): string;
//# sourceMappingURL=redis-boot-strategy.d.ts.map