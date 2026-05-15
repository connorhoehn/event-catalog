// tests/schema-shape.test.ts
//
// wave22-a — verify the JSON-Schema-shape meta-validator catches the
// common operator typos and accepts well-formed schemas.

import { describe, it, expect } from 'vitest';
import { validateSchemaShape } from '../src/registry/schema-shape.js';
import { Registry } from '../src/registry/index.js';

describe('validateSchemaShape', () => {
  describe('accepts', () => {
    it('an empty schema', () => {
      expect(validateSchemaShape({})).toEqual({ ok: true, errors: [] });
    });

    it('a basic object schema', () => {
      expect(validateSchemaShape({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      }).ok).toBe(true);
    });

    it('union type (array of types)', () => {
      expect(validateSchemaShape({ type: ['string', 'null'] }).ok).toBe(true);
    });

    it('nested properties', () => {
      const r = validateSchemaShape({
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'integer' } },
            required: ['name'],
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
      });
      expect(r).toEqual({ ok: true, errors: [] });
    });

    it('oneOf / anyOf / allOf with sub-schemas', () => {
      expect(validateSchemaShape({
        oneOf: [{ type: 'string' }, { type: 'null' }],
        anyOf: [{ type: 'object' }],
        allOf: [{ required: ['x'] }],
      }).ok).toBe(true);
    });

    it('additionalProperties as boolean or schema', () => {
      expect(validateSchemaShape({ type: 'object', additionalProperties: false }).ok).toBe(true);
      expect(validateSchemaShape({
        type: 'object',
        additionalProperties: { type: 'string' },
      }).ok).toBe(true);
    });

    it('items as a schema OR an array of schemas (tuple form)', () => {
      expect(validateSchemaShape({ type: 'array', items: { type: 'number' } }).ok).toBe(true);
      expect(validateSchemaShape({
        type: 'array',
        items: [{ type: 'string' }, { type: 'integer' }],
      }).ok).toBe(true);
    });
  });

  describe('rejects', () => {
    it('non-object root', () => {
      expect(validateSchemaShape(null).ok).toBe(false);
      expect(validateSchemaShape('string').ok).toBe(false);
      expect(validateSchemaShape([]).ok).toBe(false);
    });

    it('typo in `type` ("objct" vs "object")', () => {
      const r = validateSchemaShape({ type: 'objct' });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/invalid value "objct"/);
    });

    it('non-string `type`', () => {
      const r = validateSchemaShape({ type: 42 });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/must be a string or array/);
    });

    it('`required` not an array', () => {
      const r = validateSchemaShape({ required: 'x' });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/required.*must be an array/);
    });

    it('`required` with non-string entries', () => {
      const r = validateSchemaShape({ required: ['x', 42] });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/required\[1\].*must be a string/);
    });

    it('`enum` not an array', () => {
      const r = validateSchemaShape({ enum: 'a' });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/enum.*must be an array/);
    });

    it('typo in nested property type bubbles up with path', () => {
      const r = validateSchemaShape({
        type: 'object',
        properties: { x: { type: 'strng' } },
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/properties\.x\.type.*"strng"/);
    });

    it('`oneOf` not an array', () => {
      const r = validateSchemaShape({ oneOf: { type: 'string' } });
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/oneOf.*must be an array/);
    });
  });
});

describe('Registry.declare meta-validation (wave22-a)', () => {
  it('rejects a declaration whose schema has a `type` typo', () => {
    const reg = new Registry();
    expect(() => reg.declare({
      name: 'orders.bad',
      schema: { type: 'objct' },
      transport: 'durable',
      producer: 'orders',
    })).toThrow(/invalid JSON Schema shape.*invalid value "objct"/);
  });

  it('accepts a declaration with an empty schema (matches anything)', () => {
    const reg = new Registry();
    expect(() => reg.declare({
      name: 'loose.event',
      schema: {},
      transport: 'signal',
      producer: 'svc',
    })).not.toThrow();
  });

  it('reports nested errors with paths so operators can find the typo', () => {
    const reg = new Registry();
    expect(() => reg.declare({
      name: 'orders.bad',
      schema: {
        type: 'object',
        properties: { user: { type: 'object', required: 'id' } },
      },
      transport: 'durable',
      producer: 'orders',
    })).toThrow(/\.properties\.user\.required.*must be an array/);
  });

  it('accepts well-formed nested schemas', () => {
    const reg = new Registry();
    expect(() => reg.declare({
      name: 'orders.created',
      schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] } },
        },
        required: ['orderId'],
      },
      transport: 'durable',
      producer: 'orders',
    })).not.toThrow();
  });
});
