import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    gatewaySignalDeclarations,
    wsChatJoined,
    wsChatMessage,
    wsCursorUpdate,
    wsError,
    wsCrdtSnapshot,
    wsPresenceData,
    wsCallInvite,
    wsPipelineEvent,
} from '../src/declarations/gateway-signal';
import { pipelineDeclarations } from '../src/declarations/pipeline';
import { agUiDeclarations } from '../src/declarations/ag-ui';

describe('gateway-signal declarations — bulk registration', () => {
    it('registers all gateway-signal events in a fresh registry without error', () => {
        const registry = new Registry();
        for (const decl of gatewaySignalDeclarations) {
            const result = registry.declare(decl);
            expect(result.compatible).toBe(true);
        }
        expect(registry.size()).toBe(gatewaySignalDeclarations.length);
    });

    it('has no duplicate event names', () => {
        const names = gatewaySignalDeclarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('all events are signal transport', () => {
        expect(gatewaySignalDeclarations.every((d) => d.transport === 'signal')).toBe(true);
    });

    it('all events use websocket-gateway as producer and ws as namespace', () => {
        expect(gatewaySignalDeclarations.every((d) => d.producer === 'websocket-gateway')).toBe(true);
        expect(gatewaySignalDeclarations.every((d) => d.namespace === 'ws')).toBe(true);
    });

    it('all event names are prefixed with ws.', () => {
        expect(gatewaySignalDeclarations.every((d) => d.name.startsWith('ws.'))).toBe(true);
    });

    it('covers all expected service categories', () => {
        const names = gatewaySignalDeclarations.map((d) => d.name);
        const services = ['chat', 'cursor', 'activity', 'crdt', 'presence', 'reaction', 'call', 'pipeline'];
        for (const svc of services) {
            expect(names.some((n) => n.startsWith(`ws.${svc}.`)), `no events for service: ${svc}`).toBe(true);
        }
    });

    it('does not overlap with pipeline declarations', () => {
        const pipelineNames = new Set(pipelineDeclarations.map((d) => d.name));
        for (const decl of gatewaySignalDeclarations) {
            expect(pipelineNames.has(decl.name)).toBe(false);
        }
    });

    it('does not overlap with ag-ui declarations', () => {
        const agUiNames = new Set(agUiDeclarations.map((d) => d.name));
        for (const decl of gatewaySignalDeclarations) {
            expect(agUiNames.has(decl.name)).toBe(false);
        }
    });
});

describe('ws.chat.message schema validation', () => {
    it('accepts valid { type, action, channel, message }', () => {
        const registry = new Registry();
        registry.declare(wsChatMessage);
        expect(
            registry.validate('ws.chat.message', {
                type: 'chat',
                action: 'message',
                channel: 'general',
                message: { id: 'msg_1', content: 'Hello!' },
            }).valid,
        ).toBe(true);
    });

    it('rejects when action is missing', () => {
        const registry = new Registry();
        registry.declare(wsChatMessage);
        expect(
            registry.validate('ws.chat.message', {
                type: 'chat',
                channel: 'general',
                message: { id: 'msg_1' },
            }).valid,
        ).toBe(false);
    });

    it('rejects when channel is missing', () => {
        const registry = new Registry();
        registry.declare(wsChatMessage);
        expect(
            registry.validate('ws.chat.message', {
                type: 'chat',
                action: 'message',
                message: { id: 'msg_1' },
            }).valid,
        ).toBe(false);
    });
});

describe('ws.cursor.update schema validation', () => {
    it('accepts valid { type, action, channel, cursor }', () => {
        const registry = new Registry();
        registry.declare(wsCursorUpdate);
        expect(
            registry.validate('ws.cursor.update', {
                type: 'cursor',
                action: 'update',
                channel: 'doc_abc',
                cursor: { x: 42, y: 100, userId: 'u1' },
            }).valid,
        ).toBe(true);
    });

    it('rejects when cursor object is missing', () => {
        const registry = new Registry();
        registry.declare(wsCursorUpdate);
        expect(
            registry.validate('ws.cursor.update', {
                type: 'cursor',
                action: 'update',
                channel: 'doc_abc',
            }).valid,
        ).toBe(false);
    });
});

describe('ws.error schema validation', () => {
    it('accepts valid error frame with only type required', () => {
        const registry = new Registry();
        registry.declare(wsError);
        expect(
            registry.validate('ws.error', {
                type: 'error',
            }).valid,
        ).toBe(true);
    });

    it('accepts error with optional service, code, message', () => {
        const registry = new Registry();
        registry.declare(wsError);
        expect(
            registry.validate('ws.error', {
                type: 'error',
                service: 'chat',
                code: 'CHANNEL_NOT_FOUND',
                message: 'The requested channel does not exist.',
            }).valid,
        ).toBe(true);
    });

    it('rejects when type is missing', () => {
        const registry = new Registry();
        registry.declare(wsError);
        expect(
            registry.validate('ws.error', {
                service: 'chat',
                message: 'error without type',
            }).valid,
        ).toBe(false);
    });
});

describe('ws.chat.joined, ws.crdt.snapshot, ws.presence.data, ws.call.invite, ws.pipeline.event', () => {
    it('ws.chat.joined accepts type + channel', () => {
        const registry = new Registry();
        registry.declare(wsChatJoined);
        expect(
            registry.validate('ws.chat.joined', {
                type: 'chat',
                action: 'joined',
                channel: 'general',
            }).valid,
        ).toBe(true);
    });

    it('ws.crdt.snapshot accepts type + channel + base64 snapshot', () => {
        const registry = new Registry();
        registry.declare(wsCrdtSnapshot);
        expect(
            registry.validate('ws.crdt.snapshot', {
                type: 'crdt:snapshot',
                channel: 'doc_abc',
                snapshot: 'base64encodedstate==',
            }).valid,
        ).toBe(true);
    });

    it('ws.presence.data accepts type + action:presence', () => {
        const registry = new Registry();
        registry.declare(wsPresenceData);
        expect(
            registry.validate('ws.presence.data', {
                type: 'presence',
                action: 'presence',
            }).valid,
        ).toBe(true);
    });

    it('ws.call.invite accepts type + action:invite', () => {
        const registry = new Registry();
        registry.declare(wsCallInvite);
        expect(
            registry.validate('ws.call.invite', {
                type: 'call',
                action: 'invite',
            }).valid,
        ).toBe(true);
    });

    it('ws.pipeline.event accepts type + eventType + channel', () => {
        const registry = new Registry();
        registry.declare(wsPipelineEvent);
        expect(
            registry.validate('ws.pipeline.event', {
                type: 'pipeline:event',
                eventType: 'pipeline:run:started',
                channel: 'pipeline:run:r1',
            }).valid,
        ).toBe(true);
    });
});
