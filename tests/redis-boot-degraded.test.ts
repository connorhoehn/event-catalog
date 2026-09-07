// tests/redis-boot-degraded.test.ts
//
// Boot resilience, end to end: with Redis unreachable the service must
// still bind its port and answer /health. A registry that refuses to
// start because Redis is slow is an outage amplifier — every producer
// that syncs its declarations at boot would stall behind it, and the
// library's "publish never blocks on the server" guarantee only holds if
// the server is actually there to be ignored.
//
// tests/redis-boot-strategy.test.ts covers the reconnect-strategy unit in
// isolation. This one spawns the real bin, because the failure it guards
// against (connect() retrying forever so `app.listen()` is never reached)
// is invisible from inside a unit test.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(REPO_ROOT, 'src', 'cli', 'index.ts');

/** Ask the OS for a port, then hand it back — good enough for a test. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('no port')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

let child: ChildProcessWithoutNullStreams | undefined;
let output = '';

function startCatalog(env: Record<string, string>): ChildProcessWithoutNullStreams {
  const proc = spawn(process.execPath, ['--import', 'tsx', BIN], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NO_COLOR: '1',
      // Unset AWS config so the DLQ table probe fails fast on "region is
      // missing" instead of retrying against real DynamoDB.
      AWS_REGION: '',
      AWS_DEFAULT_REGION: '',
      // One attempt: we want the degraded path immediately, not in 3s.
      REDIS_BOOT_CONNECT_ATTEMPTS: '1',
      ...env,
    },
  });
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (c: string) => { output += c; });
  proc.stderr.on('data', (c: string) => { output += c; });
  return proc;
}

/** Poll until the server answers, or give up. */
async function waitForHealth(port: number, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/health`);
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(
    `/health never answered on :${port} within ${timeoutMs}ms `
    + `(last error: ${String(lastErr)})\n--- process output ---\n${output}`,
  );
}

afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise(r => child?.once('exit', r));
  }
  child = undefined;
  output = '';
});

describe('boot with Redis down', () => {
  it('still binds the port and serves /health', async () => {
    const port = await freePort();
    // :1 is reserved and nothing listens there — an instant ECONNREFUSED.
    child = startCatalog({
      PORT: String(port),
      REDIS_URL: 'redis://127.0.0.1:1',
      MESSAGE_QUEUE_URL: 'http://127.0.0.1:1',
    });

    const res = await waitForHealth(port, 25_000);

    // Redis being down is a real degradation, so a 503 is correct — what
    // matters is that something answered at all.
    expect([200, 503]).toContain(res.status);

    const body = await res.json() as {
      service: string;
      status: string;
      checks: { id: string; status: string }[];
    };
    expect(body.service).toBe('event-catalog');
    const redis = body.checks.find(c => c.id === 'redis');
    expect(redis, 'health report should name the redis check').toBeDefined();
    expect(redis?.status).not.toBe('healthy');

    // The registry itself is in-memory, so it stays up even with no Redis.
    expect(body.checks.find(c => c.id === 'registry')?.status).toBe('healthy');

    // And the operator gets told why, in words — not an empty
    // AggregateError message (see formatRedisError()).
    expect(output).toContain('degraded mode');
  }, 40_000);

  it('serves the read-only API surface while degraded', async () => {
    const port = await freePort();
    child = startCatalog({
      PORT: String(port),
      REDIS_URL: 'redis://127.0.0.1:1',
      MESSAGE_QUEUE_URL: 'http://127.0.0.1:1',
    });
    await waitForHealth(port, 25_000);

    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(200);
  }, 40_000);
});

describe('boot with a misconfigured environment', () => {
  it('exits 2 naming $REDIS_URL rather than failing downstream', async () => {
    const port = await freePort();
    child = startCatalog({ PORT: String(port), REDIS_URL: '' });
    const code = await new Promise<number | null>(r => child?.once('exit', r));

    expect(code).toBe(2);
    expect(output).toContain('$REDIS_URL is required');
    expect(output).toContain('refusing to start');
    // No socket was opened.
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 30_000);

  it('exits 2 on a malformed $PORT rather than binding NaN', async () => {
    child = startCatalog({ PORT: 'abc', REDIS_URL: 'redis://127.0.0.1:1' });
    const code = await new Promise<number | null>(r => child?.once('exit', r));
    expect(code).toBe(2);
    expect(output).toContain('$PORT');
  }, 30_000);
});
