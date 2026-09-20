import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index';
import { wsCrdtPersisted, wsCrdtPersistenceError, wsCrdtSeeded } from '../src/declarations/gateway-signal';
import { clientCrdtSeedDocument, clientCrdtUpdate } from '../src/declarations/client-frames';
const registry = new Registry();
for (const declaration of [wsCrdtPersisted, wsCrdtPersistenceError, wsCrdtSeeded, clientCrdtSeedDocument, clientCrdtUpdate]) registry.declare(declaration);
describe('document durable protocol', () => {
  it.each(['persisted', 'persistence-error'])('requires the update correlation identifier for %s', action => {
    const message = { type: `crdt:${action}`, channel: 'doc:one', updateId: '17:1' };
    expect(registry.validate(`ws.crdt.${action}`, message).valid).toBe(true);
    expect(registry.validate(`ws.crdt.${action}`, { type: message.type, channel: message.channel }).valid).toBe(false);
  });
  it('accepts seed request and receipt with identical source revision and request correlation', () => {
    const request = { service: 'crdt', action: 'seedDocument', channel: 'doc:one', sourceRevision: 'sha256:source', snapshot: 'base64', requestId: 'request' };
    expect(registry.validate('client.crdt.seed-document', request).valid).toBe(true);
    expect(registry.validate('ws.crdt.seeded', { type: 'crdt:seeded', channel: request.channel, sourceRevision: request.sourceRevision, requestId: request.requestId, alreadySeeded: false }).valid).toBe(true);
    expect(registry.validate('client.crdt.update', { service: 'crdt', action: 'update', channel: request.channel, update: 'base64', updateId: '17:2' }).valid).toBe(true);
  });
});
