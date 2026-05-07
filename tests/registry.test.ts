import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from '../src/registry/index.js';

describe('Registry', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  describe('declare', () => {
    it('registers a new event', () => {
      registry.declare({
        name: 'user:created',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
        transport: 'durable',
        producer: 'auth-service',
        description: 'Fired when a new user is created',
      });

      const entry = registry.get('user:created');
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('user:created');
      expect(entry!.transport).toBe('durable');
      expect(entry!.producer).toBe('auth-service');
      expect(entry!.subscribers).toEqual([]);
      expect(entry!.metadata.publishCount).toBe(0);
    });

    it('updates an existing declaration', () => {
      registry.declare({
        name: 'user:created',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'auth-service',
      });

      registry.declare({
        name: 'user:created',
        schema: { type: 'object', required: ['userId'] },
        transport: 'durable',
        producer: 'auth-service',
        description: 'Updated description',
      });

      const entry = registry.get('user:created');
      expect(entry!.description).toBe('Updated description');
      expect(entry!.schema).toEqual({ type: 'object', required: ['userId'] });
    });
  });

  describe('list', () => {
    beforeEach(() => {
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor' });
      registry.declare({ name: 'presence:join', schema: {}, transport: 'signal', producer: 'chat' });
      registry.declare({ name: 'pipeline:completed', schema: {}, transport: 'durable', producer: 'pipeline' });
    });

    it('lists all events', () => {
      expect(registry.list()).toHaveLength(3);
    });

    it('filters by transport', () => {
      const signal = registry.list({ transport: 'signal' });
      expect(signal).toHaveLength(2);
      expect(signal.every(e => e.transport === 'signal')).toBe(true);
    });

    it('filters by producer', () => {
      const editor = registry.list({ producer: 'editor' });
      expect(editor).toHaveLength(1);
      expect(editor[0].name).toBe('cursor:move');
    });
  });

  describe('subscribers', () => {
    it('adds and removes subscribers', () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });

      registry.addSubscriber('user:created', 'notification-service');
      registry.addSubscriber('user:created', 'analytics-service');
      expect(registry.get('user:created')!.subscribers).toEqual(['notification-service', 'analytics-service']);

      registry.removeSubscriber('user:created', 'notification-service');
      expect(registry.get('user:created')!.subscribers).toEqual(['analytics-service']);
    });

    it('does not add duplicate subscribers', () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });
      registry.addSubscriber('user:created', 'service-a');
      registry.addSubscriber('user:created', 'service-a');
      expect(registry.get('user:created')!.subscribers).toEqual(['service-a']);
    });
  });

  describe('validate', () => {
    it('validates payload against schema', () => {
      registry.declare({
        name: 'user:created',
        schema: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        transport: 'durable',
        producer: 'auth',
      });

      expect(registry.validate('user:created', { userId: 'abc' }).valid).toBe(true);
      expect(registry.validate('user:created', { userId: 123 }).valid).toBe(false);
      expect(registry.validate('user:created', {}).valid).toBe(false);
    });

    it('returns error for undeclared event', () => {
      const result = registry.validate('nonexistent', {});
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('not declared');
    });

    it('passes validation when schema is empty', () => {
      registry.declare({ name: 'any:event', schema: {}, transport: 'signal', producer: 'test' });
      expect(registry.validate('any:event', { anything: true }).valid).toBe(true);
    });
  });

  describe('topology', () => {
    it('builds a graph of services and events', () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth-service' });
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor-service' });
      registry.addSubscriber('user:created', 'notification-service');
      registry.addSubscriber('user:created', 'analytics-service');

      const topology = registry.getTopology();

      // 2 events + 4 services = 6 nodes
      expect(topology.nodes).toHaveLength(6);
      // auth→user:created, editor→cursor:move, user:created→notification, user:created→analytics = 4 edges
      expect(topology.edges).toHaveLength(4);

      const publishEdges = topology.edges.filter(e => e.relation === 'publishes');
      expect(publishEdges).toHaveLength(2);

      const subscribeEdges = topology.edges.filter(e => e.relation === 'subscribes');
      expect(subscribeEdges).toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('removes a declared event', () => {
      registry.declare({ name: 'temp:event', schema: {}, transport: 'signal', producer: 'test' });
      expect(registry.size()).toBe(1);

      const removed = registry.remove('temp:event');
      expect(removed).toBe(true);
      expect(registry.size()).toBe(0);
      expect(registry.get('temp:event')).toBeUndefined();
    });

    it('returns false for non-existent event', () => {
      expect(registry.remove('nonexistent')).toBe(false);
    });
  });
});
