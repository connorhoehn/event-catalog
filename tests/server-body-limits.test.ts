// tests/server-body-limits.test.ts
//
// The 1 MiB request-body cap the admin server advertises.
//
// It was never enforced: `startServer` passed
// `bodyLimits: { maxBodyBytes: 1_048_576 }`, and `maxBodyBytes` is not a key
// of distributed-core's `BodyLimitsConfig` (which spells it `maxBytes`). The
// object was accepted as a plain literal, the unknown key dropped, and the
// server ran on `DEFAULT_MAX_BODY_BYTES` — 16 MiB — for its whole life.
//
// These tests bind a real AdmissionHttpServer with the SAME exported
// `REQUEST_BODY_LIMITS` object `startServer` passes, so a regression to a key
// the server ignores fails here rather than in production.

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { AdmissionHttpServer } from 'distributed-core/server';
import {
  MAX_REQUEST_BODY_BYTES,
  BODY_READ_TIMEOUT_MS,
  REQUEST_BODY_LIMITS,
} from '../src/server/index.js';

const servers: AdmissionHttpServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.stop();
  }
});

/** Bind an AdmissionHttpServer on an ephemeral port that echoes body length. */
async function startEchoServer(): Promise<number> {
  const server = new AdmissionHttpServer({
    port: 0,
    hostname: '127.0.0.1',
    // The production object, verbatim — not a re-spelled copy.
    bodyLimits: REQUEST_BODY_LIMITS,
    onRequest: (req, res) => {
      res.json(200, { received: Buffer.byteLength(req.body, 'utf8') });
    },
  });
  await server.start();
  servers.push(server);
  const addr = server.address();
  if (!addr) throw new Error('server did not bind');
  return addr.port;
}

function requestOptions(port: number, declaredLength: number): http.RequestOptions {
  return {
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/api/events',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': declaredLength,
    },
  };
}

/** Collect a response into `{ status, body }`, parsing JSON when it is JSON. */
function readResponse(
  res: http.IncomingMessage,
  resolve: (value: { status: number; body: unknown }) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', c => chunks.push(c as Buffer));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Leave as text — the assertion below only needs the status.
    }
    resolve({ status: res.statusCode ?? 0, body: parsed });
  });
}

/** POST a raw body and resolve with the status + parsed JSON (when JSON). */
function post(
  port: number,
  body: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions(port, Buffer.byteLength(body)), res =>
      readResponse(res, resolve),
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Announce an oversized body in Content-Length without sending one, and
 * resolve with whatever the server answers.
 *
 * The over-cap assertions deliberately do NOT transmit a body. The rejection
 * they cover is the Content-Length pre-check in distributed-core's
 * AdmissionHttpServer, which answers 413 before a single body byte is read
 * and closes with `Connection: close`. Actually streaming the megabytes is
 * therefore not needed to reach that branch — and it is actively harmful: the
 * server closes as soon as it has answered, the client is still writing, and
 * the resulting RST discards the client's receive buffer along with the very
 * 413 being asserted on. That is a real TCP race, not a flaky assertion, and
 * it cannot be closed from the client side; it used to be papered over with a
 * 250ms "did the response land yet?" timer, which failed whenever the box was
 * busy. Declaring the length and sending no body removes the race outright.
 */
function postDeclaredLength(
  port: number,
  declaredLength: number,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions(port, declaredLength), res =>
      readResponse(res, value => {
        // The body was never written, so this request would otherwise stay
        // open and hold the connection that `afterEach`'s server.stop() waits
        // on. Drop it explicitly.
        req.destroy();
        resolve(value);
      }),
    );
    // A late socket teardown is expected here, not a failure: the server
    // answers 413 with `Connection: close` and hangs up on a request whose
    // announced body never arrives.
    req.on('error', err => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' || code === 'EPIPE') return;
      reject(err);
    });
    req.flushHeaders();
  });
}

/** A JSON body of exactly `bytes` bytes: {"pad":"<filler>"}. */
function jsonBodyOfSize(bytes: number): string {
  const envelope = '{"pad":""}';
  return `{"pad":"${'x'.repeat(bytes - envelope.length)}"}`;
}

describe('request body limits', () => {
  it('exports the cap as 1 MiB under the key BodyLimitsConfig actually reads', () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(1_048_576);
    expect(REQUEST_BODY_LIMITS.maxBytes).toBe(MAX_REQUEST_BODY_BYTES);
    expect(REQUEST_BODY_LIMITS.readTimeoutMs).toBe(BODY_READ_TIMEOUT_MS);
    // The dropped-key regression: nothing outside BodyLimitsConfig.
    expect(Object.keys(REQUEST_BODY_LIMITS).sort()).toEqual([
      'maxBytes',
      'readTimeoutMs',
    ]);
  });

  it('accepts a body just under the cap', async () => {
    const port = await startEchoServer();
    const body = jsonBodyOfSize(MAX_REQUEST_BODY_BYTES - 1);
    const res = await post(port, body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: MAX_REQUEST_BODY_BYTES - 1 });
  });

  it('rejects a body one byte over the cap with 413', async () => {
    const port = await startEchoServer();
    const res = await postDeclaredLength(port, MAX_REQUEST_BODY_BYTES + 1);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: 'PayloadTooLarge' });
  });

  it('rejects a body that would have squeaked under the 16 MiB default', async () => {
    // 2 MiB: under distributed-core's DEFAULT_MAX_BODY_BYTES, over ours.
    // This is the case the misspelled key let through.
    const port = await startEchoServer();
    const res = await postDeclaredLength(port, 2 * 1_048_576);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: 'PayloadTooLarge' });
  });
});
