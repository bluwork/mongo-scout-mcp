/**
 * Sanitizes aggregate options by allowlisting only safe keys.
 * Strips write-enabling options like `out` that bypass pipeline validation.
 */

const SAFE_AGGREGATE_OPTIONS = new Set([
  'allowDiskUse',
  'batchSize',
  'collation',
  'comment',
  'cursor',
  'hint',
  'let',
  'maxTimeMS',
  'readConcern',
  'readPreference',
]);

export function sanitizeAggregateOptions(
  options: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(options)) {
    if (SAFE_AGGREGATE_OPTIONS.has(key)) {
      sanitized[key] = options[key];
    }
  }
  return sanitized;
}
