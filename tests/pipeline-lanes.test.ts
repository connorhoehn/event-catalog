import { describe, it, expect } from 'vitest';
import {
  isPipelineMqLaneEvent,
  isPipelineHotLaneEvent,
  PIPELINE_MQ_MAX_BODY_BYTES,
} from '../src/index';

describe('pipeline lanes (MQ vs Redis hot lane)', () => {
  it('puts lifecycle, approvals and deck-revise phases on MQ', () => {
    for (const t of ['pipeline:run:started', 'pipeline:run:completed', 'pipeline:step:started',
      'pipeline:step:breakpoint', 'pipeline:approval:requested', 'pipeline:deck:revise:phase']) {
      expect(isPipelineMqLaneEvent(t)).toBe(true);
      expect(isPipelineHotLaneEvent(t)).toBe(false);
    }
  });

  it('keeps checkpoints, heartbeats, context patches and every LLM event hot-lane only', () => {
    for (const t of ['pipeline:run:checkpoint', 'pipeline:step:heartbeat',
      'pipeline:step:context.patched', 'pipeline:step:context.patch-reverted',
      'pipeline:llm:token', 'pipeline:llm:prompt', 'pipeline:llm:response', 'pipeline:llm:stream:opened']) {
      expect(isPipelineMqLaneEvent(t)).toBe(false);
      expect(isPipelineHotLaneEvent(t)).toBe(true);
    }
  });

  it('treats non-strings and unknown families as hot-lane (never on MQ)', () => {
    expect(isPipelineMqLaneEvent(undefined)).toBe(false);
    expect(isPipelineMqLaneEvent(42)).toBe(false);
    expect(isPipelineHotLaneEvent('pipeline:other:thing')).toBe(true);
  });

  it('an MQ-lane event over the MQ body cap is hot-lane (the relay skipped it)', () => {
    expect(isPipelineHotLaneEvent('pipeline:step:completed', PIPELINE_MQ_MAX_BODY_BYTES)).toBe(false);
    expect(isPipelineHotLaneEvent('pipeline:step:completed', PIPELINE_MQ_MAX_BODY_BYTES + 1)).toBe(true);
  });

  it('the two predicates partition every type: exactly one lane each', () => {
    for (const t of ['pipeline:run:started', 'pipeline:llm:token', 'pipeline:step:heartbeat', 'x']) {
      expect(isPipelineMqLaneEvent(t) !== isPipelineHotLaneEvent(t)).toBe(true);
    }
  });
});
