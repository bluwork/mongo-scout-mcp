import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { preprocessQuery } from '../utils/query-preprocessor.js';
import { convertObjectIdsToExtendedJson } from '../utils/sanitize.js';

export function registerAdvancedOperations(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  // Preview bulk write operations
  registerTool(
    'previewBulkWrite',
    'Preview what a bulkWrite operation would do without executing it',
    {
      collection: z.string(),
      operations: z.array(z.record(z.any())),
    },
    async (args) => {
      logToolUsage('previewBulkWrite', args);
      const { collection, operations } = args;
      try {
        const operationsSummary = {
          insertOne: 0,
          updateOne: 0,
          updateMany: 0,
          deleteOne: 0,
          deleteMany: 0,
          replaceOne: 0
        };

        // Count operation types
        operations.forEach((op: Record<string, any>) => {
          Object.keys(op).forEach(opType => {
            if (opType in operationsSummary) {
              operationsSummary[opType as keyof typeof operationsSummary]++;
            }
          });
        });

        // Extract sample operations for each type
        const samples: Record<string, any> = {};
        for (const [opType, count] of Object.entries(operationsSummary)) {
          if (count > 0) {
            const sample = operations.find((op: Record<string, any>) => opType in op);
            if (sample) {
              samples[opType] = sample[opType];
            }
          }
        }

        const totalOps = operations.length;
        let warning: string | undefined;
        if (totalOps >= 1000) {
          warning = '⚠⚠ LARGE BULK OPERATION: 1000+ operations';
        } else if (totalOps >= 100) {
          warning = '⚠ Large bulk operation: 100+ operations';
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson({
                preview: true,
                collection,
                totalOperations: totalOps,
                breakdown: operationsSummary,
                sampleOperations: samples,
                message: warning
              }), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('previewBulkWrite', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error previewing bulk write: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'bulkWrite',
    'Execute multiple write operations in a single call. Supports dryRun mode for preview.',
    {
      collection: z.string(),
      operations: z.array(z.record(z.any())),
      options: z.object({
        ordered: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('bulkWrite', args);
      const { collection, operations, options = {} } = args;
      try {
        // Dry run mode - show what would be executed
        if (options.dryRun) {
          const operationsSummary = {
            insertOne: 0,
            updateOne: 0,
            updateMany: 0,
            deleteOne: 0,
            deleteMany: 0,
            replaceOne: 0
          };

          operations.forEach((op: Record<string, any>) => {
            Object.keys(op).forEach(opType => {
              if (opType in operationsSummary) {
                operationsSummary[opType as keyof typeof operationsSummary]++;
              }
            });
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  dryRun: true,
                  operation: 'bulkWrite',
                  collection,
                  totalOperations: operations.length,
                  breakdown: operationsSummary,
                  ordered: options.ordered ?? true,
                  warning: operations.length > 100 ? '⚠ Large bulk operation detected' : undefined
                }), null, 2),
              },
            ],
          };
        }

        // Actual execution
        const result = await db.collection(collection).bulkWrite(operations, {
          ordered: options.ordered
        });

        const totalAffected = result.insertedCount + result.modifiedCount + result.deletedCount;
        const warningText = totalAffected > 100 ? '\n⚠ Large bulk operation completed' : '';

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson({
                insertedCount: result.insertedCount,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
                deletedCount: result.deletedCount,
                upsertedCount: result.upsertedCount,
                upsertedIds: result.upsertedIds,
              }), null, 2) + warningText,
            },
          ],
        };
      } catch (error) {
        logError('bulkWrite', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing bulk write: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'explainQuery',
    'Get query execution plan for optimization',
    {
      collection: z.string(),
      operation: z.enum(['find', 'aggregate', 'update', 'delete']),
      query: z.record(z.any()),
      update: z.record(z.any()).optional(),
      pipeline: z.array(z.record(z.any())).optional(),
      verbosity: z.enum(['queryPlanner', 'executionStats', 'allPlansExecution']).optional(),
    },
    async (args) => {
      logToolUsage('explainQuery', args);
      const { collection, operation, query, update, pipeline, verbosity = 'queryPlanner' } = args;
      try {
        const processedQuery = preprocessQuery(query);
        let explainResult;

        switch (operation) {
          case 'find':
            explainResult = await db.collection(collection).find(processedQuery).explain(verbosity);
            break;
          case 'aggregate':
            if (!pipeline) {
              throw new Error('Pipeline is required for aggregate operation');
            }
            explainResult = await db.collection(collection).aggregate(pipeline).explain(verbosity);
            break;
          case 'update':
            if (!update) {
              throw new Error('Update is required for update operation');
            }
            // Use explain command for update operations
            explainResult = await db.command({
              explain: {
                update: collection,
                updates: [{ q: processedQuery, u: update }]
              },
              verbosity
            });
            break;
          case 'delete':
            // Use explain command for delete operations
            explainResult = await db.command({
              explain: {
                delete: collection,
                deletes: [{ q: processedQuery, limit: 0 }]
              },
              verbosity
            });
            break;
          default:
            throw new Error(`Unsupported operation: ${operation}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(explainResult), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('explainQuery', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error explaining query: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'textSearch',
    'Perform full-text search on indexed fields',
    {
      collection: z.string(),
      searchText: z.string(),
      filter: z.record(z.any()).optional(),
      limit: z.number().positive().optional(),
      projection: z.record(z.any()).optional(),
    },
    async (args) => {
      logToolUsage('textSearch', args);
      const { collection, searchText, filter = {}, limit = 10, projection = {} } = args;
      try {
        const searchQuery = {
          $text: { $search: searchText },
          ...filter
        };

        const results = await db.collection(collection)
          .find(searchQuery)
          .project({ ...projection, score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' } })
          .limit(limit)
          .toArray();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(results), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('textSearch', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error performing text search: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}
