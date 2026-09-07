// src/registry/limits.ts
//
// Ceilings on registry state whose size a *caller* controls.
//
// These live beside the registry rather than in
// `src/server/routes/limits.ts` because the registry is reachable
// without going through a route: `RegistryCoordinator.applyMutation`
// calls `addSubscriber` on every replicated `subscriber.add`, and the
// library client calls it directly from `catalog.subscribe()`. A guard
// written only in the HTTP handler would leave the state unbounded on
// two of the three entry points. `src/server/routes/limits.ts`
// re-exports them so every HTTP-visible cap is still discoverable in
// one place.

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
export const MAX_SUBSCRIBERS_PER_EVENT = 200;

/**
 * Max length of a subscriber's service name. The name is half of a
 * `${eventName}\0${serviceName}` heartbeat-map key, a JSON field in the
 * entry persisted to Redis, and a value in audit lines and SSE frames.
 * Matches `MAX_CONSUMER_NAME_LENGTH`, which guards the same kind of
 * identifier on the manifest surface.
 */
export const MAX_SERVICE_NAME_LENGTH = 256;

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
export function validateServiceName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) {
    return 'serviceName is required';
  }
  if (name.length > MAX_SERVICE_NAME_LENGTH) {
    return `serviceName must be ≤ ${MAX_SERVICE_NAME_LENGTH} characters`;
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return 'serviceName must not contain control characters';
  }
  return null;
}
