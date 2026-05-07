import { ulid } from 'ulid';
import { RetryManager } from 'distributed-core/dist/transport/RetryManager';
import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import type {
  EventCatalogConfig,
  EventDeclaration,
  EventEnvelope,
  EventHandler,
  EventMetadata,
  PublishOptions,
  Subscription,
  SubscribeOptions,
} from '../types/index';

export class EventCatalog {
  private readonly config: EventCatalogConfig;
  private readonly registry: Registry;
  private readonly signal: SignalTransport;
  private readonly durable: DurableTransport;
  private readonly syncRetryManager: RetryManager;
  private connected = false;
  private resyncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: EventCatalogConfig) {
    this.config = config;
    this.registry = new Registry();
    this.signal = new SignalTransport({ url: config.redis.url });
    this.durable = new DurableTransport({ url: config.messageQueue.url });
    this.syncRetryManager = new RetryManager({
      maxRetries: 2,
      baseDelay: 1000,
      backoffFactor: 2,
      jitter: false,
      enableLogging: false,
      name: 'catalog-registry-sync',
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await Promise.all([
      this.signal.connect(),
      this.durable.connect(),
    ]);

    this.connected = true;

    if (this.config.registryUrl) {
      try {
        await this.syncRetryManager.execute(() => this.syncToRemoteRegistry());
      } catch {
        console.warn('[event-catalog] registry sync failed after retries, scheduling background retry');
        this.scheduleBackgroundSync();
      }

      this.resyncInterval = setInterval(() => {
        this.syncToRemoteRegistry().catch(err => {
          console.warn('[event-catalog] periodic re-sync failed:', (err as Error).message);
        });
      }, 60_000);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    if (this.resyncInterval) {
      clearInterval(this.resyncInterval);
      this.resyncInterval = null;
    }

    await Promise.all([
      this.signal.disconnect(),
      this.durable.disconnect(),
    ]);

    this.connected = false;
  }

  declare(event: EventDeclaration): void {
    this.registry.declare(event);
  }

  async publish<T = unknown>(eventName: string, payload: T, options?: PublishOptions): Promise<void> {
    const entry = this.registry.get(eventName);
    if (!entry) {
      throw new Error(`[event-catalog] event "${eventName}" is not declared. Call declare() first.`);
    }

    // Validate payload against schema
    const validation = this.registry.validate(eventName, payload);
    if (!validation.valid) {
      const msgs = validation.errors?.map(e => e.message).join(', ') ?? 'unknown error';
      throw new Error(`[event-catalog] payload validation failed for "${eventName}": ${msgs}`);
    }

    const metadata: EventMetadata = {
      id: ulid(),
      producer: this.config.serviceName,
      timestamp: options?.timestamp ?? Date.now(),
      correlationId: options?.correlationId,
      headers: options?.headers,
    };

    const envelope: EventEnvelope<T> = {
      eventName,
      payload,
      metadata,
    };

    try {
      if (entry.transport === 'signal') {
        await this.signal.publish(eventName, envelope as EventEnvelope);
      } else {
        const queueName = DurableTransport.eventNameToQueueName(eventName);
        await this.durable.publish(queueName, envelope as EventEnvelope);
      }

      this.registry.updateStats(eventName, {
        lastPublishedAt: new Date().toISOString(),
        publishCount: (entry.metadata.publishCount ?? 0) + 1,
      });
    } catch (err) {
      this.registry.updateStats(eventName, {
        errorCount: (entry.metadata.errorCount ?? 0) + 1,
      });
      throw err;
    }
  }

  subscribe<T = unknown>(
    eventName: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): Subscription {
    const entry = this.registry.get(eventName);
    if (!entry) {
      throw new Error(`[event-catalog] event "${eventName}" is not declared. Call declare() first.`);
    }

    this.registry.addSubscriber(eventName, this.config.serviceName);

    // Notify remote catalog (non-blocking, fault-tolerant)
    this.registerSubscriberRemote(eventName).catch(err => {
      console.warn(`[event-catalog] failed to register subscriber with remote registry for "${eventName}":`, (err as Error).message);
    });

    if (entry.transport === 'signal') {
      let unsubFn: (() => Promise<void>) | null = null;

      const setupPromise = this.signal.subscribe(eventName, (envelope) => {
        handler(envelope as EventEnvelope<T>);
      }).then(unsub => {
        unsubFn = unsub;
      });

      return {
        unsubscribe: async () => {
          await setupPromise;
          if (unsubFn) await unsubFn();
          this.deregisterSubscriberRemote(eventName).catch(err => {
            console.warn(`[event-catalog] failed to deregister subscriber from remote registry for "${eventName}":`, (err as Error).message);
          });
        },
      };
    } else {
      const queueName = DurableTransport.eventNameToQueueName(eventName);
      const cancel = this.durable.subscribe(
        queueName,
        async (envelope) => {
          await handler(envelope as EventEnvelope<T>);
        },
        {
          pollingInterval: options?.pollingInterval,
          batchSize: options?.batchSize,
          visibilityTimeout: options?.visibilityTimeout,
        },
      );

      return {
        unsubscribe: async () => {
          cancel();
          this.deregisterSubscriberRemote(eventName).catch(err => {
            console.warn(`[event-catalog] failed to deregister subscriber from remote registry for "${eventName}":`, (err as Error).message);
          });
        },
      };
    }
  }

  getRegistry(): Registry {
    return this.registry;
  }

  getSignalTransport(): SignalTransport {
    return this.signal;
  }

  getDurableTransport(): DurableTransport {
    return this.durable;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleBackgroundSync(): void {
    const attempt = (delay: number): void => {
      setTimeout(() => {
        if (!this.connected || !this.config.registryUrl) return;
        this.syncToRemoteRegistry().catch(() => {
          const nextDelay = Math.min(delay * 2, 60_000);
          console.warn(`[event-catalog] background sync retry failed, next attempt in ${nextDelay}ms`);
          attempt(nextDelay);
        });
      }, delay);
    };
    attempt(5_000);
  }

  private async syncToRemoteRegistry(): Promise<void> {
    const entries = this.registry.list();
    if (entries.length === 0) return;

    const url = `${this.config.registryUrl}/api/events/bulk`;

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceName: this.config.serviceName,
        events: entries.map(e => ({
          name: e.name,
          schema: e.schema,
          transport: e.transport,
          producer: e.producer,
          description: e.description,
          tags: e.tags,
        })),
      }),
    });
  }

  private async registerSubscriberRemote(eventName: string): Promise<void> {
    if (!this.config.registryUrl) return;

    const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}/subscribers`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceName: this.config.serviceName }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  }

  private async deregisterSubscriberRemote(eventName: string): Promise<void> {
    if (!this.config.registryUrl) return;

    const url = `${this.config.registryUrl}/api/events/${encodeURIComponent(eventName)}/subscribers/${encodeURIComponent(this.config.serviceName)}`;

    const res = await fetch(url, {
      method: 'DELETE',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  }
}
