export const MAX_PIPELINE_STAGES = 20;
export const EXPENSIVE_STAGES = ['$lookup', '$graphLookup', '$facet', '$unionWith'];
export const MAX_EXPENSIVE_STAGES = 3;
export const WRITE_STAGES = ['$out', '$merge'];

export interface PipelineValidationResult {
  valid: boolean;
  error?: string;
  stageCount: number;
  expensiveStageCount: number;
  writeStages?: string[];
}

function countStages(
  pipeline: Record<string, unknown>[],
  totals: { stages: number; expensive: number; expensiveNames: string[]; writeStages: string[] }
): void {
  for (const stage of pipeline) {
    if (totals.writeStages.length > 0) return;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) continue;
    const keys = Object.keys(stage);
    const stageOp = keys[0];
    if (!stageOp) continue;

    totals.stages++;
    if (EXPENSIVE_STAGES.includes(stageOp)) {
      totals.expensive++;
      totals.expensiveNames.push(stageOp);
    }

    // Scan all keys for write stages (defense-in-depth against multi-key objects)
    for (const key of keys) {
      if (WRITE_STAGES.includes(key)) {
        totals.writeStages.push(key);
      }
    }
    if (totals.writeStages.length > 0) return;

    // Recurse into nested sub-pipelines only for operators that define them
    const stageBody = stage[stageOp];
    if (stageBody && typeof stageBody === 'object' && !Array.isArray(stageBody)) {
      const body = stageBody as Record<string, unknown>;
      if ((stageOp === '$lookup' || stageOp === '$graphLookup') && Array.isArray(body.pipeline)) {
        countStages(body.pipeline as Record<string, unknown>[], totals);
      }
      if (stageOp === '$facet') {
        for (const subPipeline of Object.values(body)) {
          if (Array.isArray(subPipeline)) {
            countStages(subPipeline as Record<string, unknown>[], totals);
          }
        }
      }
      if (stageOp === '$unionWith' && Array.isArray(body.pipeline)) {
        countStages(body.pipeline as Record<string, unknown>[], totals);
      }
    }
  }
}

export function validatePipeline(pipeline: Record<string, unknown>[]): PipelineValidationResult {
  const totals = { stages: 0, expensive: 0, expensiveNames: [] as string[], writeStages: [] as string[] };
  countStages(pipeline, totals);

  if (totals.writeStages.length > 0) {
    return {
      valid: false,
      error: `Pipeline contains write stages (${totals.writeStages.join(', ')}) which are not allowed. Use dedicated write tools instead.`,
      stageCount: totals.stages,
      expensiveStageCount: totals.expensive,
      writeStages: totals.writeStages,
    };
  }

  if (totals.stages > MAX_PIPELINE_STAGES) {
    return {
      valid: false,
      error: `Pipeline has ${totals.stages} stages (including nested), exceeding the maximum of ${MAX_PIPELINE_STAGES}. Simplify the pipeline or break it into multiple queries.`,
      stageCount: totals.stages,
      expensiveStageCount: totals.expensive,
    };
  }

  if (totals.expensive > MAX_EXPENSIVE_STAGES) {
    return {
      valid: false,
      error: `Pipeline has ${totals.expensive} expensive stages (${totals.expensiveNames.join(', ')}), exceeding the maximum of ${MAX_EXPENSIVE_STAGES}. Reduce the number of ${EXPENSIVE_STAGES.join('/')} stages.`,
      stageCount: totals.stages,
      expensiveStageCount: totals.expensive,
    };
  }

  return { valid: true, stageCount: totals.stages, expensiveStageCount: totals.expensive };
}
