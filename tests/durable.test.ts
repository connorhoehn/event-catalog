import { describe, it, expect } from 'vitest';
import { DurableTransport } from '../src/client/durable.js';

describe('DurableTransport', () => {
  describe('eventNameToQueueName', () => {
    it('converts colons to dashes', () => {
      expect(DurableTransport.eventNameToQueueName('pipeline:run:completed')).toBe('pipeline-run-completed');
    });

    it('converts dots to dashes', () => {
      expect(DurableTransport.eventNameToQueueName('social.post.created')).toBe('social-post-created');
    });

    it('collapses multiple dashes', () => {
      expect(DurableTransport.eventNameToQueueName('test::double')).toBe('test-double');
    });

    it('handles mixed separators', () => {
      expect(DurableTransport.eventNameToQueueName('my:event.name:here')).toBe('my-event-name-here');
    });
  });

  describe('constructor', () => {
    it('strips trailing slash from URL', () => {
      const transport = new DurableTransport({ url: 'http://localhost:3004/' });
      expect(transport.isConnected()).toBe(false);
    });
  });
});
