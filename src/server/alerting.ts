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

export class AlertManager {
  private readonly webhookUrl: string | undefined;
  private readonly errorRateThreshold: number;
  private readonly cooldownMs: number;
  private readonly lastAlerted = new Map<string, number>();
  private readonly previousHealthState = new Map<string, string>();

  constructor(config: AlertManagerConfig = {}) {
    this.webhookUrl = config.webhookUrl ?? process.env.ALERT_WEBHOOK_URL;
    this.errorRateThreshold = config.errorRateThreshold ?? 10;
    this.cooldownMs = config.cooldownMs ?? 300_000;
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

  async onHealthChange(component: string, from: string, to: string): Promise<void> {
    if (!this.enabled) return;

    const severity: Severity = to === 'disconnected' ? 'critical' : 'warning';
    const title = `${capitalize(component)} transport ${to}`;
    const message = `${capitalize(component)} health transitioned from "${from}" to "${to}"`;

    await this.fire(`health:${component}:${to}`, {
      service: 'event-catalog',
      severity,
      title,
      message,
      timestamp: new Date().toISOString(),
      metadata: { component, from, to },
    });
  }

  async onErrorThreshold(eventName: string, errorCount: number): Promise<void> {
    if (!this.enabled) return;
    if (errorCount < this.errorRateThreshold) return;

    await this.fire(`errors:${eventName}`, {
      service: 'event-catalog',
      severity: 'warning',
      title: `Error threshold exceeded for "${eventName}"`,
      message: `Event "${eventName}" has accumulated ${errorCount} errors (threshold: ${this.errorRateThreshold})`,
      timestamp: new Date().toISOString(),
      metadata: { eventName, errorCount, threshold: this.errorRateThreshold },
    });
  }

  async onRecovery(component: string): Promise<void> {
    if (!this.enabled) return;

    await this.fire(`health:${component}:recovered`, {
      service: 'event-catalog',
      severity: 'resolved',
      title: `${capitalize(component)} transport recovered`,
      message: `${capitalize(component)} has returned to connected state`,
      timestamp: new Date().toISOString(),
      metadata: { component },
    });
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

      this.lastAlerted.set(key, now);
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
