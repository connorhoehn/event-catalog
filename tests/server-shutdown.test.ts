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

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AdmissionHttpServer } from 'distributed-core/server';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SHUTDOWN_DRAIN_MS, startServer } from '../src/server/index.js';

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

// ─── The AWS SDK client pair ─────────────────────────────────────────────
//
// `startServer` builds `DynamoDBDocumentClient.from(new DynamoDBClient({}))`
// and hands the document client to `DLQStore`. Whoever writes the release
// for it has one obvious-looking option (`dynamoClient.destroy()`) and one
// correct one, and the obvious one silently does nothing: the document
// client is a translating wrapper that shares the base client's config and
// middleware stack, and its `destroy()` is an empty method body — the AWS
// SDK documents the caller of `.from()` as the owner of the wrapped
// client's lifecycle.
//
// That is why `startServer` keeps `dynamoBaseClient` in its own variable.
// This suite pins the behaviour that makes the extra variable necessary,
// against the installed SDK rather than against its docs, so a version
// bump that changed it would show up here as a failure rather than as a
// process that stops exiting on SIGTERM.

/** A local stand-in for DynamoDB, so nothing here leaves the machine. */
let fakeDynamo: http.Server;
let fakeDynamoUrl: string;

/**
 * AWS settings for the whole file, restored afterwards.
 *
 * Without them the SDK goes looking for a region and for credentials, and
 * on a machine with neither it walks its provider chain — including the
 * EC2 instance-metadata endpoint, which on a developer laptop or a CI box
 * does not answer and does not refuse. `startServer` awaits `ensureTable()`
 * at boot, so that shows up as a test that intermittently hangs for its
 * whole timeout rather than as anything to do with shutdown. Pinning
 * region, credentials and endpoint keeps every byte of this suite on
 * loopback and makes boot deterministic.
 */
const AWS_ENV_KEYS = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_EC2_METADATA_DISABLED',
  'AWS_ENDPOINT_URL',
  'AWS_ENDPOINT_URL_DYNAMODB',
  'DYNAMODB_ENDPOINT',
] as const;
const savedAwsEnv = new Map<string, string | undefined>();

beforeAll(async () => {
  fakeDynamo = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/x-amz-json-1.0' });
      res.end(JSON.stringify({ Table: { TableStatus: 'ACTIVE' } }));
    });
  });
  await new Promise<void>(resolve => fakeDynamo.listen(0, '127.0.0.1', resolve));
  const addr = fakeDynamo.address();
  fakeDynamoUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  for (const key of AWS_ENV_KEYS) savedAwsEnv.set(key, process.env[key]);
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_DEFAULT_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
  process.env.AWS_ENDPOINT_URL = fakeDynamoUrl;
  process.env.AWS_ENDPOINT_URL_DYNAMODB = fakeDynamoUrl;
  process.env.DYNAMODB_ENDPOINT = fakeDynamoUrl;
});

