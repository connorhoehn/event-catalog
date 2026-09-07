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
export declare const DEFAULT_MAX_TRACKED_KEYS = 5000;
export declare class AlertManager {
    private readonly webhookUrl;
    private readonly errorRateThreshold;
    private readonly cooldownMs;
    private readonly healthConfirmations;
    private readonly maxTrackedKeys;
    private readonly lastAlerted;
    private readonly previousHealthState;
    /** component → { state, consecutive } for transition debouncing. */
    private readonly pendingHealth;
    /** Components with an open (alerted, unresolved) health incident. */
    private readonly alertedDown;
    /**
     * eventName → cumulative errorCount at the last evaluation. The alert
     * fires on the DELTA, not on the cumulative total.
     */
    private readonly lastErrorCount;
    constructor(config?: AlertManagerConfig);
    get enabled(): boolean;
    getPreviousState(component: string): string | undefined;
    setPreviousState(component: string, state: string): void;
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
    observeHealth(component: string, status: string): Promise<'ignored' | 'pending' | 'alerted' | 'recovered'>;
    onHealthChange(component: string, from: string, to: string): Promise<void>;
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
    onErrorThreshold(eventName: string, errorCount: number): Promise<void>;
    onRecovery(component: string): Promise<void>;
    private clearCooldown;
    /** Insertion-ordered eviction so an unbounded key source cannot grow the map. */
    private remember;
    private fire;
}
//# sourceMappingURL=alerting.d.ts.map