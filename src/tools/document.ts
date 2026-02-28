import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { preprocessQuery } from '../utils/query-preprocessor.js';
import { shouldBlockFilter, validateFilter, getOperationWarning } from '../utils/filter-validator.js';
import { convertObjectIdsToExtendedJson } from '../utils/sanitize.js';
import { validatePipeline } from '../utils/pipeline-validator.js';
import { MAX_QUERY_LIMIT } from '../utils/query-limits.js';
import { capResultSize } from '../utils/query-limits.js';
import { sanitizeAggregateOptions } from '../utils/aggregate-options-sanitizer.js';

export function registerDocumentTools(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  // Read operations
  registerTool(
    'find',
    'Find documents in a collection that match the specified query',
    {
      collection: z.string(),
      query: z.record(z.any()).optional(),
      projection: z.record(z.any()).optional(),
      limit: z.number().positive().max(MAX_QUERY_LIMIT).optional(),
      skip: z.number().nonnegative().optional(),
      sort: z.record(z.number()).optional(),
      hint: z.record(z.number()).optional(),
    },
    async (args) => {
      logToolUsage('find', args);
      const { collection, query = {}, projection = {}, limit = 10, skip = 0, sort = {} as any, hint } = args;
      try {
        const processedQuery = preprocessQuery(query);

        let cursor = db
          .collection(collection)
          .find(processedQuery)
          .project(projection)
          .limit(limit)
          .skip(skip)
          .sort(sort);

        if (hint) {
          cursor = cursor.hint(hint);
        }

        const docs = await cursor.toArray();

        const total = await db.collection(collection).countDocuments(processedQuery);

        const response = {
          documents: docs,
          metadata: {
            total,
            limit,
            skip,
            hasMore: total > skip + docs.length,
          },
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(response), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('find', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing find: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'aggregate',
    'Run an aggregation pipeline on a collection',
    {
      collection: z.string(),
      pipeline: z.array(z.record(z.any())),
      options: z.record(z.any()).optional(),
    },
    async (args) => {
      logToolUsage('aggregate', args);
      const { collection, pipeline, options = {} } = args;

      const pipelineValidation = validatePipeline(pipeline);
      if (!pipelineValidation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `Aggregation pipeline rejected: ${pipelineValidation.error}`,
            },
          ],
        };
      }

      try {
        const safeOptions = sanitizeAggregateOptions({ maxTimeMS: 30000, ...options });
        const rawResult = await db.collection(collection).aggregate(pipeline, safeOptions).toArray();
        const { result, truncated, warning } = capResultSize(rawResult as Record<string, unknown>[]);
        const serialized = JSON.stringify(convertObjectIdsToExtendedJson(result), null, 2);
        const text = truncated ? `${warning}\n\n${serialized}` : serialized;
        return {
          content: [
            {
              type: 'text',
              text,
            },
          ],
        };
      } catch (error) {
        logError('aggregate', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing aggregation: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'count',
    'Count documents in a collection that match the specified query',
    {
      collection: z.string(),
      query: z.record(z.any()).optional(),
    },
    async (args) => {
      logToolUsage('count', args);
      const { collection, query = {} } = args;
      try {
        const processedQuery = preprocessQuery(query);
        const count = await db.collection(collection).countDocuments(processedQuery);
        return {
          content: [
            {
              type: 'text',
              text: `Found ${count} document(s) matching the query.`,
            },
          ],
        };
      } catch (error) {
        logError('count', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error counting documents: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'distinct',
    'Get distinct values for a field across a collection',
    {
      collection: z.string(),
      field: z.string(),
      query: z.record(z.any()).optional(),
    },
    async (args) => {
      logToolUsage('distinct', args);
      const { collection, field, query = {} } = args;
      try {
        const processedQuery = preprocessQuery(query);
        const values = await db.collection(collection).distinct(field, processedQuery);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(values), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('distinct', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting distinct values: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // Preview operations (safety tools)
  registerTool(
    'previewUpdate',
    'Preview which documents would be affected by an update operation without modifying data',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      limit: z.number().positive().max(100).optional(),
    },
    async (args) => {
      logToolUsage('previewUpdate', args);
      const { collection, filter, limit = 3 } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const validation = validateFilter(processedFilter);

        const matchCount = await db.collection(collection).countDocuments(processedFilter);
        const sampleDocs = await db.collection(collection).find(processedFilter).limit(limit).toArray();

        const smartWarning = getOperationWarning(matchCount, 'update');

        const response = {
          willAffect: matchCount,
          sampleDocuments: sampleDocs,
          samplesShown: sampleDocs.length,
          message: smartWarning || (matchCount <= 10 ? `✓ Will update ${matchCount} document${matchCount !== 1 ? 's' : ''}` : undefined),
          filterWarning: validation.warning,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(response), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('previewUpdate', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error previewing update: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'previewDelete',
    'Preview which documents would be deleted without actually deleting them',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      limit: z.number().positive().max(100).optional(),
    },
    async (args) => {
      logToolUsage('previewDelete', args);
      const { collection, filter, limit = 3 } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const validation = validateFilter(processedFilter);

        const deleteCount = await db.collection(collection).countDocuments(processedFilter);
        const sampleDocs = await db.collection(collection).find(processedFilter).limit(limit).toArray();

        const smartWarning = getOperationWarning(deleteCount, 'delete');

        const response = {
          willDelete: deleteCount,
          sampleDocuments: sampleDocs,
          samplesShown: sampleDocs.length,
          message: smartWarning || (deleteCount <= 10 ? `✓ Will delete ${deleteCount} document${deleteCount !== 1 ? 's' : ''}` : undefined),
          filterWarning: validation.warning,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(response), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('previewDelete', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error previewing delete: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // Insert operations
  registerTool(
    'insertOne',
    'Insert a single document into a collection',
    {
      collection: z.string(),
      document: z.record(z.any()),
    },
    async (args) => {
      logToolUsage('insertOne', args);
      const { collection, document } = args;
      try {
        const result = await db.collection(collection).insertOne(document);
        return {
          content: [
            {
              type: 'text',
              text: `Document inserted successfully with _id: ${result.insertedId}`,
            },
          ],
        };
      } catch (error) {
        logError('insertOne', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error inserting document: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'insertMany',
    'Insert multiple documents into a collection',
    {
      collection: z.string(),
      documents: z.array(z.record(z.any())),
      options: z.record(z.any()).optional(),
    },
    async (args) => {
      logToolUsage('insertMany', args);
      const { collection, documents, options = {} } = args;
      try {
        const result = await db.collection(collection).insertMany(documents, options);
        return {
          content: [
            {
              type: 'text',
              text: `${result.insertedCount} document(s) inserted successfully.`,
            },
          ],
        };
      } catch (error) {
        logError('insertMany', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error inserting documents: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  // Update operations
  registerTool(
    'updateOne',
    'Update a single document that matches the filter',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      update: z.record(z.any()),
      options: z.object({
        upsert: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('updateOne', args);
      const { collection, filter, update, options = {} } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const result = await db.collection(collection).updateOne(processedFilter, update, options);

        return {
          content: [
            {
              type: 'text',
              text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedId ? `, Upserted ID: ${result.upsertedId}` : ''}`,
            },
          ],
        };
      } catch (error) {
        logError('updateOne', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error updating document: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'updateMany',
    'Update multiple documents that match the filter. Supports dryRun mode, empty filter protection, and maxDocuments limit.',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      update: z.record(z.any()),
      options: z.object({
        upsert: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        allowEmptyFilter: z.boolean().optional(),
        maxDocuments: z.number().positive().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('updateMany', args);
      const { collection, filter, update, options = {} } = args;
      try {
        const processedFilter = preprocessQuery(filter);

        // Check for empty filter safety
        const filterCheck = shouldBlockFilter(processedFilter, options.allowEmptyFilter, 'Update');
        if (filterCheck.blocked) {
          return {
            content: [
              {
                type: 'text',
                text: filterCheck.reason,
              },
            ],
          };
        }

        // Count documents that would be affected
        const matchCount = await db.collection(collection).countDocuments(processedFilter);

        // Check maxDocuments limit
        if (options.maxDocuments && matchCount > options.maxDocuments) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠ Operation blocked: Would affect ${matchCount.toLocaleString()} documents, exceeds maxDocuments limit of ${options.maxDocuments.toLocaleString()}

Use previewUpdate() to see which documents would be affected
Or increase maxDocuments limit if this is intentional`,
              },
            ],
          };
        }

        // Dry run mode - show what would be updated
        if (options.dryRun) {
          const sampleDocs = await db.collection(collection).find(processedFilter).limit(3).toArray();
          const smartWarning = getOperationWarning(matchCount, 'update');

          const response = {
            dryRun: true,
            operation: 'updateMany',
            collection,
            wouldMatch: matchCount,
            sampleDocuments: sampleDocs,
            updateOperation: update,
            message: smartWarning
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson(response), null, 2),
              },
            ],
          };
        }

        // Actual execution
        const result = await db.collection(collection).updateMany(processedFilter, update, {
          upsert: options.upsert
        });

        const smartWarning = getOperationWarning(result.matchedCount, 'update');

        return {
          content: [
            {
              type: 'text',
              text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedCount ? `, Upserted: ${result.upsertedCount}` : ''}${smartWarning ? `\n${smartWarning}` : ''}`,
            },
          ],
        };
      } catch (error) {
        logError('updateMany', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error updating documents: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'replaceOne',
    'Replace a single document that matches the filter',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      replacement: z.record(z.any()),
      options: z.object({
        upsert: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('replaceOne', args);
      const { collection, filter, replacement, options = {} } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const result = await db.collection(collection).replaceOne(processedFilter, replacement, options);

        return {
          content: [
            {
              type: 'text',
              text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedId ? `, Upserted ID: ${result.upsertedId}` : ''}`,
            },
          ],
        };
      } catch (error) {
        logError('replaceOne', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error replacing document: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'findOneAndUpdate',
    'Find a single document and update it, returning either the original or the updated document',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      update: z.record(z.any()),
      options: z
        .object({
          returnDocument: z.enum(['before', 'after']).optional(),
          upsert: z.boolean().optional(),
        })
        .optional(),
    },
    async (args) => {
      logToolUsage('findOneAndUpdate', args);
      const { collection, filter, update, options = {} } = args;
      try {
        const processedFilter = preprocessQuery(filter);

        let mongoOptions: Record<string, any> = {};

        if (options.returnDocument !== undefined) {
          mongoOptions.returnDocument = options.returnDocument === 'after' ? 'after' : 'before';
        }

        if (options.upsert !== undefined) {
          mongoOptions.upsert = options.upsert;
        }

        const result = await db.collection(collection).findOneAndUpdate(processedFilter, update, mongoOptions);

        // MongoDB driver v6+ returns the document directly (or null)
        // The document returned depends on returnDocument option: 'before' or 'after'
        if (result) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson(result), null, 2),
              },
            ],
          };
        } else {
          // No document was found (and no upsert occurred)
          return {
            content: [
              {
                type: 'text',
                text: 'No document matched the query',
              },
            ],
          };
        }
      } catch (error) {
        logError('findOneAndUpdate', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error updating document: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  // Delete operations
  registerTool(
    'deleteOne',
    'Delete a single document that matches the filter',
    {
      collection: z.string(),
      filter: z.record(z.any()),
    },
    async (args) => {
      logToolUsage('deleteOne', args);
      const { collection, filter } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const result = await db.collection(collection).deleteOne(processedFilter);
        return {
          content: [
            {
              type: 'text',
              text: `${result.deletedCount} document(s) deleted.`,
            },
          ],
        };
      } catch (error) {
        logError('deleteOne', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error deleting document: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'deleteMany',
    'Delete multiple documents that match the filter. Supports dryRun mode, empty filter protection, and maxDocuments limit.',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      options: z.object({
        dryRun: z.boolean().optional(),
        allowEmptyFilter: z.boolean().optional(),
        maxDocuments: z.number().positive().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('deleteMany', args);
      const { collection, filter, options = {} } = args;
      try {
        const processedFilter = preprocessQuery(filter);

        // Check for empty filter safety
        const filterCheck = shouldBlockFilter(processedFilter, options.allowEmptyFilter, 'Delete');
        if (filterCheck.blocked) {
          return {
            content: [
              {
                type: 'text',
                text: filterCheck.reason,
              },
            ],
          };
        }

        // Count documents that would be affected
        const deleteCount = await db.collection(collection).countDocuments(processedFilter);

        // Check maxDocuments limit
        if (options.maxDocuments && deleteCount > options.maxDocuments) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠ Operation blocked: Would delete ${deleteCount.toLocaleString()} documents, exceeds maxDocuments limit of ${options.maxDocuments.toLocaleString()}

Use previewDelete() to see which documents would be deleted
Or increase maxDocuments limit if this is intentional`,
              },
            ],
          };
        }

        // Dry run mode - show what would be deleted
        if (options.dryRun) {
          const sampleDocs = await db.collection(collection).find(processedFilter).limit(3).toArray();
          const smartWarning = getOperationWarning(deleteCount, 'delete');

          const response = {
            dryRun: true,
            operation: 'deleteMany',
            collection,
            wouldDelete: deleteCount,
            sampleDocuments: sampleDocs,
            message: smartWarning
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson(response), null, 2),
              },
            ],
          };
        }

        // Actual execution
        const result = await db.collection(collection).deleteMany(processedFilter);

        const smartWarning = getOperationWarning(result.deletedCount, 'delete');

        return {
          content: [
            {
              type: 'text',
              text: `${result.deletedCount} document(s) deleted.${smartWarning ? `\n${smartWarning}` : ''}`,
            },
          ],
        };
      } catch (error) {
        logError('deleteMany', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error deleting documents: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );
}
