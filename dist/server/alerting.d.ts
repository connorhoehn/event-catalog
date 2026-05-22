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
    errorRateThreshold?: number;
    cooldownMs?: number;
}
export declare class AlertManager {
    private readonly webhookUrl;
    private readonly errorRateThreshold;
    private readonly cooldownMs;
    private readonly lastAlerted;
    private readonly previousHealthState;
    constructor(config?: AlertManagerConfig);
    get enabled(): boolean;
    getPreviousState(component: string): string | undefined;
    setPreviousState(component: string, state: string): void;
    onHealthChange(component: string, from: string, to: string): Promise<void>;
    onErrorThreshold(eventName: string, errorCount: number): Promise<void>;
    onRecovery(component: string): Promise<void>;
    private fire;
}
//# sourceMappingURL=alerting.d.ts.map