export type Severity = 'warning' | 'critical' | 'resolved';

export interface AlertPayload {
  service: string;
  severity: Severity;
  title: string;
  message: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface AlertManagerConfig {
  webhookUrl?: string;
  /**
   * Number of NEW errors an event must accrue between two evaluations
   * before an error alert fires. See `onErrorThreshold`.
   */
  errorRateThreshold?: number;
  cooldownMs?: number;
  /**
   * Consecutive probes a component must report the same non-connected
   * (or connected) state before the transition is alerted. 2 means one
   * bad probe is ignored; the second consecutive one pages.
   */
  healthConfirmations?: number;
  /** Max distinct alert keys retained for cooldown bookkeeping. */
  maxTrackedKeys?: number;
}

/**
 * Ceiling on the per-key bookkeeping maps.
 *
 * `lastAlerted` and `lastErrorCount` are keyed partly by event name, and
 * event names are writable over HTTP, so these are unbounded maps fed by
 * request input. Evicting oldest-first past the cap costs at worst a
 * duplicate alert for an evicted key.
 */
export const DEFAULT_MAX_TRACKED_KEYS = 5000;

/** Health states this manager treats as "the dependency is working". */
const HEALTHY = 'connected';

export class AlertManager {
  private readonly webhookUrl: string | undefined;
  private readonly errorRateThreshold: number;
  private readonly cooldownMs: number;
  private readonly healthConfirmations: number;
  private readonly maxTrackedKeys: number;
  private readonly lastAlerted = new Map<string, number>();
  private readonly previousHealthState = new Map<string, string>();
  /** component → { state, consecutive } for transition debouncing. */
  private readonly pendingHealth = new Map<string, { state: string; count: number }>();
  /** Components with an open (alerted, unresolved) health incident. */
  private readonly alertedDown = new Set<string>();
  /**
   * eventName → cumulative errorCount at the last evaluation. The alert
   * fires on the DELTA, not on the cumulative total.
   */
  private readonly lastErrorCount = new Map<string, number>();

  constructor(config: AlertManagerConfig = {}) {
    this.webhookUrl = config.webhookUrl ?? process.env.ALERT_WEBHOOK_URL;
    this.errorRateThreshold = config.errorRateThreshold ?? 10;
    this.cooldownMs = config.cooldownMs ?? 300_000;
    this.healthConfirmations = Math.max(1, config.healthConfirmations ?? 2);
    this.maxTrackedKeys = config.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;
  }

  get enabled(): boolean {
    return !!this.webhookUrl;
  }

  getPreviousState(component: string): string | undefined {
    return this.previousHealthState.get(component);
  }

  setPreviousState(component: string, state: string): void {
    this.previousHealthState.set(component, state);
  }

  /**
   * Feed one health probe and alert on a *confirmed* transition.
   *
   * This owns the whole state machine — previous state, debounce, and
   * which alert to send — so a caller only has to hand it each probe
   * result. It replaces the hand-rolled compare-and-set the health
   * interval was doing, which fired on a single sample: one 15s probe
   * blipping to `degraded` paged, and the very next probe returning to
   * `connected` sent a `resolved`, so a flapping Redis produced an
   * alternating alert stream rather than one incident.
   *
   * Returns what it did, which is what makes the transitions testable.
   */
  async observeHealth(
    component: string,
    status: string,
  ): Promise<'ignored' | 'pending' | 'alerted' | 'recovered'> {
    const previous = this.previousHealthState.get(component);

    // First observation establishes a baseline without alerting: a
    // dependency that has simply not connected yet at boot is not an
    // incident, and paging on it would fire on every deploy.
    if (previous === undefined) {
      this.previousHealthState.set(component, status);
      return 'ignored';
    }

    if (status === previous) {
      // Steady state — discard any half-formed transition.
      this.pendingHealth.delete(component);
      return 'ignored';
    }

    const pending = this.pendingHealth.get(component);
    const count = pending && pending.state === status ? pending.count + 1 : 1;
    if (count < this.healthConfirmations) {
      this.pendingHealth.set(component, { state: status, count });
      return 'pending';
    }
    this.pendingHealth.delete(component);
    this.previousHealthState.set(component, status);

    if (status === HEALTHY) {
      // Only resolve an incident we actually opened. Otherwise a service
      // that boots with Redis still connecting sends a "recovered" for a
      // failure nobody was ever told about.
      if (!this.alertedDown.delete(component)) return 'ignored';
      await this.onRecovery(component);
      return 'recovered';
    }
    this.alertedDown.add(component);
    await this.onHealthChange(component, previous, status);
    return 'alerted';
  }

