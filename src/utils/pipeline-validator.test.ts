import { describe, it, expect } from 'vitest';
import {
  validatePipeline,
  MAX_PIPELINE_STAGES,
  MAX_EXPENSIVE_STAGES,
  EXPENSIVE_STAGES,
} from './pipeline-validator.js';

describe('validatePipeline', () => {
  it('accepts a simple pipeline', () => {
    const result = validatePipeline([{ $match: { status: 'active' } }, { $limit: 10 }]);
    expect(result.valid).toBe(true);
    expect(result.stageCount).toBe(2);
    expect(result.expensiveStageCount).toBe(0);
  });

  it('accepts empty pipeline', () => {
    const result = validatePipeline([]);
    expect(result.valid).toBe(true);
    expect(result.stageCount).toBe(0);
  });

  it('rejects pipeline exceeding MAX_PIPELINE_STAGES', () => {
    const pipeline = Array.from({ length: MAX_PIPELINE_STAGES + 1 }, () => ({
      $match: { x: 1 },
    }));
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`${MAX_PIPELINE_STAGES + 1} stages`);
    expect(result.error).toContain(`maximum of ${MAX_PIPELINE_STAGES}`);
  });

  it('accepts pipeline at exactly MAX_PIPELINE_STAGES', () => {
    const pipeline = Array.from({ length: MAX_PIPELINE_STAGES }, () => ({
      $match: { x: 1 },
    }));
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(true);
    expect(result.stageCount).toBe(MAX_PIPELINE_STAGES);
  });

  it('counts expensive stages correctly', () => {
    const pipeline = [
      { $lookup: { from: 'other', localField: 'a', foreignField: 'b', as: 'joined' } },
      { $match: { status: 'active' } },
      { $facet: { count: [{ $count: 'total' }] } },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(true);
    expect(result.expensiveStageCount).toBe(2);
  });

  it('rejects pipeline exceeding MAX_EXPENSIVE_STAGES', () => {
    const pipeline = Array.from({ length: MAX_EXPENSIVE_STAGES + 1 }, () => ({
      $lookup: { from: 'other', localField: 'a', foreignField: 'b', as: 'joined' },
    }));
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`${MAX_EXPENSIVE_STAGES + 1} expensive stages`);
  });

  it('accepts pipeline at exactly MAX_EXPENSIVE_STAGES', () => {
    const pipeline = Array.from({ length: MAX_EXPENSIVE_STAGES }, () => ({
      $lookup: { from: 'other', localField: 'a', foreignField: 'b', as: 'joined' },
    }));
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(true);
    expect(result.expensiveStageCount).toBe(MAX_EXPENSIVE_STAGES);
  });

  it('identifies all expensive stage types', () => {
    const pipeline = EXPENSIVE_STAGES.map((stage) => ({ [stage]: {} }));
    const result = validatePipeline(pipeline);
    expect(result.expensiveStageCount).toBe(EXPENSIVE_STAGES.length);
  });

  it('exports expected constants', () => {
    expect(MAX_PIPELINE_STAGES).toBe(20);
    expect(MAX_EXPENSIVE_STAGES).toBe(3);
    expect(EXPENSIVE_STAGES).toContain('$lookup');
    expect(EXPENSIVE_STAGES).toContain('$graphLookup');
    expect(EXPENSIVE_STAGES).toContain('$facet');
    expect(EXPENSIVE_STAGES).toContain('$unionWith');
  });
});
