import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    agUiDeclarations,
    agUiRunStarted,
    agUiTextMessageContent,
    agUiToolCallStart,
    agUiStateDelta,
    agUiToolCallResult,
    agUiReasoningEncryptedValue,
    agUiCustom,
} from '../src/declarations/ag-ui';
import { pipelineDeclarations } from '../src/declarations/pipeline';

describe('ag-ui declarations — bulk registration', () => {
    it('registers all 28 AG-UI events in a fresh registry without error', () => {
        const registry = new Registry();
        for (const decl of agUiDeclarations) {
            const result = registry.declare(decl);
            expect(result.compatible).toBe(true);
        }
        expect(registry.size()).toBe(agUiDeclarations.length);
    });

    it('has no duplicate event names', () => {
        const names = agUiDeclarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('all events are signal transport', () => {
        expect(agUiDeclarations.every((d) => d.transport === 'signal')).toBe(true);
    });

    it('all events use ag-ui-agent as producer and ag-ui namespace', () => {
        expect(agUiDeclarations.every((d) => d.producer === 'ag-ui-agent')).toBe(true);
        expect(agUiDeclarations.every((d) => d.namespace === 'ag-ui')).toBe(true);
    });

    it('all event names are prefixed with ag-ui.', () => {
        expect(agUiDeclarations.every((d) => d.name.startsWith('ag-ui.'))).toBe(true);
    });

    it('all events have the ag-ui, agent, and streaming tags', () => {
        for (const decl of agUiDeclarations) {
            expect(decl.tags).toContain('ag-ui');
            expect(decl.tags).toContain('agent');
            expect(decl.tags).toContain('streaming');
        }
    });

    it('does not overlap with pipeline declarations', () => {
        const pipelineNames = new Set(pipelineDeclarations.map((d) => d.name));
        for (const decl of agUiDeclarations) {
            expect(pipelineNames.has(decl.name)).toBe(false);
        }
    });
});

describe('ag-ui.RUN_STARTED schema validation', () => {
    it('accepts valid { type, threadId, runId }', () => {
        const registry = new Registry();
        registry.declare(agUiRunStarted);
        expect(
            registry.validate('ag-ui.RUN_STARTED', {
                type: 'RUN_STARTED',
                threadId: 'thread_01',
                runId: 'run_abc',
            }).valid,
        ).toBe(true);
    });

    it('rejects when threadId is missing', () => {
        const registry = new Registry();
        registry.declare(agUiRunStarted);
        expect(
            registry.validate('ag-ui.RUN_STARTED', {
                type: 'RUN_STARTED',
                runId: 'run_abc',
            }).valid,
        ).toBe(false);
    });

    it('rejects when runId is missing', () => {
        const registry = new Registry();
        registry.declare(agUiRunStarted);
        expect(
            registry.validate('ag-ui.RUN_STARTED', {
                type: 'RUN_STARTED',
                threadId: 'thread_01',
            }).valid,
        ).toBe(false);
    });
});

describe('ag-ui.TEXT_MESSAGE_CONTENT schema validation', () => {
    it('accepts valid { type, messageId, delta }', () => {
        const registry = new Registry();
        registry.declare(agUiTextMessageContent);
        expect(
            registry.validate('ag-ui.TEXT_MESSAGE_CONTENT', {
                type: 'TEXT_MESSAGE_CONTENT',
                messageId: 'msg_1',
                delta: 'Hello, ',
            }).valid,
        ).toBe(true);
    });

    it('rejects when delta is missing', () => {
        const registry = new Registry();
        registry.declare(agUiTextMessageContent);
        expect(
            registry.validate('ag-ui.TEXT_MESSAGE_CONTENT', {
                type: 'TEXT_MESSAGE_CONTENT',
                messageId: 'msg_1',
            }).valid,
        ).toBe(false);
    });
});

describe('ag-ui.TOOL_CALL_START schema validation', () => {
    it('accepts valid { type, toolCallId, toolCallName }', () => {
        const registry = new Registry();
        registry.declare(agUiToolCallStart);
        expect(
            registry.validate('ag-ui.TOOL_CALL_START', {
                type: 'TOOL_CALL_START',
                toolCallId: 'tc_1',
                toolCallName: 'search',
            }).valid,
        ).toBe(true);
    });

    it('accepts optional parentMessageId', () => {
        const registry = new Registry();
        registry.declare(agUiToolCallStart);
        expect(
            registry.validate('ag-ui.TOOL_CALL_START', {
                type: 'TOOL_CALL_START',
                toolCallId: 'tc_2',
                toolCallName: 'read_file',
                parentMessageId: 'msg_3',
            }).valid,
        ).toBe(true);
    });

    it('rejects when toolCallName is missing', () => {
        const registry = new Registry();
        registry.declare(agUiToolCallStart);
        expect(
            registry.validate('ag-ui.TOOL_CALL_START', {
                type: 'TOOL_CALL_START',
                toolCallId: 'tc_1',
            }).valid,
        ).toBe(false);
    });
});

describe('ag-ui.STATE_DELTA schema validation (JSON Patch)', () => {
    it('accepts valid JSON Patch delta array', () => {
        const registry = new Registry();
        registry.declare(agUiStateDelta);
        expect(
            registry.validate('ag-ui.STATE_DELTA', {
                type: 'STATE_DELTA',
                delta: [
                    { op: 'add', path: '/messages/-', value: { id: 'm1', role: 'assistant' } },
                    { op: 'replace', path: '/status', value: 'running' },
                ],
            }).valid,
        ).toBe(true);
    });

    it('rejects when delta is missing', () => {
        const registry = new Registry();
        registry.declare(agUiStateDelta);
        expect(
            registry.validate('ag-ui.STATE_DELTA', { type: 'STATE_DELTA' }).valid,
        ).toBe(false);
    });
});

describe('ag-ui.TOOL_CALL_RESULT schema validation', () => {
    it('accepts valid result payload', () => {
        const registry = new Registry();
        registry.declare(agUiToolCallResult);
        expect(
            registry.validate('ag-ui.TOOL_CALL_RESULT', {
                type: 'TOOL_CALL_RESULT',
                messageId: 'msg_4',
                toolCallId: 'tc_1',
                toolCallName: 'search',
                content: [{ type: 'text', text: 'result data' }],
            }).valid,
        ).toBe(true);
    });

    it('rejects when content is missing', () => {
        const registry = new Registry();
        registry.declare(agUiToolCallResult);
        expect(
            registry.validate('ag-ui.TOOL_CALL_RESULT', {
                type: 'TOOL_CALL_RESULT',
                messageId: 'msg_4',
                toolCallId: 'tc_1',
                toolCallName: 'search',
            }).valid,
        ).toBe(false);
    });
});

describe('ag-ui extension events', () => {
    it('ag-ui.REASONING_ENCRYPTED_VALUE accepts opaque string value', () => {
        const registry = new Registry();
        registry.declare(agUiReasoningEncryptedValue);
        expect(
            registry.validate('ag-ui.REASONING_ENCRYPTED_VALUE', {
                type: 'REASONING_ENCRYPTED_VALUE',
                value: 'base64encodedciphertext==',
            }).valid,
        ).toBe(true);
    });

    it('ag-ui.CUSTOM accepts arbitrary named payload', () => {
        const registry = new Registry();
        registry.declare(agUiCustom);
        expect(
            registry.validate('ag-ui.CUSTOM', {
                type: 'CUSTOM',
                name: 'my-app.custom-event',
                value: { foo: 42 },
            }).valid,
        ).toBe(true);
    });
});
