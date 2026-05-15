import { ulid } from 'ulid';
import { RetryManager } from 'distributed-core/transport';
import { Registry } from '../registry/index';
import { SignalTransport } from './signal';
import { DurableTransport } from './durable';
import {
  buildChannelMessageEnvelope,
  buildSignalMessage,
} from '../types/envelopes';
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

/**
 * Phase E3.3 — resolve the Redis channel an event publishes on.
 *
 *   - `undefined` channel → default to the event name (preserves v0.1 behavior).
 *   - `string` channel    → literal pattern.
 *   - `function` channel  → call with the payload (per-publish destinations,
 *     e.g. `p => \`document:${p.documentId}\``).
 */
function resolveSignalChannel(
  declared: string | ((payload: unknown) => string) | undefined,
  eventName: string,
  payload: unknown,
): string {
  if (declared === undefined) return eventName;
  if (typeof declared === 'string') return declared;
  return declared(payload);
}

/**
 * Subscribe-side resolver. Static channels only — a function-typed `channel`
 * means the destination is per-payload, which `subscribe()` cannot honor
 * without a payload to evaluate against.
 */
function resolveStaticSignalChannel(
  declared: string | ((payload: unknown) => string) | undefined,
  eventName: string,
): string {
  if (declared === undefined) return eventName;
  if (typeof declared === 'string') return declared;
  throw new Error(
    `[event-catalog] cannot subscribe to "${eventName}": its declared channel is a function `
    + `(per-payload). Declare a static channel string, or subscribe directly via the `
    + `SignalTransport with a Redis pattern subscription.`,
  );
}

export class EventCatalog {
  private readonly config: EventCatalogConfig;
  private readonly registry: Registry;
  private readonly signal: SignalTransport;
  private readonly durable: DurableTransport;
  private readonly syncRetryManager: RetryManager;
  private connected = false;
  private resyncInterval: ReturnType<typeof setInterval> | null = null;
  /** Phase E3.5 — dedupe deprecation log to one line per alias per process. */
  private readonly warnedAliases = new Set<string>();

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

  /**
   * Register an event with the local registry. In strict mode
   * (`config.strict === true` or `EVENT_CATALOG_STRICT=true`), throws
   * when the new schema breaks compatibility against the registered
   * history. Otherwise the violation is non-fatal — callers may inspect
   * the catalog's logs or the server's `GET /api/events/:name/schema/check`
   * endpoint.
   */
  declare(event: EventDeclaration): void {
    const result = this.registry.declare(event);
    if (this.isStrict() && !result.compatible) {
      const violations = result.violations?.join('; ') ?? 'unknown';
      throw new Error(
        `[event-catalog] declare("${event.name}") rejected by strict mode: ${violations}`,
      );
    }
  }

  private isStrict(): boolean {
    if (typeof this.config.strict === 'boolean') return this.config.strict;
    return process.env.EVENT_CATALOG_STRICT === 'true';
  }

