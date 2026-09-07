// tests/server-shutdown.test.ts
//
// The SIGTERM path must actually terminate.
//
// `AdmissionHttpServer.stop()` is `http.Server.close()`, which resolves
// only once EVERY connection has ended. `startServer`'s `shutdown()`
// awaited it unconditionally, ahead of `signal.disconnect()`,
// `coordinator.stop()` and `redisClient.quit()`.
//
// An open SSE stream (/api/flow, /api/audit) is exactly such a
// connection — never ending is the point of the endpoint — so a single
// connected admin-UI tab made shutdown hang until the orchestrator's
// SIGKILL, and Redis was never closed cleanly. (Idle keep-alive sockets
// are NOT a problem on the Node versions this package supports: since
// Node 19, `close()` releases those itself. The third test below pins
// that, so a regression there is caught rather than assumed.)
//
// These tests drive the raw AdmissionHttpServer — the exact object
// `startServer` shuts down — to prove the hang is real and that the
// drain sequence `shutdown()` now runs (close streams → stop() →
// closeIdleConnections → bounded wait → closeAllConnections) resolves.

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { AdmissionHttpServer } from 'distributed-core/server';
import { SHUTDOWN_DRAIN_MS } from '../src/server/index.js';

const servers: AdmissionHttpServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    s?.nodeServer.closeAllConnections?.();
    await s?.stop().catch(() => {});
  }
});

/** Bind a server whose handler keeps the response open, SSE-style. */
async function startSseServer(): Promise<{ server: AdmissionHttpServer; port: number }> {
  const server = new AdmissionHttpServer({
    port: 0,
    hostname: '127.0.0.1',
    onRequest: (_req, res) => {
      res.nodeRes.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.nodeRes.write(': connected\n\n');
      // Deliberately never ended — same as the real /api/flow handler.
    },
  });
  await server.start();
  servers.push(server);
  return { server, port: server.address()!.port };
}

/** Open a client connection and resolve once the first SSE frame lands. */
function connectSse(port: number): Promise<http.ClientRequest> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/flow' }, (res) => {
      res.on('data', () => resolve(req));
    });
    req.on('error', reject);
  });
}

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

describe('shutdown drain', () => {
  it('stop() alone never resolves while an SSE stream is open', async () => {
    const { server, port } = await startSseServer();
    const client = await connectSse(port);

    let resolved = false;
    void server.stop().then(() => { resolved = true; });

    await delay(600);
    expect(resolved).toBe(false);

    client.destroy();
  });

  it('the drain sequence shutdown() runs does resolve, with a stream still open', async () => {
    const { server, port } = await startSseServer();
    const client = await connectSse(port);

    // The sequence from startServer's shutdown(), minus the Redis parts:
    // begin the close, release idle sockets, wait a bounded window, then
    // force the remainder closed.
    const stopped = server.stop().catch(() => {});
    server.nodeServer.closeIdleConnections?.();

    const drainMs = 300;
    const raced = await Promise.race([
      stopped.then(() => 'closed' as const),
      delay(drainMs).then(() => 'timeout' as const),
    ]);
    expect(raced).toBe('timeout');

    server.nodeServer.closeAllConnections?.();
    // The point of the whole exercise: this await terminates.
    await stopped;
    expect(server.address()).toBeNull();

    client.destroy();
  });

  it('an idle keep-alive socket does NOT block stop() on a supported Node', async () => {
    const server = new AdmissionHttpServer({
      port: 0,
      hostname: '127.0.0.1',
      onRequest: (_req, res) => { res.json(200, { ok: true }); },
    });
    await server.start();
    servers.push(server);
    const port = server.address()!.port;

    // A keep-alive agent leaves the socket open after the response —
    // exactly what a browser or a Node fetch pool does.
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', agent }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      });
      req.on('error', reject);
    });

    // Node >= 19 destroys idle connections inside close(). `shutdown()`
    // still calls closeIdleConnections() explicitly — it is cheap and it
    // keeps the drain correct if that ever regresses.
    let resolved = false;
    const stopped = server.stop().then(() => { resolved = true; });
    await delay(300);
    expect(resolved).toBe(true);

    await stopped;
    agent.destroy();
  });

  it('exports a finite default drain window', () => {
    expect(SHUTDOWN_DRAIN_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SHUTDOWN_DRAIN_MS)).toBe(true);
  });
});
