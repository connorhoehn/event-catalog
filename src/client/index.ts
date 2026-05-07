import { ulid } from 'ulid';
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
  private connected = false;

  constructor(config: EventCatalogConfig) {
    this.config = config;
    this.registry = new Registry();
    this.signal = new SignalTransport({ url: config.redis.url });
    this.durable = new DurableTransport({ url: config.messageQueue.url });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await Promise.all([
      this.signal.connect(),
      this.durable.connect(),
    ]);

    this.connected = true;

    // Register all declared events with remote catalog if configured
    if (this.config.registryUrl) {
      await this.syncToRemoteRegistry().catch(err => {
        console.warn('[event-catalog] failed to sync to remote registry:', (err as Error).message);
      });
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

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

    if (entry.transport === 'signal') {
      let unsubFn: (() => Promise<void>) | null = null;

      const setupPromise = this.signal.subscribe(eventName, (envelope) => {
        handler(envelope as EventEnvelope<T>);
      }).then(unsub => {
        unsubFn = unsub;
      });

      return {
        async unsubscribe() {
          await setupPromise;
          if (unsubFn) await unsubFn();
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
        async unsubscribe() {
          cancel();
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
}
