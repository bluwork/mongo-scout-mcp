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
