import { validateCollectionName } from './name-validator.js';
import { scanForDangerousOperators } from './operator-validator.js';

export const MAX_PIPELINE_STAGES = 20;
export const EXPENSIVE_STAGES = ['$lookup', '$graphLookup', '$facet', '$unionWith'];
export const MAX_EXPENSIVE_STAGES = 3;
export const WRITE_STAGES = ['$out', '$merge'];
export const BLOCKED_STAGES = ['$currentOp', '$listSessions', '$listLocalSessions', '$changeStream'];

export interface PipelineValidationResult {
  valid: boolean;
  error?: string;
  stageCount: number;
  expensiveStageCount: number;
  writeStages?: string[];
}

function countStages(
  pipeline: Record<string, unknown>[],
  totals: { stages: number; expensive: number; expensiveNames: string[]; writeStages: string[]; blockedStages: string[]; blockedCollections: string[] }
): void {
  for (const stage of pipeline) {
    if (totals.writeStages.length > 0 || totals.blockedStages.length > 0) return;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) continue;
    const keys = Object.keys(stage);
    const stageOp = keys[0];
    if (!stageOp) continue;

    totals.stages++;
    if (EXPENSIVE_STAGES.includes(stageOp)) {
      totals.expensive++;
      totals.expensiveNames.push(stageOp);
    }

    // Scan all keys for write and blocked stages (defense-in-depth against multi-key objects)
    for (const key of keys) {
      if (WRITE_STAGES.includes(key)) {
        totals.writeStages.push(key);
      }
      if (BLOCKED_STAGES.includes(key)) {
        totals.blockedStages.push(key);
      }
    }
    if (totals.writeStages.length > 0 || totals.blockedStages.length > 0) return;

    // Recurse into nested sub-pipelines for all keys (defense-in-depth against multi-key objects)
    for (const key of keys) {
      const stageBody = stage[key];
      if (key === '$unionWith' && typeof stageBody === 'string') {
        const nameCheck = validateCollectionName(stageBody);
        if (!nameCheck.valid) {
          totals.blockedCollections.push(stageBody);
        }
      }
      if (!stageBody || typeof stageBody !== 'object' || Array.isArray(stageBody)) continue;
      const body = stageBody as Record<string, unknown>;
      // Check collection references for system collection access
      if ((key === '$lookup' || key === '$graphLookup') && typeof body.from === 'string') {
        const nameCheck = validateCollectionName(body.from);
        if (!nameCheck.valid) {
          totals.blockedCollections.push(body.from);
        }
      }
      if (key === '$unionWith') {
        if (typeof body.coll === 'string') {
          const nameCheck = validateCollectionName(body.coll);
          if (!nameCheck.valid) {
            totals.blockedCollections.push(body.coll);
          }
        }
      }
      if ((key === '$lookup' || key === '$graphLookup') && Array.isArray(body.pipeline)) {
        countStages(body.pipeline as Record<string, unknown>[], totals);
      }
      if (key === '$facet') {
        for (const subPipeline of Object.values(body)) {
          if (Array.isArray(subPipeline)) {
            countStages(subPipeline as Record<string, unknown>[], totals);
          }
        }
      }
      if (key === '$unionWith' && Array.isArray(body.pipeline)) {
        countStages(body.pipeline as Record<string, unknown>[], totals);
      }
    }
  }
}

export function validatePipeline(pipeline: Record<string, unknown>[]): PipelineValidationResult {
  const dangerousScan = scanForDangerousOperators(pipeline);
  if (dangerousScan.found) {
    return {
      valid: false,
      error: `Pipeline contains blocked operator ${dangerousScan.operator} at ${dangerousScan.path}: server-side JavaScript execution is not allowed.`,
      stageCount: 0,
      expensiveStageCount: 0,
    };
  }

  const totals = { stages: 0, expensive: 0, expensiveNames: [] as string[], writeStages: [] as string[], blockedStages: [] as string[], blockedCollections: [] as string[] };
  countStages(pipeline, totals);

  if (totals.blockedStages.length > 0) {
    return {
      valid: false,
      error: `Pipeline contains blocked stage(s): ${totals.blockedStages.join(', ')}. These admin-like stages are not allowed.`,
      stageCount: totals.stages,
      expensiveStageCount: totals.expensive,
    };
  }

  if (totals.blockedCollections.length > 0) {
    return {
      valid: false,
      error: `Pipeline references blocked collection(s): ${totals.blockedCollections.join(', ')}. Access to system collections is not allowed in aggregation stages.`,
      stageCount: totals.stages,
      expensiveStageCount: totals.expensive,
    };
  }

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