  async onHealthChange(component: string, from: string, to: string): Promise<void> {
    if (!this.enabled) return;

    const severity: Severity = to === 'disconnected' ? 'critical' : 'warning';
    const title = `${capitalize(component)} transport ${to}`;
    const message = `${capitalize(component)} health transitioned from "${from}" to "${to}"`;

    // A component going down again must be able to alert even if it was
    // already declared recovered inside the cooldown window. Without
    // this, down → recovered → down within 5 minutes delivered the
    // "resolved" and swallowed the second failure, leaving the operator
    // with a green page over a broken dependency.
    this.clearCooldown(`health:${component}:recovered`);

    await this.fire(`health:${component}:${to}`, {
      service: 'event-catalog',
      severity,
      title,
      message,
      timestamp: new Date().toISOString(),
      metadata: { component, from, to },
    });
  }

  /**
   * Alert when an event accrues `errorRateThreshold` NEW errors between
   * two evaluations.
   *
   * `errorCount` is the cumulative lifetime counter from
   * `MetricsCollector`. Comparing that directly against a threshold —
   * which is what this did — means that once an event has ever crossed
   * 10 errors it is permanently over threshold: the alert re-fires every
   * cooldown, forever, long after the cause is fixed, and there is no
   * state in which it stops. Differencing against the last observed
   * value turns it into an actual rate alert that goes quiet when the
   * errors do.
   */
  async onErrorThreshold(eventName: string, errorCount: number): Promise<void> {
    if (!this.enabled) return;

    const previous = this.lastErrorCount.get(eventName) ?? 0;
    // A decrease means the counter was reset (metrics reset, restart);
    // treat the current value as the new delta rather than a negative.
    const newErrors = errorCount < previous ? errorCount : errorCount - previous;
    this.remember(this.lastErrorCount, eventName, errorCount);

    if (newErrors < this.errorRateThreshold) return;

    await this.fire(`errors:${eventName}`, {
      service: 'event-catalog',
      severity: 'warning',
      title: `Error threshold exceeded for "${eventName}"`,
      message:
        `Event "${eventName}" accrued ${newErrors} new errors since the last check ` +
        `(threshold: ${this.errorRateThreshold}, lifetime total: ${errorCount})`,
      timestamp: new Date().toISOString(),
      metadata: { eventName, errorCount, newErrors, threshold: this.errorRateThreshold },
    });
  }

  async onRecovery(component: string): Promise<void> {
    if (!this.enabled) return;

    // Symmetric to onHealthChange: once recovered, a subsequent failure
    // must not be suppressed by the cooldown left over from the previous
    // failure alert.
    this.clearCooldown(`health:${component}:disconnected`);
    this.clearCooldown(`health:${component}:degraded`);

    await this.fire(`health:${component}:recovered`, {
      service: 'event-catalog',
      severity: 'resolved',
      title: `${capitalize(component)} transport recovered`,
      message: `${capitalize(component)} has returned to connected state`,
      timestamp: new Date().toISOString(),
      metadata: { component },
    });
  }

  private clearCooldown(key: string): void {
    this.lastAlerted.delete(key);
  }

  /** Insertion-ordered eviction so an unbounded key source cannot grow the map. */
  private remember<V>(map: Map<string, V>, key: string, value: V): void {
    if (!map.has(key) && map.size >= this.maxTrackedKeys) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
    map.set(key, value);
  }

  private async fire(key: string, payload: AlertPayload): Promise<void> {
    const now = Date.now();
    const lastTime = this.lastAlerted.get(key);
    if (lastTime && now - lastTime < this.cooldownMs) return;

    // Cooldown is intentionally NOT applied until we confirm the webhook
    // accepted the alert (2xx). A transient failure — network error,
    // timeout/abort, or non-2xx response — leaves the cooldown unset so
    // the next attempt retries immediately. Otherwise a single hiccup
    // would silently blackhole the next ${cooldownMs}ms of alerts for
    // this key.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(this.webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(
          `[alerting] webhook returned ${res.status} — alert not delivered, cooldown NOT applied`,
        );
        return;
      }

      this.remember(this.lastAlerted, key, now);
    } catch (err) {
      console.warn('[alerting] webhook delivery failed:', (err as Error).message);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
