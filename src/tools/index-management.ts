import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';

export function registerIndexManagementTools(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'listIndexes',
    'List all indexes for a collection',
    {
      collection: z.string(),
    },
    async (args) => {
      logToolUsage('listIndexes', args);
      const { collection } = args;
      try {
        const indexes = await db.collection(collection).listIndexes().toArray();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(indexes, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('listIndexes', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error listing indexes: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'createIndex',
    'Create an index on a collection',
    {
      collection: z.string(),
      keys: z.record(z.union([
        z.number(),
        z.enum(['text', 'hashed', '2d', '2dsphere', 'geoHaystack'])
      ])),
      options: z.object({
        unique: z.boolean().optional(),
        name: z.string().optional(),
        sparse: z.boolean().optional(),
        expireAfterSeconds: z.number().optional(),
        background: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('createIndex', args);
      const { collection, keys, options = {} } = args;
      try {
        const indexName = await db.collection(collection).createIndex(keys, options);
        return {
          content: [
            {
              type: 'text',
              text: `Index '${indexName}' created successfully on collection '${collection}'`,
            },
          ],
        };
      } catch (error) {
        logError('createIndex', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error creating index: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'dropIndex',
    'Drop an index from a collection',
    {
      collection: z.string(),
      indexName: z.string(),
    },
    async (args) => {
      logToolUsage('dropIndex', args);
      const { collection, indexName } = args;
      try {
        await db.collection(collection).dropIndex(indexName);
        return {
          content: [
            {
              type: 'text',
              text: `Index '${indexName}' dropped successfully from collection '${collection}'`,
            },
          ],
        };
      } catch (error) {
        logError('dropIndex', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error dropping index: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );
}
