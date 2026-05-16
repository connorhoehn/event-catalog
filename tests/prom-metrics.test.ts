import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PromMetrics } from '../src/server/prom-metrics.js';

describe('PromMetrics — /metrics surface', () => {
  it('exposes all four metric names with prometheus-formatted output', async () => {
    const prom = new PromMetrics();
    prom.recordPublish('platform:user.created', 'durable', 'strict');
    prom.recordPublish('platform:user.created', 'durable', 'strict');
    prom.recordFailure('platform:user.created', 'schema');
    prom.recordSchemaFetch('platform:user.created');
    prom.setDLQEntries('platform:user.created', 3);

    const text = prom.renderProm();

    // All four declared metric names must appear in the output
    expect(text).toContain('event_catalog_publish_total');
    expect(text).toContain('event_catalog_publish_failures_total');
    expect(text).toContain('event_catalog_schema_fetches_total');
    expect(text).toContain('event_catalog_dlq_entries');

    // Labels carry through
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*transport="durable"[^}]*\}/);
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*mode="strict"[^}]*\}/);
    expect(text).toMatch(/event_catalog_publish_failures_total\{[^}]*reason="schema"[^}]*\}/);

    // Values reflect what we recorded
    expect(text).toMatch(/event_catalog_publish_total\{[^}]+\} 2/);
    expect(text).toMatch(/event_catalog_dlq_entries\{[^}]+\} 3/);
  });

  it('serves prom text from an HTTP endpoint with the right Content-Type', async () => {
    const prom = new PromMetrics();
    prom.recordPublish('test:evt', 'signal', 'off');

    const app = express();
    app.get('/metrics', (_req, res) => {
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(prom.renderProm());
    });

    const res = await request(app).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('event_catalog_publish_total');
    expect(res.text).toMatch(/event_catalog_publish_total\{[^}]*transport="signal"[^}]*\} 1/);
  });
});

describe('PromMetrics — recordPublish label variations', () => {
  it('records transport="both" as a distinct label value', () => {
    const prom = new PromMetrics();
    prom.recordPublish('order.placed', 'both', 'warn');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*transport="both"[^}]*\}/);
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*mode="warn"[^}]*\}/);
    expect(text).toMatch(/event_catalog_publish_total\{[^}]+\} 1/);
  });

  it('isolates counters by (event, transport, mode) key', () => {
    const prom = new PromMetrics();
    prom.recordPublish('ev.a', 'signal', 'off');
    prom.recordPublish('ev.a', 'durable', 'off');
    prom.recordPublish('ev.a', 'signal', 'strict');
    prom.recordPublish('ev.a', 'signal', 'off'); // second inc on same key

    const text = prom.renderProm();
    // signal+off counter should be 2
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*transport="signal"[^}]*mode="off"[^}]*\} 2|event_catalog_publish_total\{[^}]*mode="off"[^}]*transport="signal"[^}]*\} 2/);
    // durable+off counter should be 1
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*transport="durable"[^}]*\} 1/);
    // signal+strict counter should be 1
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*mode="strict"[^}]*\} 1/);
  });

  it('defaults mode to "off" when not supplied', () => {
    const prom = new PromMetrics();
    prom.recordPublish('ev.b', 'signal');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_publish_total\{[^}]*mode="off"[^}]*\}/);
  });
});

describe('PromMetrics — recordFailure reason variants', () => {
  it('records reason="transport"', () => {
    const prom = new PromMetrics();
    prom.recordFailure('ev.x', 'transport');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_publish_failures_total\{[^}]*reason="transport"[^}]*\}/);
    expect(text).toMatch(/event_catalog_publish_failures_total\{[^}]+\} 1/);
  });

  it('records reason="network"', () => {
    const prom = new PromMetrics();
    prom.recordFailure('ev.y', 'network');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_publish_failures_total\{[^}]*reason="network"[^}]*\}/);
  });

  it('isolates failure counters by (event, reason) key', () => {
    const prom = new PromMetrics();
    prom.recordFailure('ev.z', 'schema');
    prom.recordFailure('ev.z', 'schema');
    prom.recordFailure('ev.z', 'transport');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_publish_failures_total\{[^}]*reason="schema"[^}]*\} 2/);
    expect(text).toMatch(/event_catalog_publish_failures_total\{[^}]*reason="transport"[^}]*\} 1/);
  });
});

describe('PromMetrics — setDLQEntries gauge', () => {
  it('updates the gauge value on subsequent calls for the same event', () => {
    const prom = new PromMetrics();
    prom.setDLQEntries('order.failed', 5);
    prom.setDLQEntries('order.failed', 2); // gauge should now reflect 2, not 5
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_dlq_entries\{[^}]+\} 2/);
    expect(text).not.toMatch(/event_catalog_dlq_entries\{[^}]+\} 5/);
  });

  it('tracks separate gauges per event', () => {
    const prom = new PromMetrics();
    prom.setDLQEntries('ev.alpha', 10);
    prom.setDLQEntries('ev.beta', 3);
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_dlq_entries\{[^}]*event="ev\.alpha"[^}]*\} 10/);
    expect(text).toMatch(/event_catalog_dlq_entries\{[^}]*event="ev\.beta"[^}]*\} 3/);
  });
});

describe('PromMetrics — recordSchemaFetch', () => {
  it('increments on repeated calls for the same event', () => {
    const prom = new PromMetrics();
    prom.recordSchemaFetch('user.registered');
    prom.recordSchemaFetch('user.registered');
    prom.recordSchemaFetch('user.registered');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_schema_fetches_total\{[^}]+\} 3/);
  });

  it('isolates fetch counters per event', () => {
    const prom = new PromMetrics();
    prom.recordSchemaFetch('a.b');
    prom.recordSchemaFetch('a.b');
    prom.recordSchemaFetch('c.d');
    const text = prom.renderProm();
    expect(text).toMatch(/event_catalog_schema_fetches_total\{[^}]*event="a\.b"[^}]*\} 2/);
    expect(text).toMatch(/event_catalog_schema_fetches_total\{[^}]*event="c\.d"[^}]*\} 1/);
  });
});

describe('PromMetrics — getRegistry()', () => {
  it('returns the underlying MetricsRegistry', () => {
    const prom = new PromMetrics();
    const reg = prom.getRegistry();
    expect(reg).toBeDefined();
    expect(typeof reg.counter).toBe('function');
    expect(typeof reg.gauge).toBe('function');
    expect(typeof reg.getSnapshot).toBe('function');
  });
});
