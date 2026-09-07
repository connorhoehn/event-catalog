// Status mapping and the health fetch.
//
// The bug this file exists to prevent: `/api/health` reports each transport in
// the transport's own vocabulary ('connected'), and a comparison against the
// service-runtime vocabulary ('healthy') is silently always-false — so a
// perfectly healthy system rendered both transports as DOWN and nothing threw.
// Every state the server can actually produce is enumerated here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, isTransportUp, transportTone, type ComponentHealth } from './api';
import { mockFetch } from './test/helpers';

/**
 * The vocabulary `signal.healthCheck()` / `durable.healthCheck()` return
 * (src/client/signal.ts, src/client/durable.ts) and that ops.ts passes through
 * to `GET /api/health` verbatim.
 */
const SERVER_STATES = ['connected', 'degraded', 'disconnected'] as const;

describe('isTransportUp', () => {
  it('treats the transport vocabulary "connected" as up', () => {
    expect(isTransportUp('connected')).toBe(true);
  });

  it('also accepts "healthy", the service-runtime spelling', () => {
    expect(isTransportUp('healthy')).toBe(true);
  });

  it.each(['degraded', 'disconnected', 'unhealthy'] as const)('treats %s as not up', (s) => {
    expect(isTransportUp(s)).toBe(false);
  });

  it('treats an unknown status as not up rather than assuming the best', () => {
    // A future server release adding a fourth state must not read as healthy.
    expect(isTransportUp('reconnecting' as ComponentHealth['status'])).toBe(false);
    expect(isTransportUp(undefined as unknown as ComponentHealth['status'])).toBe(false);
  });

  it('covers every state the server can actually emit', () => {
    expect(SERVER_STATES.map(isTransportUp)).toEqual([true, false, false]);
  });
});

describe('transportTone', () => {
  it('keeps degraded a warning, not a failure', () => {
    // Collapsing degraded into danger tells an operator to page someone for a
    // slow Redis that is still delivering every message.
    expect(transportTone('degraded')).toBe('warning');
  });

  it('maps the three server states to success / warning / danger', () => {
    expect(SERVER_STATES.map(transportTone)).toEqual(['success', 'warning', 'danger']);
  });

  it('maps an unknown status to danger', () => {
    expect(transportTone('who-knows' as ComponentHealth['status'])).toBe('danger');
  });
});

describe('api.getHealth', () => {
  const body = {
    status: 'unhealthy',
    redis: { status: 'connected', latencyMs: 3 },
    messageQueue: { status: 'disconnected' },
    uptime: 42,
    eventCount: 7,
  };

  it('returns the parsed health payload on 200', async () => {
    mockFetch({ '/api/health': { body: { ...body, status: 'healthy' } } });
    const res = await api.getHealth();
    expect(res.redis.status).toBe('connected');
  });

  it('returns the body of a 503 instead of throwing it away', async () => {
    // `GET /api/health` answers 503 precisely when a transport is
    // disconnected — the one moment the health card matters most. Treating
    // that as a failed request replaced "Message Queue: disconnected" with
    // "Error loading the dashboard", which tells the operator nothing about
    // which transport is down.
    mockFetch({ '/api/health': { status: 503, body } });
    const res = await api.getHealth();
    expect(res.status).toBe('unhealthy');
    expect(res.messageQueue.status).toBe('disconnected');
    expect(isTransportUp(res.messageQueue.status)).toBe(false);
  });

  it('still throws when a 503 carries no health body (a proxy, not the catalog)', async () => {
    mockFetch({ '/api/health': { status: 503, text: '<html>502 Bad Gateway</html>' } });
    await expect(api.getHealth()).rejects.toThrow(/503/);
  });

  it('throws on other error statuses', async () => {
    mockFetch({ '/api/health': { status: 500, text: 'boom' } });
    await expect(api.getHealth()).rejects.toThrow(/API 500/);
  });
});

describe('api error surfacing', () => {
  it('includes the status code so the view can say what went wrong', async () => {
    mockFetch({ '/api/events': { status: 500, text: 'registry exploded' } });
    await expect(api.getEvents()).rejects.toThrow('API 500: registry exploded');
  });

  it('does not swallow a network failure into an empty result', async () => {
    mockFetch({ '/api/events': { networkError: 'Failed to fetch' } });
    await expect(api.getEvents()).rejects.toThrow('Failed to fetch');
  });
});

describe('api query building', () => {
  it('omits the query string entirely when no filter is given', async () => {
    const { calls } = mockFetch({ '/api/events': { body: { events: [], total: 0 } } });
    await api.getEvents();
    expect(calls[0]).toBe('/api/events');
  });

  it('encodes event names that contain colons and slashes', async () => {
    const { calls } = mockFetch({ '/api/events': { body: {} } });
    await api.getEvent('pipeline:step/agent:tool');
    expect(calls[0]).toBe('/api/events/pipeline%3Astep%2Fagent%3Atool');
  });

  it('builds the bulk export URL from the selected names', () => {
    expect(api.bulkExportUrl(['a:b', 'c'])).toBe('/api/events/bulk/export?names=a%3Ab,c');
    expect(api.bulkExportUrl([])).toBe('/api/events/bulk/export');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
