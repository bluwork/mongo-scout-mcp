import { scanForDangerousOperators } from './operator-validator.js';

export const VALID_BULK_OPERATION_TYPES = [
  'insertOne',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
] as const;

export const MAX_BULK_OPERATIONS = 1000;

const MULTI_DOC_OPERATIONS = ['updateMany', 'deleteMany'];

const OPERATIONS_WITH_FILTER = ['updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne'];

export interface BulkValidationResult {
  valid: boolean;
  error?: string;
}

export function validateBulkOperations(operations: Record<string, any>[]): BulkValidationResult {
  if (operations.length === 0) {
    return { valid: false, error: 'Operations array is empty. Provide at least one operation.' };
  }

  if (operations.length > MAX_BULK_OPERATIONS) {
    return {
      valid: false,
      error: `Operations count (${operations.length}) exceeds the maximum of ${MAX_BULK_OPERATIONS}.`,
    };
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const opIndex = i + 1; // 1-based for human-readable messages

    if (op === null || op === undefined || typeof op !== 'object' || Array.isArray(op)) {
      return {
        valid: false,
        error: `Operation ${opIndex}: expected a non-null object, got ${op === null ? 'null' : Array.isArray(op) ? 'array' : typeof op}.`,
      };
    }

    const keys = Object.keys(op);

    if (keys.length === 0) {
      return { valid: false, error: `Operation ${opIndex}: empty operation object.` };
    }

    if (keys.length > 1) {
      return {
        valid: false,
        error: `Operation ${opIndex}: contains multiple operation types (${keys.join(', ')}). Each operation object must have exactly one type.`,
      };
    }

    const opType = keys[0];

    if (!VALID_BULK_OPERATION_TYPES.includes(opType as any)) {
      return {
        valid: false,
        error: `Operation ${opIndex}: unknown operation type '${opType}'. Valid types: ${VALID_BULK_OPERATION_TYPES.join(', ')}.`,
      };
    }

    const opBody = op[opType];

    // Check empty filters on multi-doc operations
    if (MULTI_DOC_OPERATIONS.includes(opType)) {
      const filter = opBody?.filter;
      const isValidFilter = filter && typeof filter === 'object' && !Array.isArray(filter);
      if (!isValidFilter || Object.keys(filter).length === 0) {
        return {
          valid: false,
          error: `Operation ${opIndex} (${opType}): empty filter would affect ALL documents. Use a specific filter or dedicated ${opType} tool with allowEmptyFilter option.`,
        };
      }
    }

    // Scan filters and update docs for dangerous operators
    if (OPERATIONS_WITH_FILTER.includes(opType) && opBody?.filter) {
      const filterScan = scanForDangerousOperators(opBody.filter);
      if (filterScan.found) {
        return {
          valid: false,
          error: `Operation ${opIndex} (${opType}): filter contains blocked operator ${filterScan.operator} at ${filterScan.path}. Server-side JavaScript execution is not allowed.`,
        };
      }
    }

    // Scan update documents for dangerous operators
    if ((opType === 'updateOne' || opType === 'updateMany') && opBody?.update) {
      const updateScan = scanForDangerousOperators(opBody.update);
      if (updateScan.found) {
        return {
          valid: false,
          error: `Operation ${opIndex} (${opType}): update contains blocked operator ${updateScan.operator} at ${updateScan.path}. Server-side JavaScript execution is not allowed.`,
        };
      }
    }

    // Scan replacement documents for dangerous operators
    if (opType === 'replaceOne' && opBody?.replacement) {
      const replaceScan = scanForDangerousOperators(opBody.replacement);
      if (replaceScan.found) {
        return {
          valid: false,
          error: `Operation ${opIndex} (${opType}): replacement contains blocked operator ${replaceScan.operator} at ${replaceScan.path}. Server-side JavaScript execution is not allowed.`,
        };
      }
    }
  }

  return { valid: true };
}
