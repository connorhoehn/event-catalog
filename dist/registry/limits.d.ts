/**
 * Max distinct subscribers on a single event.
 *
 * A subscriber is a *service identity* — `CatalogConfig.serviceName`, a
 * required config value — not a process. Every replica of a consumer
 * registers under the same name and de-dupes, so a service scaling from
 * one pod to five hundred does not advance this count at all. The
 * platform runs on the order of a dozen services and the committed
 * snapshot holds 229 events, so 200 is well over an order of magnitude
 * of headroom above any legitimate fan-out.
 *
 * The ceiling exists because `addSubscriber` re-serializes the whole
 * entry to Redis on every call: N adds cost O(N²) bytes, and only a
 * bound on N turns that back into a constant. Before this, the only
 * thing standing between a POST loop and an unbounded subscriber list
 * was the 30-minute stale sweeper.
 */
export declare const MAX_SUBSCRIBERS_PER_EVENT = 200;
/**
 * Max length of a subscriber's service name. The name is half of a
 * `${eventName}\0${serviceName}` heartbeat-map key, a JSON field in the
 * entry persisted to Redis, and a value in audit lines and SSE frames.
 * Matches `MAX_CONSUMER_NAME_LENGTH`, which guards the same kind of
 * identifier on the manifest surface.
 */
export declare const MAX_SERVICE_NAME_LENGTH = 256;
/**
 * Validate a subscriber service name. Returns an error string, or null
 * when the name is acceptable.
 *
 * Mirrors `validateEventName`: deliberately narrow, rejecting only what
 * is actively unsafe. Emptiness (an unnamed consumer is not a consumer),
 * unbounded length, and control characters — which corrupt log lines and
 * SSE frames, and, specifically here, would let a caller smuggle a NUL
 * into the `event\0service` heartbeat key and collide with a different
 * (event, service) pair.
 */
export declare function validateServiceName(name: unknown): string | null;
//# sourceMappingURL=limits.d.ts.map