afterAll(async () => {
  for (const [key, value] of savedAwsEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>(resolve => fakeDynamo.close(() => resolve()));
});

/** Every keep-alive socket the client's request handler is holding. */
function pooledSockets(client: DynamoDBClient): import('node:net').Socket[] {
  const handler = client.config.requestHandler as unknown as {
    config?: { httpAgent?: http.Agent };
  };
  const free = handler.config?.httpAgent?.freeSockets ?? {};
  return Object.values(free).flat() as import('node:net').Socket[];
}

describe('the DynamoDB client the DLQ store holds', () => {
  /** The exact pair `startServer` builds, pointed at the local stub. */
  async function connectedPair(): Promise<{
    base: DynamoDBClient;
    doc: DynamoDBDocumentClient;
  }> {
    const base = new DynamoDBClient({
      endpoint: fakeDynamoUrl,
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const doc = DynamoDBDocumentClient.from(base);
    // One round trip, so the keep-alive agent actually pools a socket —
    // which is the handle that keeps the event loop alive.
    await base.send(new DescribeTableCommand({ TableName: 'event-catalog-dlq' }));
    return { base, doc };
  }

  it('keeps a live pooled socket after a request', async () => {
    const { base } = await connectedPair();
    const sockets = pooledSockets(base);
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets.every(s => s.destroyed)).toBe(false);
    base.destroy();
  });

  it('is NOT released by the document client — its destroy() is a no-op', async () => {
    const { base, doc } = await connectedPair();

    doc.destroy();

    // Still open. This is the whole defect: `shutdown()` could have
    // contained a `dynamoClient.destroy()` that read as correct in review
    // and released nothing at runtime.
    expect(pooledSockets(base).some(s => !s.destroyed)).toBe(true);

    base.destroy();
  });

  it('IS released by the base client, which is why startServer keeps it', async () => {
    const { base } = await connectedPair();
    const sockets = pooledSockets(base);

    base.destroy();

    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets.every(s => s.destroyed)).toBe(true);
  });
});

// ─── The whole shutdown path, end to end ─────────────────────────────────
//
// `startServer` boots with every dependency down: Redis connect is
// boot-bounded and falls through to degraded mode, the message-queue probe
// fails the same way, and the DLQ table provision is wrapped in a catch.
// So the real `shutdown()` — not a re-creation of its steps — can be
// driven here in about a third of a second.
//
// On asserting "no remaining handles": `process.getActiveResourcesInfo()`
// is process-wide, and the vitest worker running this file holds its own
// sockets, timers and file watchers that come and go independently. An
// absolute assertion would be flaky, so what is asserted is the DELTA
// across boot-and-shutdown: whatever handles were alive before startServer
// must be exactly what is alive after shutdown resolves. That is the
// property that matters — a shutdown which leaks nothing leaves the census
// where it found it — and it is stable because both samples are taken in
// the same worker milliseconds apart.
//
// The census is taken over an idle server on purpose. Serving even one
// request leaves timers behind that `shutdown()` does not own and cannot
// clear: Node's HTTP server arms per-connection header/request timeout
// machinery on first connection, and the test's own client contributes
// more. Those are unref'd, so they do not hold the loop, but
// `getActiveResourcesInfo()` reports refs and unrefs alike and cannot
// tell them apart — which would make a traffic-carrying census assert
// something it cannot actually see. What `shutdown()` does own is
// everything `startServer` opened at boot: three intervals, the audit
// listener, the SSE streams, both transports, the Redis client, the
// DynamoDB socket pool and the listener. That is exactly what an idle
// boot-and-shutdown exercises. The drain under real traffic is covered
// separately by the SSE test at the end of this file.

/** Handle kinds that can keep the event loop alive, counted by kind. */
function handleCensus(): Record<string, number> {
  const census: Record<string, number> = {};
  for (const kind of process.getActiveResourcesInfo()) {
    census[kind] = (census[kind] ?? 0) + 1;
  }
  return census;
}

/** Let libuv close what was destroyed synchronously during shutdown. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  await delay(50);
}

/** Boot a real server against unreachable dependencies. */
function bootOffline(): Promise<{ address(): unknown; shutdown(): Promise<void> }> {
  return startServer({
    port: 0,
    // Port 1 is reliably closed and refuses immediately, so the degraded
    // paths are taken without any timeout wait.
    redisUrl: 'redis://127.0.0.1:1',
    messageQueueUrl: 'http://127.0.0.1:1',
    shutdownDrainMs: 200,
    // Silence the expected degraded-mode diagnostics.
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  }) as Promise<{ address(): unknown; shutdown(): Promise<void> }>;
}

describe('startServer().shutdown() releases everything it opened', () => {
  it('leaves the process holding exactly the handles it started with', async () => {
    await settle();
    const before = handleCensus();

    const server = await bootOffline();
    const addr = server.address() as { port: number } | null;
    expect(addr?.port).toBeGreaterThan(0);

    // Let the fire-and-forget boot work (the registry coordinator's
    // `start()`, in particular) reach a settled state first. Shutting down
    // on top of a half-finished boot is a real scenario, but it is a
    // different one, and mixing it in here would make a census of what
    // shutdown released depend on what boot had got around to opening.
    await settle();

    // Booting really did take handles — otherwise the assertion below
    // would pass against a server that never opened anything.
    expect(handleCensus()).not.toEqual(before);

    await server.shutdown();
    await settle();

    // Every interval (health probe, metrics snapshot, subscriber sweep),
    // the audit listener, every SSE stream, both transports, the registry
    // Redis client, the DynamoDB keep-alive pool and the listener itself.
    expect(handleCensus()).toEqual(before);
  }, 60_000);

  it('is idempotent — a second SIGTERM mid-drain does not re-enter it', async () => {
    const server = await bootOffline();

    // A container runtime commonly sends SIGTERM and then SIGKILL-adjacent
    // follow-ups; the CLI wires both signals to this same function. Two
    // concurrent passes would call admission.stop() on an already-closing
    // server and destroy clients out from under the first pass's awaits.
    const first = server.shutdown();
    const second = server.shutdown();
    expect(second).toBe(first);

    await Promise.all([first, second, server.shutdown()]);
    expect(server.address()).toBeNull();
  }, 60_000);

  it('completes even though releasing the degraded Redis client throws', async () => {
    // In degraded mode `redisClient.quit()` rejects with "The client is
    // closed". The releases are sequential, so before they were each
    // guarded that rejection propagated out of shutdown() and everything
    // ordered after it — including the DynamoDB destroy — never ran. The
    // CLI's handler is `void shutdown().then(() => process.exit(0))`, so
    // it also meant the process never exited.
    const server = await bootOffline();
    await expect(server.shutdown()).resolves.toBeUndefined();
  }, 60_000);

  it('terminates even when a component stop() never returns', async () => {
    // `coordinator.stop()` does not always come back when its Redis was
    // never reachable: `coordinator.start()` is fire-and-forget at boot, and
    // a stop() racing an in-flight start() can wait forever. Reproduced at
    // roughly one boot in two against a refused Redis, and it hung
    // `shutdown()` itself — the same "SIGTERM never completes" symptom the
    // SSE close was added to fix, reached by a different route.
    //
    // The coordinator's own race is registry-coordinator.ts's to fix. What
    // is asserted here is the property this file owns: no single component
    // gets to decide the process never exits. Each release is bounded by
    // the same window as the socket drain, and shutdown continues past one
    // that overruns.
    //
    // Driven by shutting down repeatedly against unreachable dependencies,
    // which is exactly the condition that provokes the race. Before the
    // bound, this test hung; the timeout is what it asserts.
    for (let i = 0; i < 6; i++) {
      const server = await bootOffline();
      const started = Date.now();
      await server.shutdown();
      // Six release slots at 200ms each is the theoretical worst case;
      // in practice at most one overruns.
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  }, 60_000);

  it('is bounded even with an SSE stream open against the real server', async () => {
    const server = await bootOffline();
    const addr = server.address() as { port: number };

    // /api/flow never ends on its own. sseRegistry.closeAll() runs first
    // in shutdown() precisely so http.Server.close() is not waiting on it.
    //
    // Resolved on `response`, not on the first frame: the real endpoint
    // flushes its headers and then stays silent until an event fires, so
    // waiting for data would wait forever. Headers received is already
    // proof the connection is established and open.
    const client = await new Promise<http.ClientRequest>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: addr.port, path: '/api/flow', agent: false },
        res => { res.resume(); resolve(req); },
      );
      req.on('error', reject);
    });

    const started = Date.now();
    await server.shutdown();
    const elapsed = Date.now() - started;

    // Two drain windows (200ms each) plus slack. The assertion that
    // matters is that it terminates at all; the ceiling keeps a
    // regression from passing by being merely slow.
    expect(elapsed).toBeLessThan(2_000);
    expect(server.address()).toBeNull();

    client.destroy();
  }, 60_000);
});
