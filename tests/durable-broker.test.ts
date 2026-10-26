import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { createServiceRequestHeaders } from '@connorhoehn/service-runtime';
import { HttpMessageQueue } from '@connorhoehnslalom/message-queue/client';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  DurableSubscriptionUnavailableError,
  DurableTransport,
  type DurableTransportConfig,
} from '../src/client/durable';

// Executes the installed, SHA-pinned broker package, never a sibling source tree.
const broker = createRequire(import.meta.url).resolve(
  '@connorhoehnslalom/message-queue/dist/server/index.js',
);
const live = process.env.EC_DDB_INTEGRATION === '1' ? describe : describe.skip;
live(
  'catalog subscriber against independent transactional broker processes',
  () => {
    const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000';
    const table = `ec-consumer-${randomUUID()}`;
    const secret = `test-${randomUUID()}`;
    const sign = createServiceRequestHeaders({
      secret,
      serviceId: 'catalog-test',
      audience: 'message-queue',
    });
    const children: { child: ChildProcess; exited: Promise<void> }[] = [];
    const transports: DurableTransport[] = [];
    const proxies: Server[] = [];
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    let raw: DynamoDBClient;
    let created = false;
    let origin: string;
    let competitor: HttpMessageQueue;

    async function boot() {
      const child = spawn(process.execPath, [broker], {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '0',
          LOG_LEVEL: 'info',
          MESSAGE_QUEUE_STORE: 'ddb-v2',
          MESSAGE_QUEUE_PROFILE: 'local-ephemeral',
          MESSAGE_QUEUE_DELIVERY_TABLE: table,
          DYNAMODB_ENDPOINT: endpoint,
          AWS_EC2_METADATA_DISABLED: 'true',
          SCHEMA_VALIDATION_ENABLED: 'false',
          MQ_SERVICE_AUTH_SECRET: secret,
          MQ_SERVICE_AUTH_ALLOWED_SERVICES: 'catalog-test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.once('error', () => resolve());
      });
      children.push({ child, exited });
      return new Promise<string>((resolve, reject) => {
        let output = '',
          buffer = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Broker startup timeout: ${output}`));
        }, 15000);
        const fail = () => {
          clearTimeout(timer);
          reject(new Error(`Broker startup failed: ${output}`));
        };
        child.once('error', fail);
        child.once('exit', fail);
        child.stderr!.on('data', (chunk) => {
          output = (output + String(chunk)).slice(-4000);
        });
        child.stdout!.on('data', (chunk) => {
          buffer += String(chunk);
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            output = (output + line).slice(-4000);
            try {
              const event = JSON.parse(line);
              if (event.msg === 'Message queue server started' && event.port) {
                clearTimeout(timer);
                child.removeListener('error', fail);
                child.removeListener('exit', fail);
                resolve(`http://127.0.0.1:${event.port}`);
              }
            } catch {
              /* Retain diagnostic text if boot fails. */
            }
          }
        });
      });
    }
    async function transport(extra: Partial<DurableTransportConfig> = {}) {
      const value = new DurableTransport({
        url: origin,
        requestHeaders: sign,
        logger,
        retryBaseMs: 1,
        ...extra,
      });
      transports.push(value);
      await value.connect();
      return value;
    }
    const envelope = (id: string) => ({
      eventName: 'job:queued',
      payload: { id },
      metadata: { id, producer: 'catalog-test', timestamp: 1 },
    });
    const queue = () => `work-${randomUUID()}`;
    async function receive(name: string, count = 1) {
      let messages: Awaited<ReturnType<HttpMessageQueue['receive']>> = [];
      await vi.waitFor(
        async () => {
          messages.push(
            ...(await competitor.receive(name, {
              max: count - messages.length,
              visibilityTimeoutSeconds: 5,
            })),
          );
          expect(messages).toHaveLength(count);
        },
        { timeout: 6000, interval: 50 },
      );
      return messages;
    }

    beforeAll(async () => {
      const url = new URL(endpoint);
      if (
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error('Only loopback HTTP DynamoDB is allowed');
      raw = new DynamoDBClient({
        endpoint,
        region: 'us-east-1',
        maxAttempts: 1,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
      });
      await raw.send(
        new CreateTableCommand({
          TableName: table,
          BillingMode: 'PAY_PER_REQUEST',
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
        }),
      );
      created = true;
      origin = await boot();
      competitor = new HttpMessageQueue({
        baseUrl: await boot(),
        requestHeaders: sign,
      });
      await competitor.ready();
    }, 40000);
    afterEach(async () => {
      await Promise.all(
        transports.splice(0).map((value) => value.disconnect()),
      );
      await Promise.all(
        proxies.splice(0).map((server) => {
          server.closeAllConnections();
          return new Promise<void>((resolve) => server.close(() => resolve()));
        }),
      );
    });
    afterAll(async () => {
      try {
        await Promise.all(
          children.map(async ({ child, exited }) => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill('SIGTERM');
            const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
            try {
              await exited;
            } finally {
              clearTimeout(timer);
            }
          }),
        );
      } finally {
        try {
          if (created)
            await raw.send(new DeleteTableCommand({ TableName: table }));
        } finally {
          raw?.destroy();
        }
      }
    }, 15000);

    it('renews all fetched receipts during a slow handler and drains accepted work', async () => {
      const value = await transport();
      const name = queue();
      for (const id of ['a', 'b']) await value.publish(name, envelope(id));
      let finish!: () => void;
      const held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const handled: string[] = [];
      value.subscribe(
        name,
        async (event) => {
          handled.push(event.metadata.id);
          if (handled.length === 1) await held;
        },
        { visibilityTimeout: 1, batchSize: 2, pollingInterval: 10 },
      );
      try {
        await vi.waitFor(() => expect(handled).toEqual(['a']));
        await sleep(1400); // Both leases must outlive the initial one-second deadline.
        expect(await competitor.receive(name, { max: 2 })).toEqual([]);
        expect(value.getMetrics(name)?.inFlight).toBe(2);
        finish();
        await vi.waitFor(() =>
          expect(value.getMetrics(name)?.received).toBe(2),
        );
        expect(handled).toEqual(['a', 'b']);
        expect(value.getOverflowStats().handlerFailures).toBe(0);
      } finally {
        finish();
      }
    }, 10000);

    it('keeps renewing an accepted handler while disconnect waits for its completion', async () => {
      const value = await transport({ drainTimeoutMs: 4000 });
      const name = queue();
      await value.publish(name, envelope('drain'));
      let started = false;
      value.subscribe(
        name,
        async () => {
          started = true;
          await sleep(1600);
        },
        { visibilityTimeout: 1, pollingInterval: 10 },
      );
      await vi.waitFor(() => expect(started).toBe(true));
      const done = value.disconnect();
      await sleep(1100);
      expect(await competitor.receive(name)).toEqual([]);
      await done;
      expect(value.getMetrics(name)).toMatchObject({
        received: 1,
        inFlight: 0,
      });
      expect(await competitor.receive(name)).toEqual([]);
    }, 10000);

    it('bounds uncooperative handlers on drain and leaves unstarted batch members for redelivery', async () => {
      const value = await transport({ drainTimeoutMs: 30 });
      const name = queue();
      for (const id of ['a', 'b']) await value.publish(name, envelope(id));
      const signals: AbortSignal[] = [];
      value.subscribe(
        name,
        async (_, context) => {
          signals.push(context.signal);
          await new Promise(() => {});
        },
        { visibilityTimeout: 1, batchSize: 2 },
      );
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      await value.disconnect();
      expect(signals[0].aborted).toBe(true);
      expect(value.getMetrics(name)).toMatchObject({
        received: 0,
        inFlight: 0,
      });
      expect(
        (await receive(name, 2)).map(
          (message) => JSON.parse(message.body).metadata.id,
        ),
      ).toEqual(['a', 'b']);
      expect(signals).toHaveLength(1);
      expect(value.getOverflowStats().handlerFailures).toBe(0);
    }, 10000);

    it('aborts the handler on renewal loss without poisoning or acknowledging its source', async () => {
      const value = await transport({
        requestHeaders: (request) => {
          if (request.method === 'PATCH')
            throw new Error('injected renewal outage');
          return sign(request);
        },
      });
      const name = queue();
      await value.publish(name, envelope('renew-loss'));
      let signal: AbortSignal | undefined;
      const sub = value.subscribe(
        name,
        async (_, context) => {
          signal = context.signal;
          await new Promise(() => {});
        },
        { visibilityTimeout: 1 },
      );
      await vi.waitFor(() => expect(signal?.aborted).toBe(true), {
        timeout: 3000,
      });
      sub();
      await sub.done;
      expect(value.getOverflowStats().handlerFailures).toBe(0);
      expect((await receive(name))[0].approximate_receive_count).toBe(2);
    }, 10000);

    it('redelivers after an uncertain ACK without charging the handler failure budget', async () => {
      let allowAck = false;
      const value = await transport({
        maxProcessingAttempts: 1,
        requestHeaders: (request) => {
          if (request.method === 'DELETE' && !allowAck)
            throw new Error('injected ACK connection loss');
          return sign(request);
        },
      });
      const name = queue();
      await value.publish(name, envelope('ack-loss'));
      const handler = vi.fn(async () => {});
      value.subscribe(name, handler, {
        visibilityTimeout: 1,
        pollingInterval: 10,
      });
      await vi.waitFor(() => expect(value.getMetrics(name)?.failed).toBe(1));
      allowAck = true;
      await vi.waitFor(() => expect(value.getMetrics(name)?.received).toBe(1), {
        timeout: 5000,
      });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(value.getOverflowStats().handlerFailures).toBe(0);
      expect(value.getDLQ()).toEqual([]);
    }, 10000);

    it('preserves FIFO group/dedup fields and delegates poison transfer to the broker', async () => {
      const value = await transport();
      const name = `${queue()}.fifo`;
      const policy = { fifo: true, dlqAfterAttempts: 1 };
      await value.publish(name, envelope('stable'), policy, {
        groupId: 'team',
      });
      await value.publish(name, envelope('stable'), policy, {
        groupId: 'team',
      });
      const handler = vi.fn(async () => {
        throw new Error('poison');
      });
      const sub = value.subscribe(name, handler, {
        visibilityTimeout: 1,
        pollingInterval: 10,
        queueOptions: policy,
      });
      const [dead] = await receive(name.replace('.fifo', '-dlq.fifo'));
      sub();
      await sub.done;
      expect(JSON.parse(dead.body).metadata.id).toBe('stable');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(await competitor.receive(name)).toEqual([]);
    }, 10000);

    it('refuses conflicting policy and does not create a source whose required DLQ failed', async () => {
      const value = await transport();
      const existing = queue();
      await competitor.ensure(existing, {
        message_retention_period_seconds: 90,
      });
      await expect(
        value.publish(existing, envelope('conflict'), { retention: 100 }),
      ).rejects.toMatchObject({ code: 'ConfigurationConflict' });
      expect(await competitor.receive(existing)).toEqual([]);
      const guarded = await transport({
        requestHeaders: (request) => {
          if (request.url.endsWith('-dlq')) throw new Error('DLQ unavailable');
          return sign(request);
        },
      });
      const name = queue();
      await expect(
        guarded.publish(name, envelope('no-downgrade'), {
          dlqAfterAttempts: 2,
        }),
      ).rejects.toThrow('TransportError');
      expect(await competitor.inspect(name)).toBeNull();
    });
    it('reports an ACK whose committed response was lost as uncertain without poisoning the message', async () => {
      let dropped = false;
      const proxy = createServer((req, res) => {
        const upstream = httpRequest(
          new URL(req.url!, origin),
          { method: req.method, headers: req.headers },
          (reply) => {
            if (req.method === 'DELETE' && !dropped) {
              dropped = true;
              reply.resume();
              reply.on('end', () => res.destroy());
              return;
            }
            res.writeHead(reply.statusCode ?? 500, reply.headers);
            reply.pipe(res);
          },
        );
        upstream.on('error', () => res.destroy());
        req.on('aborted', () => upstream.destroy());
        req.pipe(upstream);
      });
      proxies.push(proxy);
      await new Promise<void>((resolve) =>
        proxy.listen(0, '127.0.0.1', resolve),
      );
      const value = await transport({
        url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
        maxProcessingAttempts: 1,
      });
      const name = queue();
      await value.publish(name, envelope('lost-response'));
      const handler = vi.fn(async () => {});
      value.subscribe(name, handler, {
        pollingInterval: 10,
        visibilityTimeout: 1,
      });
      await vi.waitFor(() => expect(value.getMetrics(name)?.failed).toBe(1));
      await value.disconnect();
      expect(dropped).toBe(true);
      expect(value.getMetrics(name)?.received).toBe(0);
      expect(value.getOverflowStats().handlerFailures).toBe(0);
      expect(value.getDLQ()).toEqual([]);
      await sleep(1100);
      expect(await competitor.receive(name)).toEqual([]);
      expect(handler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('delivers an independent copy to each explicit subscription and splits work inside one', async () => {
      const producer = await transport();
      const name = queue();
      await producer.ensureQueue(name);
      const { subscription: groupA } = await competitor.ensureSubscription(name, 'group-a', 'earliest');
      const { subscription: groupB } = await competitor.ensureSubscription(name, 'group-b', 'earliest');
      const ids = Array.from({ length: 6 }, (_, i) => `job-${i}`);
      for (const id of ids) await producer.publish(name, envelope(id));
      const seen = { a1: [] as string[], a2: [] as string[], b: [] as string[] };
      const consumer = async (key: keyof typeof seen, subscription: typeof groupA) =>
        (await transport()).subscribe(
          name,
          async (event) => {
            seen[key].push(event.metadata.id);
            await sleep(20);
          },
          { subscription, batchSize: 1, pollingInterval: 10 },
        );
      await consumer('a1', groupA);
      await consumer('a2', groupA);
      await consumer('b', groupB);
      await vi.waitFor(
        () => {
          expect([...seen.a1, ...seen.a2].sort()).toEqual(ids);
          expect([...seen.b].sort()).toEqual(ids);
        },
        { timeout: 8000, interval: 50 },
      );
      // Members of one subscription compete: no copy is processed twice.
      expect(seen.a1.filter((id) => seen.a2.includes(id))).toEqual([]);
      // The default delivery scope keeps its own copies.
      const defaults = await receive(name, ids.length);
      expect(defaults.map((m) => JSON.parse(m.body).metadata.id).sort()).toEqual(ids);
    }, 15000);

    it('keeps backlog while every catalog consumer is offline and never deletes the subscription', async () => {
      const producer = await transport();
      const name = queue();
      await producer.ensureQueue(name);
      const { subscription } = await competitor.ensureSubscription(name, 'reports', 'earliest');
      await producer.publish(name, envelope('before'));
      const first = await transport();
      const handled: string[] = [];
      const sub = first.subscribe(name, async (event) => { handled.push(event.metadata.id); }, {
        subscription,
        pollingInterval: 10,
      });
      await vi.waitFor(() => expect(handled).toEqual(['before']));
      sub();
      await sub.done;
      await first.disconnect();
      for (const id of ['offline-1', 'offline-2']) await producer.publish(name, envelope(id));
      expect(await competitor.getSubscription(name, 'reports')).toMatchObject({
        id: 'reports',
        generation: subscription.generation,
      });
      const rejoined = await transport();
      rejoined.subscribe(name, async (event) => { handled.push(event.metadata.id); }, {
        subscription,
        pollingInterval: 10,
      });
      await vi.waitFor(() => expect(handled).toEqual(['before', 'offline-1', 'offline-2']), { timeout: 6000 });
      await rejoined.disconnect();
      expect(await competitor.getSubscription(name, 'reports')).toMatchObject({ generation: subscription.generation });
    }, 15000);

    it('refuses a stale generation without falling back to the default scope or re-creating the subscription', async () => {
      const producer = await transport();
      const name = queue();
      await producer.ensureQueue(name);
      const { subscription: old } = await competitor.ensureSubscription(name, 'audit', 'earliest');
      await competitor.removeSubscription(name, old);
      const { subscription: current } = await competitor.ensureSubscription(name, 'audit', 'earliest');
      expect(current.generation).not.toBe(old.generation);
      await producer.publish(name, envelope('after-reset'));
      const stale = await transport();
      const staleHandler = vi.fn();
      const onTerminalError = vi.fn();
      const sub = stale.subscribe(name, staleHandler, { subscription: old, pollingInterval: 10, onTerminalError });
      await sub.done;
      expect(onTerminalError).toHaveBeenCalledTimes(1);
      expect(sub.terminalError).toBeInstanceOf(DurableSubscriptionUnavailableError);
      expect(['StaleSubscription', 'SubscriptionDoesNotExist']).toContain(
        (sub.terminalError as DurableSubscriptionUnavailableError).code,
      );
      expect(staleHandler).not.toHaveBeenCalled();
      expect(await competitor.getSubscription(name, 'audit')).toMatchObject({ generation: current.generation });
      // Neither the default scope nor the current subscription lost its copy.
      expect(JSON.parse((await receive(name))[0].body).metadata.id).toBe('after-reset');
      const fresh = await transport();
      const handled: string[] = [];
      fresh.subscribe(name, async (event) => { handled.push(event.metadata.id); }, {
        subscription: current,
        pollingInterval: 10,
      });
      await vi.waitFor(() => expect(handled).toEqual(['after-reset']), { timeout: 6000 });
    }, 15000);

    it('loses readiness and aborts ownership after its broker process dies; another process redelivers', async () => {
      const value = await transport();
      const name = queue();
      await value.publish(name, envelope('crash'));
      let signal: AbortSignal | undefined;
      const sub = value.subscribe(
        name,
        async (_, context) => {
          signal = context.signal;
          await new Promise(() => {});
        },
        { visibilityTimeout: 1 },
      );
      await vi.waitFor(() => expect(signal).toBeDefined());
      children[0].child.kill('SIGKILL');
      await children[0].exited;
      expect((await value.healthCheck()).status).toBe('disconnected');
      await vi.waitFor(() => expect(signal?.aborted).toBe(true), {
        timeout: 3000,
      });
      sub();
      await sub.done;
      expect(value.getOverflowStats().handlerFailures).toBe(0);
      expect((await receive(name))[0].approximate_receive_count).toBe(2);
    }, 10000);
  },
);
