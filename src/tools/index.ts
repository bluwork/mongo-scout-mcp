import type { Db, MongoClient } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDatabaseTools } from './database.js';
import { registerCollectionTools } from './collection.js';
import { registerDocumentTools } from './document.js';
import { registerSchemaTools } from './schema.js';
import { registerMonitoringTools } from './monitoring.js';
import { registerLiveMonitoringTools } from './live-monitoring.js';
import { registerIndexManagementTools } from './index-management.js';
import { registerAdvancedOperations } from './advanced-operations.js';
import { registerDataQualityTools } from './data-quality.js';
import { registerTemporalTools } from './temporal.js';
import { withConnectionGuard } from '../utils/connection-guard.js';
import { validateCollectionName, validateDatabaseName } from '../utils/name-validator.js';

export const COLLECTION_PARAMS = new Set([
  'collection', 'name', 'source', 'destination', 'referenceCollection', 'foreignCollection',
]);

export const DATABASE_PARAMS = new Set(['database']);

export function wrapServerWithNameValidation(server: McpServer, dbName: string): McpServer {
  const originalTool = server.tool.bind(server);

  server.tool = ((...args: unknown[]) => {
    const lastIndex = args.length - 1;

    if (typeof args[lastIndex] === 'function') {
      const originalHandler = args[lastIndex] as (handlerArgs: Record<string, unknown>) => Promise<unknown>;

      args[lastIndex] = async (handlerArgs: Record<string, unknown>) => {
        if (handlerArgs && typeof handlerArgs === 'object') {
          for (const [key, value] of Object.entries(handlerArgs)) {
            if (typeof value !== 'string') continue;

            if (COLLECTION_PARAMS.has(key)) {
              const result = validateCollectionName(value);
              if (!result.valid) {
                return {
                  content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
                  isError: true,
                };
              }
            }

            if (DATABASE_PARAMS.has(key)) {
              const result = validateDatabaseName(value, dbName);
              if (!result.valid) {
                return {
                  content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
                  isError: true,
                };
              }
            }
          }
        }

        return originalHandler(handlerArgs);
      };
    }

    return (originalTool as (...a: unknown[]) => unknown)(...args);
  }) as typeof server.tool;

  return server;
}

function wrapServerWithConnectionGuard(server: McpServer): McpServer {
  const originalTool = server.tool.bind(server);

  server.tool = ((...args: unknown[]) => {
    const toolName = args[0] as string;
    const lastIndex = args.length - 1;

    if (typeof args[lastIndex] === 'function') {
      const originalHandler = args[lastIndex] as (...handlerArgs: unknown[]) => Promise<unknown>;
      args[lastIndex] = withConnectionGuard(toolName, originalHandler);
    }

    return (originalTool as (...a: unknown[]) => unknown)(...args);
  }) as typeof server.tool;

  return server;
}

export function registerAllTools(
  server: McpServer,
  client: MongoClient,
  db: Db,
  dbName: string,
  mode: string
): void {
  const validatedServer = wrapServerWithNameValidation(server, dbName);
  const guardedServer = wrapServerWithConnectionGuard(validatedServer);

  registerDatabaseTools(guardedServer, client, mode);
  registerCollectionTools(guardedServer, db, mode);
  registerDocumentTools(guardedServer, db, mode);
  registerSchemaTools(guardedServer, db);
  registerIndexManagementTools(guardedServer, db, mode);
  registerAdvancedOperations(guardedServer, db, mode);
  registerDataQualityTools(guardedServer, db, mode);
  registerTemporalTools(guardedServer, db, mode);
  registerMonitoringTools(guardedServer, client, db, dbName, mode);
  registerLiveMonitoringTools(guardedServer, db, mode);
}
