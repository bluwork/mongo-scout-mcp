import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { preprocessQuery } from '../utils/query-preprocessor.js';

export function registerAdvancedOperations(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'bulkWrite',
    'Execute multiple write operations in a single call',
    {
      collection: z.string(),
      operations: z.array(z.record(z.any())),
      options: z.object({
        ordered: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('bulkWrite', args);
      const { collection, operations, options = {} } = args;
      try {
        const result = await db.collection(collection).bulkWrite(operations, options);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                insertedCount: result.insertedCount,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
                deletedCount: result.deletedCount,
                upsertedCount: result.upsertedCount,
                upsertedIds: result.upsertedIds,
              }, null, 2),
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
              text: JSON.stringify(explainResult, null, 2),
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
              text: JSON.stringify(results, null, 2),
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
