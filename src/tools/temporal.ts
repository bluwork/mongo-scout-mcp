import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { preprocessQuery } from '../utils/query-preprocessor.js';

export function registerTemporalTools(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'findRecent',
    'Find documents created or modified within a specified time window. Convenience wrapper for temporal queries.',
    {
      collection: z.string(),
      timestampField: z.string(),
      timeWindow: z.object({
        value: z.number().positive(),
        unit: z.enum(['minutes', 'hours', 'days', 'weeks']),
      }),
      options: z.object({
        filter: z.record(z.any()).optional(),
        sort: z.record(z.number()).optional(),
        limit: z.number().positive().optional(),
        projection: z.record(z.any()).optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('findRecent', args);
      const { collection, timestampField, timeWindow, options = {} } = args;
      const {
        filter = {},
        sort,
        limit = 100,
        projection,
      } = options;

      try {
        const collectionObj = db.collection(collection);

        // Calculate time threshold
        const now = new Date();
        let thresholdMs: number;

        switch (timeWindow.unit) {
          case 'minutes':
            thresholdMs = timeWindow.value * 60 * 1000;
            break;
          case 'hours':
            thresholdMs = timeWindow.value * 60 * 60 * 1000;
            break;
          case 'days':
            thresholdMs = timeWindow.value * 24 * 60 * 60 * 1000;
            break;
          case 'weeks':
            thresholdMs = timeWindow.value * 7 * 24 * 60 * 60 * 1000;
            break;
          default:
            thresholdMs = timeWindow.value * 24 * 60 * 60 * 1000; // Default to days
            break;
        }

        const threshold = new Date(now.getTime() - thresholdMs);

        // Build query
        const processedFilter = preprocessQuery(filter);
        const timeQuery = {
          ...processedFilter,
          [timestampField]: { $gte: threshold },
        };

        // Execute query
        let cursor = collectionObj.find(timeQuery);

        if (projection) cursor = cursor.project(projection);
        if (sort) {
          cursor = cursor.sort(sort);
        } else {
          // Default sort by timestamp descending
          cursor = cursor.sort({ [timestampField]: -1 });
        }
        if (limit) cursor = cursor.limit(limit);

        const documents = await cursor.toArray();
        const totalCount = await collectionObj.countDocuments(timeQuery);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  collection,
                  timestampField,
                  timeWindow: `Last ${timeWindow.value} ${timeWindow.unit}`,
                  threshold: threshold.toISOString(),
                  documentsFound: documents.length,
                  totalMatching: totalCount,
                  hasMore: totalCount > documents.length,
                  documents,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('findRecent', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding recent documents: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'findInTimeRange',
    'Find documents within a specific date range. Useful for historical analysis and time-based filtering.',
    {
      collection: z.string(),
      timestampField: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      options: z.object({
        filter: z.record(z.any()).optional(),
        sort: z.record(z.number()).optional(),
        limit: z.number().positive().optional(),
        projection: z.record(z.any()).optional(),
        groupBy: z.enum(['hour', 'day', 'week', 'month']).optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('findInTimeRange', args);
      const { collection, timestampField, startDate, endDate, options = {} } = args;
      const {
        filter = {},
        sort,
        limit = 100,
        projection,
        groupBy,
      } = options;

      try {
        const collectionObj = db.collection(collection);
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Invalid date format',
                  suggestion: 'Use ISO 8601 format (e.g., "2025-01-15T00:00:00Z")',
                }, null, 2),
              },
            ],
          };
        }

        const processedFilter = preprocessQuery(filter);
        const timeQuery = {
          ...processedFilter,
          [timestampField]: {
            $gte: start,
            $lte: end,
          },
        };

        // If groupBy is specified, use aggregation
        if (groupBy) {
          const groupFormat = getDateGroupFormat(groupBy);

          const pipeline: any[] = [
            { $match: timeQuery },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: groupFormat,
                    date: `$${timestampField}`,
                  },
                },
                count: { $sum: 1 },
                documents: { $push: '$$ROOT' },
              },
            },
            { $sort: { _id: 1 } },
          ];

          if (limit) {
            pipeline.push({ $limit: limit });
          }

          const grouped = await collectionObj.aggregate(pipeline).toArray();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    collection,
                    timestampField,
                    startDate: start.toISOString(),
                    endDate: end.toISOString(),
                    groupBy,
                    totalGroups: grouped.length,
                    groups: grouped.map((g: any) => ({
                      period: g._id,
                      count: g.count,
                      sampleDocuments: g.documents.slice(0, 3),
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Regular query without grouping
        let cursor = collectionObj.find(timeQuery);

        if (projection) cursor = cursor.project(projection);
        if (sort) {
          cursor = cursor.sort(sort);
        } else {
          cursor = cursor.sort({ [timestampField]: -1 });
        }
        if (limit) cursor = cursor.limit(limit);

        const documents = await cursor.toArray();
        const totalCount = await collectionObj.countDocuments(timeQuery);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  collection,
                  timestampField,
                  startDate: start.toISOString(),
                  endDate: end.toISOString(),
                  documentsFound: documents.length,
                  totalMatching: totalCount,
                  hasMore: totalCount > documents.length,
                  documents,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('findInTimeRange', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding documents in time range: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'detectVolumeAnomalies',
    'Detect anomalies in document creation/update volume over time. Useful for identifying unusual activity patterns.',
    {
      collection: z.string(),
      timestampField: z.string(),
      options: z.object({
        filter: z.record(z.any()).optional(),
        groupBy: z.enum(['hour', 'day', 'week']).optional(),
        lookbackPeriods: z.number().int().positive().max(365).optional(),
        threshold: z.number().positive().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('detectVolumeAnomalies', args);
      const { collection, timestampField, options = {} } = args;
      const {
        filter = {},
        groupBy = 'day',
        lookbackPeriods = 30,
        threshold = 2.0,
      } = options;

      try {
        const collectionObj = db.collection(collection);
        const processedFilter = preprocessQuery(filter);

        // Calculate lookback date
        const now = new Date();
        let lookbackMs: number;

        switch (groupBy) {
          case 'hour':
            lookbackMs = lookbackPeriods * 60 * 60 * 1000;
            break;
          case 'day':
            lookbackMs = lookbackPeriods * 24 * 60 * 60 * 1000;
            break;
          case 'week':
            lookbackMs = lookbackPeriods * 7 * 24 * 60 * 60 * 1000;
            break;
          default:
            lookbackMs = lookbackPeriods * 24 * 60 * 60 * 1000; // Default to days
            break;
        }

        const lookbackDate = new Date(now.getTime() - lookbackMs);
        const groupFormat = getDateGroupFormat(groupBy);

        // Aggregate by time period
        const pipeline: any[] = [
          {
            $match: {
              ...processedFilter,
              [timestampField]: { $gte: lookbackDate },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: groupFormat,
                  date: `$${timestampField}`,
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ];

        const grouped = await collectionObj.aggregate(pipeline).toArray();

        if (grouped.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  collection,
                  message: 'No data found in lookback period',
                }, null, 2),
              },
            ],
          };
        }

        // Calculate statistics
        const counts = grouped.map((g: any) => g.count);
        const mean = counts.reduce((a: number, b: number) => a + b, 0) / counts.length;
        const variance = counts.reduce((sum: number, count: number) => sum + Math.pow(count - mean, 2), 0) / counts.length;
        const stdDev = Math.sqrt(variance);

        // Detect anomalies (values beyond threshold * stdDev from mean)
        const anomalies = grouped
          .map((g: any) => ({
            period: g._id,
            count: g.count,
            deviation: Math.abs(g.count - mean) / stdDev,
            direction: g.count > mean ? 'high' : 'low',
          }))
          .filter((item: any) => item.deviation >= threshold)
          .sort((a: any, b: any) => b.deviation - a.deviation);

        const recommendations: string[] = [];

        if (anomalies.length === 0) {
          recommendations.push('✓ No significant volume anomalies detected');
        } else {
          const highAnomalies = anomalies.filter((a: any) => a.direction === 'high').length;
          const lowAnomalies = anomalies.filter((a: any) => a.direction === 'low').length;

          if (highAnomalies > 0) {
            recommendations.push(
              `⚠ Found ${highAnomalies} period(s) with unusually HIGH volume (>${threshold}σ above mean)`
            );
          }
          if (lowAnomalies > 0) {
            recommendations.push(
              `Found ${lowAnomalies} period(s) with unusually LOW volume (>${threshold}σ below mean)`
            );
          }

          // Check for recent anomalies
          const recentAnomalies = anomalies.filter((a: any) => {
            const periodDate = new Date(a.period);
            const daysSinceAnomaly = (now.getTime() - periodDate.getTime()) / (1000 * 60 * 60 * 24);
            return daysSinceAnomaly < 7;
          });

          if (recentAnomalies.length > 0) {
            recommendations.push('⚠ Anomalies detected in the last 7 days - investigate recent changes');
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  collection,
                  timestampField,
                  analysis: {
                    groupBy,
                    lookbackPeriods,
                    threshold: `${threshold}σ`,
                    periodsAnalyzed: grouped.length,
                  },
                  statistics: {
                    mean: parseFloat(mean.toFixed(2)),
                    stdDev: parseFloat(stdDev.toFixed(2)),
                    min: Math.min(...counts),
                    max: Math.max(...counts),
                  },
                  anomaliesDetected: anomalies.length,
                  anomalies: anomalies.slice(0, 10), // Top 10 anomalies
                  volumeTrend: grouped.map((g: any) => ({
                    period: g._id,
                    count: g.count,
                  })),
                  recommendations,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('detectVolumeAnomalies', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error detecting volume anomalies: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}

// Helper function to get date format string for grouping
function getDateGroupFormat(groupBy: string): string {
  switch (groupBy) {
    case 'hour':
      return '%Y-%m-%dT%H:00:00Z';
    case 'day':
      return '%Y-%m-%d';
    case 'week':
      return '%Y-W%V'; // ISO week
    case 'month':
      return '%Y-%m';
    default:
      return '%Y-%m-%d';
  }
}
