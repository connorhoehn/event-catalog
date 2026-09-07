// src/server/routes/transports.ts
//
// Per-transport inventory: Redis pub/sub channels observed by the
// SignalTransport, and message-queue queues observed by the
// DurableTransport.

import type { Request, Response } from '../http-router.js';
import type { RoutesDeps } from './_shared.js';

export function createTransportHandlers(deps: RoutesDeps) {
  const { signal, durable } = deps;

  // Signal transport channels
  function signalChannels(_req: Request, res: Response): void {
    const allMetrics = signal.getAllMetrics();
    const channels: Array<{ channel: string; publishCount: number; lastPublishedAt: string | null; subscriberCount: number }> = [];

    for (const [channel, m] of allMetrics) {
      channels.push({
        channel,
        publishCount: m.publishCount,
        lastPublishedAt: m.lastPublishedAt,
        subscriberCount: m.subscriberCount,
      });
    }

    res.json({ channels, total: channels.length });
  }

  // Durable transport queues
  function durableQueues(_req: Request, res: Response): void {
    const allMetrics = durable.getAllMetrics();
    const queues: Array<{ queue: string; sent: number; received: number; failed: number; inFlight: number }> = [];

    for (const [queue, m] of allMetrics) {
      queues.push({ queue, ...m });
    }

    res.json({ queues, total: queues.length });
  }

  return { signalChannels, durableQueues };
}