  async publish<T = unknown>(eventName: string, payload: T, options?: PublishOptions): Promise<void> {
    // Phase E3.5 — alias resolution. If `eventName` is a deprecated alias of
    // some canonical declaration, route the publish through the canonical
    // (use its schema, channel, queue) and emit on the canonical name so
    // subscribers don't have to handle both forms. A one-line deprecation
    // warning per process per alias keeps log noise bounded.
    const resolved = this.registry.resolve(eventName);
    if (!resolved) {
      throw new Error(`[event-catalog] event "${eventName}" is not declared. Call declare() first.`);
    }
    const entry = resolved.entry;
    if (resolved.viaAlias) {
      this.warnDeprecatedAlias(resolved.viaAlias.name, entry.name, resolved.viaAlias.until);
      eventName = entry.name;
    }

    // Validate payload against schema
    const validation = this.registry.validate(eventName, payload);
    if (!validation.valid) {
      const msgs = validation.errors?.map(e => e.message).join(', ') ?? 'unknown error';
      throw new Error(`[event-catalog] payload validation failed for "${eventName}": ${msgs}`);
    }

    // Discriminator validation (Phase E3.6) — when a declaration carries
    // `discriminator: { field, values }`, the payload's value at `field`
    // must be one of the declared values. Catches sub-type drift at
    // publish time, e.g. ingest:progress carries 10 sub-shapes via
    // payload.type.
    if (entry.discriminator) {
      const { field, values } = entry.discriminator;
      const actual = (payload as Record<string, unknown> | null)?.[field];
      if (typeof actual !== 'string' || !values.includes(actual)) {
        throw new Error(
          `[event-catalog] discriminator validation failed for "${eventName}": `
          + `payload.${field}=${JSON.stringify(actual)} is not in declared values [${values.join(', ')}]`,
        );
      }
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
      // Phase E3.4 — 'both' fan-out: publish to signal AND durable in
      // parallel. Failure of either propagates after both are attempted so
      // partial deliveries are not silently masked.
      const queueName = entry.queue ?? DurableTransport.eventNameToQueueName(eventName);
      // Phase 4.2 — thread the declared durable-side config so
      // DurableTransport.ensureQueue can PUT the right shape on first publish.
      const queueOptions = {
        retention: entry.retention,
        fifo: entry.fifo,
        dlqAfterAttempts: entry.dlqAfterAttempts,
      };
      const sends: Array<Promise<void>> = [];
      if (entry.transport === 'signal' || entry.transport === 'both') {
        // Phase E3.3 — resolve declared `channel` (string, function of
        // payload, or fall back to event name).
        const signalChannel = resolveSignalChannel(entry.channel, eventName, payload);
        sends.push(this.signal.publish(signalChannel, envelope as EventEnvelope));
      }
      if (entry.transport === 'durable' || entry.transport === 'both') {
        sends.push(this.durable.publish(queueName, envelope as EventEnvelope, queueOptions));
      }
      const results = await Promise.allSettled(sends);
      const rejection = results.find((r) => r.status === 'rejected');
      if (rejection && rejection.status === 'rejected') {
        throw rejection.reason;
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

  /**
   * Channel-scoped signal publish for the websocket-gateway broadcast path
   * (wave1-ec-3).
   *
   * Differs from `publish(eventName, payload)` in two ways:
   *   1. Targets a specific channel (room/document/etc.) rather than the
   *      bare event-name as a pub/sub channel. The envelope is published
   *      to `websocket:route:{channelId}` and addressed to the gateway
   *      nodes registered in `websocket:channel:{channelId}:nodes`.
   *   2. Wraps the payload in the gateway's `ChannelMessageEnvelope` /
   *      `SignalMessage` shape so the gateway's MessageRouter can fan it
   *      out to local WebSocket subscribers without reshaping.
   *
   * Schema enforcement (wave1-ec-3 P0):
   *   - If the event IS declared, payload is validated against the
   *     declared JSON schema. Validation failures throw — same as
   *     `publish()`. This is the whole point of routing through the
   *     catalog instead of writing directly to Redis.
   *   - If the event is NOT declared, a warning is logged but the
   *     publish proceeds. Strict-mode rejection of undeclared events is
   *     deferred to a later wave (MQ-7 / EC-7 strict mode).
   *
   * @returns number of gateway nodes the envelope was addressed to (0
   *   when no listeners are registered).
   */
  async publishSignal<T = unknown>(
    channelId: string,
    eventName: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<number> {
    const entry = this.registry.get(eventName);

    if (entry) {
      const validation = this.registry.validate(eventName, payload);
      if (!validation.valid) {
        const msgs = validation.errors?.map((e) => e.message).join(', ') ?? 'unknown error';
        throw new Error(
          `[event-catalog] publishSignal payload validation failed for "${eventName}": ${msgs}`,
        );
      }

      if (entry.discriminator) {
        const { field, values } = entry.discriminator;
        const actual = (payload as Record<string, unknown> | null)?.[field];
        if (typeof actual !== 'string' || !values.includes(actual)) {
          throw new Error(
            `[event-catalog] publishSignal discriminator validation failed for "${eventName}": `
            + `payload.${field}=${JSON.stringify(actual)} is not in declared values [${values.join(', ')}]`,
          );
        }
      }
    } else {
      console.warn(
        `[event-catalog] publishSignal called with undeclared event "${eventName}" — `
        + `emitting without schema validation. Declare it via catalog.declare() to enforce schema.`,
      );
    }

    const timestamp = options?.timestamp !== undefined
      ? new Date(options.timestamp).toISOString()
      : new Date().toISOString();

    const envelope = buildChannelMessageEnvelope({
      channel: channelId,
      message: buildSignalMessage({
        eventName,
        channel: channelId,
        payload,
        timestamp,
      }),
      fromNode: this.config.serviceName,
      timestamp,
    });

    const delivered = await this.signal.publishChannelMessage(channelId, envelope);

    if (entry) {
      this.registry.updateStats(eventName, {
        lastPublishedAt: new Date().toISOString(),
        publishCount: (entry.metadata.publishCount ?? 0) + 1,
      });
    }

    return delivered;
  }

  subscribe<T = unknown>(
    eventName: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): Subscription {
    // Phase E3.5 — alias-aware subscribe. If the caller supplied a deprecated
    // alias, resolve to the canonical and subscribe there. No warning on the
    // subscribe path — only producers should be redirected (the alias-warning
    // story belongs on the emission side).
    const resolved = this.registry.resolve(eventName);
    if (!resolved) {
      throw new Error(`[event-catalog] event "${eventName}" is not declared. Call declare() first.`);
    }
    const entry = resolved.entry;
    if (resolved.viaAlias) {
      eventName = entry.name;
    }

    this.registry.addSubscriber(eventName, this.config.serviceName);

    // Notify remote catalog (non-blocking, fault-tolerant)
    this.registerSubscriberRemote(eventName).catch(err => {
      console.warn(`[event-catalog] failed to register subscriber with remote registry for "${eventName}":`, (err as Error).message);
    });

    if (entry.transport === 'signal') {
      let unsubFn: (() => Promise<void>) | null = null;

      // Phase E3.3 — subscribe() needs a static channel. If the declaration's
      // `channel` is a function (dynamic per payload), the subscriber has no
      // payload to resolve from. Reject with a clear error rather than silently
      // subscribing to the wrong channel.
      const signalChannel = resolveStaticSignalChannel(entry.channel, eventName);

      const setupPromise = this.signal.subscribe(signalChannel, (envelope) => {
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

  private warnDeprecatedAlias(aliasName: string, canonicalName: string, until?: string): void {
    if (this.warnedAliases.has(aliasName)) return;
    this.warnedAliases.add(aliasName);
    const expiry = until ? ` (removal scheduled after ${until})` : '';
    console.warn(
      `[event-catalog] publish("${aliasName}") routed via deprecated alias — `
      + `canonical name is "${canonicalName}". Update producers to emit the `
      + `canonical name${expiry}.`,
    );
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
