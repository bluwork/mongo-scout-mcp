import { describe, it, expect } from 'vitest';
import {
  validatePipeline,
  MAX_PIPELINE_STAGES,
  MAX_EXPENSIVE_STAGES,
  EXPENSIVE_STAGES,
  WRITE_STAGES,
  BLOCKED_STAGES,
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

  it('counts stages in nested $lookup pipeline', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'orders',
          pipeline: [
            { $match: { status: 'active' } },
            { $limit: 10 },
          ],
          as: 'orders',
        },
      },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(true);
    // 1 top-level $lookup + 2 nested = 3
    expect(result.stageCount).toBe(3);
    expect(result.expensiveStageCount).toBe(1);
  });

  it('counts expensive stages in nested $facet sub-pipelines', () => {
    const pipeline = [
      {
        $facet: {
          branch1: [
            { $lookup: { from: 'a', pipeline: [], as: 'x' } },
            { $lookup: { from: 'b', pipeline: [], as: 'y' } },
          ],
          branch2: [
            { $graphLookup: { from: 'c', startWith: '$x', connectFromField: 'x', connectToField: 'y', as: 'z' } },
          ],
        },
      },
    ];
    const result = validatePipeline(pipeline);
    // 1 $facet + 2 $lookup + 1 $graphLookup = 4 expensive total
    expect(result.expensiveStageCount).toBe(4);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expensive stages');
  });

  it('rejects nested sub-pipeline that pushes total stages over limit', () => {
    const nestedStages = Array.from({ length: 18 }, () => ({ $match: { x: 1 } }));
    const pipeline = [
      { $match: { active: true } },
      { $lookup: { from: 'other', pipeline: nestedStages, as: 'data' } },
      { $limit: 10 },
    ];
    const result = validatePipeline(pipeline);
    // 3 top-level + 18 nested = 21 > 20
    expect(result.valid).toBe(false);
    expect(result.stageCount).toBe(21);
    expect(result.error).toContain('including nested');
  });

  it('handles null/primitive elements in nested pipelines without throwing', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'other',
          pipeline: [null, 42, 'bad', { $match: { x: 1 } }],
          as: 'data',
        },
      },
    ] as any;
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(true);
    // Only the $lookup and the valid $match are counted
    expect(result.stageCount).toBe(2);
  });

  it('does not count a document field named "pipeline" as a sub-pipeline', () => {
    const pipeline = [
      { $match: { pipeline: ['step1', 'step2', 'step3'] } },
      { $project: { pipeline: 1, name: 1 } },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(true);
    expect(result.stageCount).toBe(2);
  });

  it('counts stages inside $unionWith pipeline field', () => {
    const pipeline = [
      {
        $unionWith: {
          coll: 'other',
          pipeline: [{ $match: { x: 1 } }, { $project: { x: 1 } }],
        },
      },
    ];
    const result = validatePipeline(pipeline);
    // 1 $unionWith + 2 nested = 3
    expect(result.stageCount).toBe(3);
    expect(result.expensiveStageCount).toBe(1);
  });

  it('rejects pipeline containing $out stage', () => {
    const pipeline = [
      { $match: { status: 'active' } },
      { $out: 'target_collection' },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('write stages');
    expect(result.error).toContain('$out');
    expect(result.writeStages).toEqual(['$out']);
  });

  it('rejects pipeline containing $merge stage', () => {
    const pipeline = [
      { $match: { status: 'active' } },
      { $merge: { into: 'target', whenMatched: 'replace' } },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('write stages');
    expect(result.error).toContain('$merge');
    expect(result.writeStages).toEqual(['$merge']);
  });

  it('rejects $out nested inside $facet sub-pipeline', () => {
    const pipeline = [
      {
        $facet: {
          branch: [{ $match: { x: 1 } }, { $out: 'sneaky' }],
        },
      },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$out']);
  });

  it('rejects $merge nested inside $lookup sub-pipeline', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'other',
          pipeline: [{ $merge: { into: 'sneaky' } }],
          as: 'data',
        },
      },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$merge']);
  });

  it('rejects $out nested inside $unionWith sub-pipeline', () => {
    const pipeline = [
      {
        $unionWith: {
          coll: 'other',
          pipeline: [{ $match: { y: 1 } }, { $out: 'sneaky' }],
        },
      },
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$out']);
  });

  it('rejects write stage hidden as non-first key in multi-key object', () => {
    const pipeline = [
      { $match: { status: 'active' }, $out: 'sneaky' } as any,
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$out']);
  });

  it('rejects $out nested in $facet when $facet is non-first key', () => {
    const pipeline = [
      {
        $match: { status: 'active' },
        $facet: {
          branch: [{ $match: { x: 1 } }, { $out: 'sneaky' }],
        },
      } as any,
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$out']);
  });

  it('rejects $merge nested in $lookup when $lookup is non-first key', () => {
    const pipeline = [
      {
        $match: { status: 'active' },
        $lookup: {
          from: 'other',
          pipeline: [{ $merge: { into: 'sneaky' } }],
          as: 'data',
        },
      } as any,
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$merge']);
  });

  it('rejects $out nested in $unionWith when $unionWith is non-first key', () => {
    const pipeline = [
      {
        $match: { status: 'active' },
        $unionWith: {
          coll: 'other',
          pipeline: [{ $match: { y: 1 } }, { $out: 'sneaky' }],
        },
      } as any,
    ];
    const result = validatePipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.writeStages).toEqual(['$out']);
  });

  it('exports WRITE_STAGES constant', () => {
    expect(WRITE_STAGES).toContain('$out');
    expect(WRITE_STAGES).toContain('$merge');
  });

  it('rejects pipeline with $where in $match', () => {
    const result = validatePipeline([{ $match: { $where: 'true' } }]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/blocked.*\$where/i);
  });

  it('rejects pipeline with $function in $addFields', () => {
    const result = validatePipeline([
      { $addFields: { x: { $function: { body: 'bad', args: [], lang: 'js' } } } },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/blocked.*\$function/i);
  });

  it('rejects pipeline with $accumulator in $group', () => {
    const result = validatePipeline([
      { $group: { _id: null, total: { $accumulator: { init: '', accumulate: '', merge: '', lang: 'js' } } } },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/blocked.*\$accumulator/i);
  });

  describe('system collection guard', () => {
    it('rejects $lookup from system.profile', () => {
      const pipeline = [
        { $lookup: { from: 'system.profile', localField: 'a', foreignField: 'b', as: 'data' } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system.profile');
    });

    it('rejects $lookup from system.users', () => {
      const pipeline = [
        { $lookup: { from: 'system.users', localField: 'a', foreignField: 'b', as: 'data' } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system.users');
    });

    it('rejects $graphLookup from system.profile', () => {
      const pipeline = [
        { $graphLookup: { from: 'system.profile', startWith: '$x', connectFromField: 'a', connectToField: 'b', as: 'data' } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system.profile');
    });

    it('rejects $unionWith referencing system.profile (object form)', () => {
      const pipeline = [
        { $unionWith: { coll: 'system.profile' } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system.profile');
    });

    it('rejects $unionWith referencing system.profile (string form)', () => {
      const pipeline = [
        { $unionWith: 'system.profile' },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system.profile');
    });

    it('rejects $lookup from system collection nested in $facet', () => {
      const pipeline = [
        {
          $facet: {
            branch: [
              { $lookup: { from: 'system.js', localField: 'a', foreignField: 'b', as: 'data' } },
            ],
          },
        },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system.js');
    });

    it('allows $lookup from normal collections', () => {
      const pipeline = [
        { $lookup: { from: 'orders', localField: 'a', foreignField: 'b', as: 'data' } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(true);
    });

    it('allows $unionWith normal collections', () => {
      const pipeline = [
        { $unionWith: { coll: 'orders' } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(true);
    });

    it('allows $unionWith normal collection (string form)', () => {
      const pipeline = [
        { $unionWith: 'orders' },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(true);
    });
  });

  describe('blocked admin-like stages', () => {
    it('exports BLOCKED_STAGES constant', () => {
      expect(BLOCKED_STAGES).toContain('$currentOp');
      expect(BLOCKED_STAGES).toContain('$listSessions');
      expect(BLOCKED_STAGES).toContain('$listLocalSessions');
      expect(BLOCKED_STAGES).toContain('$changeStream');
    });

    it('rejects $currentOp stage', () => {
      const result = validatePipeline([{ $currentOp: {} }]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$currentOp');
    });

    it('rejects $listSessions stage', () => {
      const result = validatePipeline([{ $listSessions: {} }]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$listSessions');
    });

    it('rejects $listLocalSessions stage', () => {
      const result = validatePipeline([{ $listLocalSessions: {} }]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$listLocalSessions');
    });

    it('rejects $changeStream stage', () => {
      const result = validatePipeline([{ $changeStream: {} }]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$changeStream');
    });

    it('rejects blocked stage nested in $facet', () => {
      const pipeline = [
        { $facet: { branch: [{ $currentOp: {} }] } },
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$currentOp');
    });

    it('rejects blocked stage hidden as non-first key in multi-key object', () => {
      const pipeline = [
        { $match: { x: 1 }, $currentOp: {} } as any,
      ];
      const result = validatePipeline(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$currentOp');
    });

    it('allows normal stages alongside blocked stage check', () => {
      const result = validatePipeline([
        { $match: { status: 'active' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);
      expect(result.valid).toBe(true);
    });
  });
});
