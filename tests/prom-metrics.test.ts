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
