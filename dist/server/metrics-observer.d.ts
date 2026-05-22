import type { Registry } from '../registry/index.js';
import type { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import type { MetricsCollector } from './metrics.js';
import type { ProducerAttributionStore } from './producer-attribution.js';
import type { PoisonEventDetector } from './poison-detector.js';
export declare class MetricsObserver {
    private readonly registry;
    private readonly signal;
    private readonly durable;
    private readonly metrics;
    private readonly attribution?;
    private readonly poisonDetector?;
    private readonly signalUnsubscribes;
    private durablePollTimer;
    private readonly durablePollIntervalMs;
    private readonly lastDurableSent;
    private readonly lastDurableFailed;
    constructor(deps: {
        registry: Registry;
        signal: SignalTransport;
        durable: DurableTransport;
        metrics: MetricsCollector;
        attribution?: ProducerAttributionStore;
        poisonDetector?: PoisonEventDetector;
        durablePollIntervalMs?: number;
    });
    start(): Promise<void>;
    observe(eventName: string, transport: 'signal' | 'durable' | 'both'): Promise<void>;
    stop(): Promise<void>;
    private observeSignal;
    private maybePoison;
    private pollDurableStats;
}
//# sourceMappingURL=metrics-observer.d.ts.map