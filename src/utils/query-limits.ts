/** Maximum number of documents returned by general query tools (find, textSearch, findRecent, findInTimeRange) */
export const MAX_QUERY_LIMIT = 10_000;

/** Maximum number of documents returned by exportCollection */
export const MAX_EXPORT_LIMIT = 50_000;

/** Maximum sample size for schema inference and data quality tools (inferSchema, findMissingFields, findInconsistentTypes) */
export const MAX_SAMPLE_SIZE = 10_000;

/** Maximum duration for live monitoring endpoints (getLiveMetrics, getHottestCollections) — 5 minutes */
export const MAX_MONITORING_DURATION = 300_000;

/** Minimum polling interval for live monitoring endpoints — 100ms */
export const MIN_MONITORING_INTERVAL = 100;

/** Maximum collection limit for getHottestCollections */
export const MAX_MONITORING_LIMIT = 100;

/** Maximum result size in bytes for aggregation output */
export const MAX_RESULT_SIZE_BYTES = 1_048_576;

export function capResultSize(data: Record<string, unknown>[]): {
  result: Record<string, unknown>[];
  truncated: boolean;
  warning?: string;
} {
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_RESULT_SIZE_BYTES) {
    return { result: data, truncated: false };
  }

  // Binary search for how many items fit
  let lo = 1;
  let hi = data.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(JSON.stringify(data.slice(0, mid)), 'utf8') <= MAX_RESULT_SIZE_BYTES) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // Always return at least 1 item
  const kept = Math.max(1, lo);
  return {
    result: data.slice(0, kept),
    truncated: true,
    warning: `Result exceeded size limit (${MAX_RESULT_SIZE_BYTES} bytes). Showing ${kept} of ${data.length} documents. Use $limit or $project to reduce output.`,
  };
}
