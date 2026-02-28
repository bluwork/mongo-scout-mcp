import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import type { MongoDocument } from '../types.js';
import { convertObjectIdsToExtendedJson } from '../utils/sanitize.js';
import { MAX_SAMPLE_SIZE } from '../utils/query-limits.js';

export function registerSchemaTools(server: McpServer, db: Db): void {
  server.tool(
    'inferSchema',
    'Infer the schema of a collection from its documents',
    {
      collection: z.string(),
      sampleSize: z.number().positive().max(MAX_SAMPLE_SIZE).optional(),
    },
    async (args) => {
      logToolUsage('inferSchema', args);
      const { collection, sampleSize = 100 } = args;
      try {
        const pipeline = [{ $sample: { size: sampleSize } }, { $limit: sampleSize }];

        const docs = await db.collection(collection).aggregate(pipeline).toArray();

        if (docs.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'Collection is empty or no documents found.',
              },
            ],
          };
        }

        const inferSchema = (documents: MongoDocument[]): Record<string, string[]> => {
          const schemaMap = new Map<string, Set<string>>();

          documents.forEach((doc) => {
            Object.entries(doc).forEach(([key, value]) => {
              if (!schemaMap.has(key)) {
                schemaMap.set(key, new Set());
              }

              const typeSet = schemaMap.get(key)!;
              if (value === null) {
                typeSet.add('null');
              } else if (value instanceof ObjectId) {
                typeSet.add('ObjectId');
              } else if (Array.isArray(value)) {
                typeSet.add('Array');
              } else if (value instanceof Date) {
                typeSet.add('Date');
              } else {
                typeSet.add(typeof value);
              }
            });
          });

          const schema: Record<string, string[]> = {};
          schemaMap.forEach((types, field) => {
            schema[field] = Array.from(types);
          });

          return schema;
        };

        const schema = inferSchema(docs);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(schema), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('inferSchema', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error inferring schema: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}
