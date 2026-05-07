import { createClient, type RedisClientType } from 'redis';
import { CircuitBreaker } from 'distributed-core/dist/transport/CircuitBreaker';
import type { EventEnvelope } from '../types/index';

export interface SignalTransportConfig {
  url: string;
  ringBufferSize?: number;
}

interface ChannelMetrics {
  publishCount: number;
  lastPublishedAt: string | null;
  subscriberCount: number;
}

type MessageHandler = (envelope: EventEnvelope) => void;

export class SignalTransport {
  private publishClient: RedisClientType | null = null;
  private subscribeClient: RedisClientType | null = null;
  private readonly url: string;
  private readonly ringBufferSize: number;
  private connected = false;
  private subscriptions = new Map<string, Set<MessageHandler>>();
  private channelMetrics = new Map<string, ChannelMetrics>();
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: SignalTransportConfig) {
    this.url = config.url;
    this.ringBufferSize = config.ringBufferSize ?? 100;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000,
      timeout: 10000,
      enableLogging: false,
      name: 'signal-redis',
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.circuitBreaker.execute(async () => {
      this.publishClient = createClient({ url: this.url }) as RedisClientType;
      this.subscribeClient = createClient({ url: this.url }) as RedisClientType;

      this.publishClient.on('error', (err: Error) => {
        console.warn('[signal-transport] publish client error:', err.message);
      });

      this.subscribeClient.on('error', (err: Error) => {
        console.warn('[signal-transport] subscribe client error:', err.message);
      });

      await Promise.all([
        this.publishClient.connect(),
        this.subscribeClient.connect(),
      ]);
    });

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    for (const channel of this.subscriptions.keys()) {
      try {
        await this.subscribeClient!.unsubscribe(channel);
      } catch {
        // ignore during shutdown
      }
    }
    this.subscriptions.clear();

    await Promise.all([
      this.publishClient?.quit().catch(() => {}),
      this.subscribeClient?.quit().catch(() => {}),
    ]);

    this.publishClient = null;
    this.subscribeClient = null;
    this.connected = false;
  }

  async publish(channel: string, envelope: EventEnvelope): Promise<void> {
    if (!this.connected || !this.publishClient) {
      console.warn(`[signal-transport] not connected, skipping publish to ${channel}`);
      return;
    }

    await this.circuitBreaker.execute(async () => {
      const serialized = JSON.stringify(envelope);

      await this.publishClient!.publish(channel, serialized);

      // Write to ring buffer (Redis Stream) for history inspection
      await this.publishClient!.xAdd(
        `${channel}:history`,
        '*',
        { payload: serialized },
        { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: this.ringBufferSize } },
      ).catch((err: Error) => {
        console.warn(`[signal-transport] ring buffer write failed for ${channel}:`, err.message);
      });
    });

    this.incrementMetrics(channel);
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>> {
    if (!this.connected || !this.subscribeClient) {
      throw new Error('[signal-transport] not connected');
    }

    let handlers = this.subscriptions.get(channel);
    const isNewChannel = !handlers;

    if (!handlers) {
      handlers = new Set();
      this.subscriptions.set(channel, handlers);
    }

    handlers.add(handler);

    if (isNewChannel) {
      await this.subscribeClient.subscribe(channel, (message: string) => {
        try {
          const envelope = JSON.parse(message) as EventEnvelope;
          const currentHandlers = this.subscriptions.get(channel);
          if (currentHandlers) {
            for (const h of currentHandlers) {
              try {
                h(envelope);
              } catch (err) {
                console.error(`[signal-transport] handler error on ${channel}:`, err);
              }
            }
          }
        } catch (err) {
          console.error(`[signal-transport] deserialize error on ${channel}:`, err);
        }
      });
    }

    this.updateSubscriberCount(channel);

    return async () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.subscriptions.delete(channel);
        await this.subscribeClient?.unsubscribe(channel).catch(() => {});
      }
      this.updateSubscriberCount(channel);
    };
  }

  async getHistory(channel: string, count = 50): Promise<EventEnvelope[]> {
    if (!this.connected || !this.publishClient) return [];

    try {
      const entries = await this.publishClient.xRange(
        `${channel}:history`,
        '-',
        '+',
      );

      const recent = entries.slice(-count);
      return recent.map(entry => {
        try {
          return JSON.parse(entry.message.payload) as EventEnvelope;
        } catch {
          return null;
        }
      }).filter((e): e is EventEnvelope => e !== null);
    } catch {
      return [];
    }
  }

  getMetrics(channel?: string): Map<string, ChannelMetrics> | ChannelMetrics | undefined {
    if (channel) return this.channelMetrics.get(channel);
    return new Map(this.channelMetrics);
  }

  getAllMetrics(): Map<string, ChannelMetrics> {
    return new Map(this.channelMetrics);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private incrementMetrics(channel: string): void {
    let metrics = this.channelMetrics.get(channel);
    if (!metrics) {
      metrics = { publishCount: 0, lastPublishedAt: null, subscriberCount: 0 };
      this.channelMetrics.set(channel, metrics);
    }
    metrics.publishCount++;
    metrics.lastPublishedAt = new Date().toISOString();
  }

  private updateSubscriberCount(channel: string): void {
    let metrics = this.channelMetrics.get(channel);
    if (!metrics) {
      metrics = { publishCount: 0, lastPublishedAt: null, subscriberCount: 0 };
      this.channelMetrics.set(channel, metrics);
    }
    metrics.subscriberCount = this.subscriptions.get(channel)?.size ?? 0;
  }
}
