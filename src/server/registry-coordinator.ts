/**
 * RegistryCoordinator — multi-replica convergence via Redis pub/sub.
 *
 * Every catalog server instance broadcasts mutations (declare, deprecate,
 * subscriber-add, etc.) to the `event-catalog:mutations` channel. All
 * other replicas receive the message and apply it to their in-process
 * registry, converging within the Redis pub/sub latency (~1ms LAN).
 *
 * Reads are always served from the local in-process map — no Redis hop.
 * A replica ignores its own broadcasts via the per-process replicaId.
 *
 * Fire-and-forget: broadcast failures are logged but never propagate.
 * If a replica misses a message it will re-sync on the next declare from
 * any service (which is idempotent).
 */

import { createClient } from 'redis';
import {
  createBootBoundedReconnectStrategy,
  formatRedisError,
} from '../utils/redis-boot-strategy.js';
import type { Registry } from '../registry/index.js';
import type { EventDeclaration } from '../types/index.js';

export const MUTATIONS_CHANNEL = 'event-catalog:mutations';

export type MutationKind =
  | 'declare'
  | 'deprecate'
  | 'undeprecate'
  | 'subscriber.add'
  | 'subscriber.remove'
  | 'remove';

export interface MutationMessage {
  replicaId: string;
  kind: MutationKind;
  payload: unknown;
}

type RedisClient = ReturnType<typeof createClient>;

export class RegistryCoordinator {
  readonly replicaId: string = crypto.randomUUID();
  private pubClient: RedisClient | null = null;
  private subClient: RedisClient | null = null;
  private _started = false;

  get started(): boolean { return this._started; }

  async start(redisUrl: string, registry: Registry): Promise<void> {
    if (this._started) return;
    this._started = true;

    // Boot-bounded reconnect — start() is fire-and-forget from createServer(),
    // so an unbounded first-connect retry would spin forever in the background
    // logging noise instead of failing once into the caller's catch.
    const pubBootStrategy = createBootBoundedReconnectStrategy({ label: 'coordinator pub' });
    const subBootStrategy = createBootBoundedReconnectStrategy({ label: 'coordinator sub' });

    this.pubClient = createClient({
      url: redisUrl,
      socket: { reconnectStrategy: pubBootStrategy.reconnectStrategy },
    });
    this.subClient = createClient({
      url: redisUrl,
      socket: { reconnectStrategy: subBootStrategy.reconnectStrategy },
    });

    this.pubClient.on('error', (err: Error) =>
      console.warn('[registry-coordinator] pub client error:', formatRedisError(err)),
    );
    this.subClient.on('error', (err: Error) =>
      console.warn('[registry-coordinator] sub client error:', formatRedisError(err)),
    );

    await Promise.all([
      this.pubClient.connect().then(() => pubBootStrategy.markConnected()),
      this.subClient.connect().then(() => subBootStrategy.markConnected()),
    ]);

    await (this.subClient as unknown as {
      subscribe(ch: string, cb: (msg: string) => void): Promise<void>;
    }).subscribe(MUTATIONS_CHANNEL, (message: string) => {
      let mutation: MutationMessage;
      try { mutation = JSON.parse(message) as MutationMessage; } catch { return; }
      // Skip our own broadcasts — already applied locally.
      if (mutation.replicaId === this.replicaId) return;
      this.applyMutation(mutation, registry);
    });

    console.log(`[registry-coordinator] replica ${this.replicaId.slice(0, 8)} subscribed to ${MUTATIONS_CHANNEL}`);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([
      this.subClient?.quit(),
      this.pubClient?.quit(),
    ]);
    this.pubClient = null;
    this.subClient = null;
    this._started = false;
  }

  /** Publish a mutation to all peer replicas. Never throws. */
  async broadcast(kind: MutationKind, payload: unknown): Promise<void> {
    if (!this.pubClient) return;
    const msg: MutationMessage = { replicaId: this.replicaId, kind, payload };
    try {
      await (this.pubClient as unknown as {
        publish(ch: string, msg: string): Promise<number>;
      }).publish(MUTATIONS_CHANNEL, JSON.stringify(msg));
    } catch (err) {
      console.warn('[registry-coordinator] broadcast failed:', (err as Error).message);
    }
  }

  private applyMutation(mutation: MutationMessage, registry: Registry): void {
    try {
      switch (mutation.kind) {
        case 'declare':
          registry.declare(mutation.payload as EventDeclaration);
          break;
        case 'deprecate': {
          const { name, opts } = mutation.payload as { name: string; opts?: { reason?: string; by?: string } };
          registry.deprecate(name, opts);
          break;
        }
        case 'undeprecate':
          registry.undeprecate((mutation.payload as { name: string }).name);
          break;
        case 'subscriber.add': {
          const { eventName, serviceName } = mutation.payload as { eventName: string; serviceName: string };
          registry.addSubscriber(eventName, serviceName);
          break;
        }
        case 'subscriber.remove': {
          const { eventName, serviceName } = mutation.payload as { eventName: string; serviceName: string };
          registry.removeSubscriber(eventName, serviceName);
          break;
        }
        case 'remove':
          registry.remove((mutation.payload as { name: string }).name);
          break;
        default:
          console.warn('[registry-coordinator] unknown mutation kind:', (mutation as MutationMessage).kind);
      }
    } catch (err) {
      console.warn(
        '[registry-coordinator] failed to apply remote mutation:',
        (err as Error).message,
        mutation.kind,
      );
    }
  }
}
