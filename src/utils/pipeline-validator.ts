export const MAX_PIPELINE_STAGES = 20;
export const EXPENSIVE_STAGES = ['$lookup', '$graphLookup', '$facet', '$unionWith'];
export const MAX_EXPENSIVE_STAGES = 3;

export interface PipelineValidationResult {
  valid: boolean;
  error?: string;
  stageCount: number;
  expensiveStageCount: number;
}

export function validatePipeline(pipeline: Record<string, unknown>[]): PipelineValidationResult {
  const stageCount = pipeline.length;

  if (stageCount > MAX_PIPELINE_STAGES) {
    return {
      valid: false,
      error: `Pipeline has ${stageCount} stages, exceeding the maximum of ${MAX_PIPELINE_STAGES}. Simplify the pipeline or break it into multiple queries.`,
      stageCount,
      expensiveStageCount: 0,
    };
  }

  let expensiveStageCount = 0;
  const expensiveStagesFound: string[] = [];

  for (const stage of pipeline) {
    const stageOp = Object.keys(stage)[0];
    if (stageOp && EXPENSIVE_STAGES.includes(stageOp)) {
      expensiveStageCount++;
      expensiveStagesFound.push(stageOp);
    }
  }

  if (expensiveStageCount > MAX_EXPENSIVE_STAGES) {
    return {
      valid: false,
      error: `Pipeline has ${expensiveStageCount} expensive stages (${expensiveStagesFound.join(', ')}), exceeding the maximum of ${MAX_EXPENSIVE_STAGES}. Reduce the number of ${EXPENSIVE_STAGES.join('/')} stages.`,
      stageCount,
      expensiveStageCount,
    };
  }

  return { valid: true, stageCount, expensiveStageCount };
}
