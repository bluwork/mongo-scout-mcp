import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { preprocessQuery } from '../utils/query-preprocessor.js';

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
      limit: z.number().positive().optional(),
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  documents: docs,
                  metadata: {
                    total,
                    limit,
                    skip,
                    hasMore: total > skip + docs.length,
                  },
                },
                null,
                2,
              ),
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
      try {
        const result = await db.collection(collection).aggregate(pipeline, options).toArray();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
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
              text: JSON.stringify(values, null, 2),
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
    'Update multiple documents that match the filter',
    {
      collection: z.string(),
      filter: z.record(z.any()),
      update: z.record(z.any()),
      options: z.object({
        upsert: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('updateMany', args);
      const { collection, filter, update, options = {} } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const result = await db.collection(collection).updateMany(processedFilter, update, options);

        return {
          content: [
            {
              type: 'text',
              text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedCount ? `, Upserted: ${result.upsertedCount}` : ''}`,
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

        let responseText: string;
        if (result && result.value) {
          responseText = JSON.stringify(result.value, null, 2);
        } else if (result && result.lastErrorObject?.upserted) {
          responseText = `New document created via upsert with _id: ${result.lastErrorObject.upserted}`;
        } else if (options.upsert) {
          responseText = 'New document created via upsert';
        } else {
          responseText = 'No document matched the query';
        }

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
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
    'Delete multiple documents that match the filter',
    {
      collection: z.string(),
      filter: z.record(z.any()),
    },
    async (args) => {
      logToolUsage('deleteMany', args);
      const { collection, filter } = args;
      try {
        const processedFilter = preprocessQuery(filter);
        const result = await db.collection(collection).deleteMany(processedFilter);
        return {
          content: [
            {
              type: 'text',
              text: `${result.deletedCount} document(s) deleted.`,
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
